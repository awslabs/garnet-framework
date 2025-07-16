
import { CfnAuthorizer as CfnAuthorizerV2, CfnIntegration, CfnRoute, CfnStage, CfnVpcLink, CorsHttpMethod, HttpApi } from "aws-cdk-lib/aws-apigatewayv2"
import { SecurityGroup, Vpc } from "aws-cdk-lib/aws-ec2"
import { Construct } from "constructs"
import { Function as LambdaFunction, Runtime, Code, Permission } from 'aws-cdk-lib/aws-lambda'
import { ApplicationLoadBalancer } from "aws-cdk-lib/aws-elasticloadbalancingv2"
import { HttpLambdaAuthorizer, HttpLambdaResponseType } from "aws-cdk-lib/aws-apigatewayv2-authorizers"
import { ServicePrincipal } from "aws-cdk-lib/aws-iam"
import { Aws, Duration } from "aws-cdk-lib"
import { AuthorizationType, CfnAuthorizer } from "aws-cdk-lib/aws-apigateway"
import { Parameters } from "../../../../configuration"

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
            securityGroupName: `garnet-vpclink-sg`,
            vpc: props.vpc
        })


    
        const vpc_link = new CfnVpcLink(this, 'VpcLink', {
            name: `garnet-vpc-link`, 
            subnetIds: props.vpc.privateSubnets.map( (m) => m.subnetId),
            securityGroupIds: [sg_vpc_link.securityGroupId]
        })

        // Create HTTP API with CORS and default authorizer
        const api = new HttpApi(this, 'HttpApi', {
            apiName: 'garnet-api',
            corsPreflight: {
            maxAge: Duration.seconds(5),
            exposeHeaders: ['*'],
            allowHeaders: ['*', 'Authorization', 'Content-Type'],
            allowMethods: [CorsHttpMethod.GET, CorsHttpMethod.OPTIONS],
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
        })




        // Create CORS preflight Lambda function first
        const corsLambda = new LambdaFunction(this, 'CorsPreflightHandler', {
            functionName: 'garnet-api-cors-preflight',
            runtime: Runtime.NODEJS_LATEST,
            handler: 'index.handler',
            code: Code.fromInline(`
exports.handler  = async (event) => {
    return {
        statusCode: 200,
        headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers": "Content-Type,Authorization,X-Amz-Date,X-Api-Key,X-Amz-Security-Token",
            "Access-Control-Allow-Methods": "GET,POST,OPTIONS"
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
