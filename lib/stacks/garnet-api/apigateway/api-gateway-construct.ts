
import { CfnAuthorizer as CfnAuthorizerV2, CfnIntegration, CfnRoute, CfnStage, CfnVpcLink, CorsHttpMethod, HttpApi } from "aws-cdk-lib/aws-apigatewayv2"
import {
    CfnSecurityGroupIngress,
    SecurityGroup,
    Vpc
} from "aws-cdk-lib/aws-ec2"
import { Construct } from "constructs"
import { Function as LambdaFunction, Runtime, Code, Permission } from 'aws-cdk-lib/aws-lambda'
import { ApplicationLoadBalancer } from "aws-cdk-lib/aws-elasticloadbalancingv2"
import { HttpLambdaAuthorizer, HttpLambdaResponseType } from "aws-cdk-lib/aws-apigatewayv2-authorizers"
import { ServicePrincipal } from "aws-cdk-lib/aws-iam"
import { Aws, Duration } from "aws-cdk-lib"
import { AuthorizationType, CfnAuthorizer } from "aws-cdk-lib/aws-apigateway"
import { Parameters } from "../../../../configuration"
import { garnet_resource_name } from "../../../../constants"

export interface GarnetApiGatewayProps {
    readonly vpc: Vpc,
    readonly fargate_alb: ApplicationLoadBalancer
    readonly lambda_authorizer_arn: string
}

export class GarnetApiGateway extends Construct{
    public readonly api_ref: string
    constructor(scope: Construct, id: string, props: GarnetApiGatewayProps) {
        super(scope, id)
        // Check props
        if (!props.vpc){
            throw new Error('The property vpc is required')
        }
        if (!props.fargate_alb){
            throw new Error('The property fargate_alb is required')
        }
        if (!props.lambda_authorizer_arn) {
            throw new Error('The property lambda_authorizer_arn is required')
        }

        const sg_vpc_link = new SecurityGroup(this, 'SgVpcLink', {
            securityGroupName: garnet_resource_name("api-vpc-link-sg"),
            vpc: props.vpc
        })
        const [alb_security_group] =
            props.fargate_alb.connections.securityGroups
        if (alb_security_group === undefined) {
            throw new Error(
                "The Garnet Broker load balancer requires a security group"
            )
        }
        new CfnSecurityGroupIngress(this, "VpcLinkToBrokerAlbIngress", {
            description: "API Gateway VPC link to the Garnet Broker ALB",
            groupId: alb_security_group.securityGroupId,
            sourceSecurityGroupId: sg_vpc_link.securityGroupId,
            ipProtocol: "tcp",
            fromPort: 80,
            toPort: 80
        })


    
        const vpc_link = new CfnVpcLink(this, 'VpcLink', {
            name: garnet_resource_name("api-vpc-link"),
            subnetIds: props.vpc.privateSubnets.map( (m) => m.subnetId),
            securityGroupIds: [sg_vpc_link.securityGroupId]
        })

        // Create HTTP API with CORS and default authorizer
        const api = new HttpApi(this, 'HttpApi', {
            apiName: garnet_resource_name("api"),
            corsPreflight: {
            maxAge: Duration.seconds(5),
            exposeHeaders: [
                'Content-Type',
                'Link',
                'Location',
                'NGSILD-Results-Count'
            ],
            allowHeaders: [
                'Authorization',
                'Content-Type',
                'Link',
                'NGSILD-Tenant',
                'NGSILD-Path'
            ],
            allowMethods: [
                CorsHttpMethod.GET,
                CorsHttpMethod.POST,
                CorsHttpMethod.PATCH,
                CorsHttpMethod.DELETE,
                CorsHttpMethod.OPTIONS
            ],
            allowOrigins: ['*']
            },
            createDefaultStage: true
            })

        const lambda_authorizer = LambdaFunction.fromFunctionArn(this, 'LambdaAuthorizer', props.lambda_authorizer_arn)

        const integration = new CfnIntegration(this, 'HttpApiIntegration', {
            apiId: api.apiId,
            integrationMethod: "ANY",
            integrationType: "HTTP_PROXY",
            connectionType: "VPC_LINK",
            description: "API Integration",
            connectionId: vpc_link.ref, 
            integrationUri: props.fargate_alb.listeners[0].listenerArn,
            payloadFormatVersion: "1.0",
            requestParameters: {
                "overwrite:header.NGSILD-Tenant":
                    "$context.authorizer.tenant"
            }
        })




        // Create CORS preflight Lambda function first
        const corsLambda = new LambdaFunction(this, 'CorsPreflightHandler', {
            functionName: garnet_resource_name("api-cors-preflight"),
            runtime: Runtime.NODEJS_24_X,
            handler: 'index.handler',
            code: Code.fromInline(`
exports.handler  = async (event) => {
    return {
        statusCode: 200,
        headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers": "Authorization,Content-Type,Link,NGSILD-Tenant,NGSILD-Path",
            "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS"
        },
        body: ''
    }
}
            `)
        })

        // Grant API Gateway permission to invoke the CORS Lambda function
        corsLambda.addPermission('ApiGatewayInvokePermission', {
            principal: new ServicePrincipal('apigateway.amazonaws.com'),
            sourceArn: `arn:aws:execute-api:${Aws.REGION}:${Aws.ACCOUNT_ID}:${api.apiId}/*/*`
        })

        // Create Lambda integration for CORS preflight
        const corsIntegration = new CfnIntegration(this, 'CorsLambdaIntegration', {
            apiId: api.apiId,
            integrationMethod: "POST",
            integrationType: "AWS_PROXY",
            integrationUri: `arn:aws:apigateway:${Aws.REGION}:lambda:path/2015-03-31/functions/${corsLambda.functionArn}/invocations`,
            payloadFormatVersion: "2.0",
        })

        const authorizer = new CfnAuthorizerV2(this, 'JwtAuthorizer', {
            apiId: api.apiId,
            authorizerType: 'REQUEST',
            authorizerPayloadFormatVersion: '2.0',
            authorizerResultTtlInSeconds: 600,
            authorizerUri: `arn:aws:apigateway:${Aws.REGION}:lambda:path/2015-03-31/functions/${props.lambda_authorizer_arn}/invocations`,
            enableSimpleResponses: true,
            identitySource: ['$request.header.Authorization'],
            name: 'jwt-authorizer'
        })

        const route = new CfnRoute(this, 'AuthRoute', {
            apiId: api.apiId,
            routeKey: "ANY /{proxy+}",
            target: `integrations/${integration.ref}`,
            authorizationType: Parameters.authorization ? 'CUSTOM' : 'NONE',
            ...(Parameters.authorization ? {
                authorizerId: authorizer.ref,
                } : {})
        })
        
        if (Parameters.authorization) {
            route.node.addDependency(authorizer)
        }

        // Add OPTIONS route for CORS preflight AFTER the ANY route
        const optionsRoute = new CfnRoute(this, 'ApiOptionsRoute', {
            apiId: api.apiId,
            routeKey: "OPTIONS /{proxy+}",
            target: `integrations/${corsIntegration.ref}`,
            authorizationType: 'NONE'
        })

        // Add explicit dependencies to ensure proper creation order
        optionsRoute.node.addDependency(corsIntegration)
        optionsRoute.node.addDependency(corsLambda)


        this.api_ref = api.apiId

    }
}
