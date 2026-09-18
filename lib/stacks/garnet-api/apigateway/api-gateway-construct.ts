
import {
    CfnAuthorizer as CfnAuthorizerV2,
    CfnIntegration,
    CfnRoute,
    CfnVpcLink,
    CorsHttpMethod,
    HttpApi
} from "aws-cdk-lib/aws-apigatewayv2"
import {
    CfnSecurityGroupIngress,
    SecurityGroup,
    Vpc
} from "aws-cdk-lib/aws-ec2"
import { Construct } from "constructs"
import { ApplicationLoadBalancer } from "aws-cdk-lib/aws-elasticloadbalancingv2"
import { CfnPermission } from "aws-cdk-lib/aws-lambda"
import { Aws, Duration } from "aws-cdk-lib"
import { Parameters } from "../../../../configuration"
import { garnet_resource_name } from "../../../../constants"

export interface GarnetApiGatewayProps {
    readonly vpc: Vpc,
    readonly broker_alb: ApplicationLoadBalancer
    readonly lambda_authorizer_arn: string
}

export class GarnetApiGateway extends Construct{
    public readonly api_ref: string
    public readonly stage_name = "$default"
    constructor(scope: Construct, id: string, props: GarnetApiGatewayProps) {
        super(scope, id)
        // Check props
        if (!props.vpc){
            throw new Error('The property vpc is required')
        }
        if (!props.broker_alb){
            throw new Error('The property broker_alb is required')
        }
        if (!props.lambda_authorizer_arn) {
            throw new Error('The property lambda_authorizer_arn is required')
        }

        const sg_vpc_link = new SecurityGroup(this, 'SgVpcLink', {
            securityGroupName: garnet_resource_name("api-vpc-link-sg"),
            vpc: props.vpc
        })
        const [alb_security_group] =
            props.broker_alb.connections.securityGroups
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

        const integration = new CfnIntegration(this, 'HttpApiIntegration', {
            apiId: api.apiId,
            integrationMethod: "ANY",
            integrationType: "HTTP_PROXY",
            connectionType: "VPC_LINK",
            description: "API Integration",
            connectionId: vpc_link.ref, 
            integrationUri: props.broker_alb.listeners[0].listenerArn,
            payloadFormatVersion: "1.0",
            requestParameters: {
                "overwrite:header.NGSILD-Tenant":
                    "$context.authorizer.tenant"
            }
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
        const authorizer_permission = new CfnPermission(
            this,
            "AuthorizerInvokePermission",
            {
                action: "lambda:InvokeFunction",
                functionName: props.lambda_authorizer_arn,
                principal: "apigateway.amazonaws.com",
                sourceArn:
                    `arn:${Aws.PARTITION}:execute-api:` +
                    `${Aws.REGION}:${Aws.ACCOUNT_ID}:${api.apiId}/` +
                    `authorizers/${authorizer.ref}`
            }
        )

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
            route.node.addDependency(authorizer_permission)
        }

        this.api_ref = api.apiId

    }
}
