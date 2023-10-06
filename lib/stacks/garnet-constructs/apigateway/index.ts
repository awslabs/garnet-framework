import { CfnOutput, Names} from "aws-cdk-lib"
import { CfnApi, CfnIntegration, CfnRoute, CfnStage, CfnVpcLink } from "aws-cdk-lib/aws-apigatewayv2"
import { Vpc } from "aws-cdk-lib/aws-ec2"
import { ApplicationLoadBalancedFargateService } from "aws-cdk-lib/aws-ecs-patterns"
import { Construct } from "constructs"
import { Parameters } from "../../../../parameters"

export interface GarnetApiGatewayProps {
    readonly vpc: Vpc,
    readonly fargate_alb: ApplicationLoadBalancedFargateService
}

export class GarnetApiGateway extends Construct{
    public readonly api_ref: string
    constructor(scope: Construct, id: string, props: GarnetApiGatewayProps) {
        super(scope, id)
        // Check props
        if (!props.vpc){
            throw new Error('The property vpc is required to create an instance of GarnetApiGateway Construct')
        }
        if (!props.fargate_alb){
            throw new Error('The property fargate_alb is required to create an instance of GarnetApiGateway Construct')
        }

        const vpc_link = new CfnVpcLink(this, 'VpcLink', {
            name: `garnet-vpc-link-${Names.uniqueId(this).slice(-4).toLowerCase()}`, 
            subnetIds: props.vpc.privateSubnets.map( (m) => m.subnetId)
        })

        const api = new CfnApi(this, 'HttpApi', {
            name: `garnet-api`, 
            protocolType: 'HTTP',
            corsConfiguration: {
                allowHeaders: ['*'],
                allowMethods: ['*'],
                allowOrigins: ['*']
            },
            

        })

        const stage = new CfnStage(this, 'StageApi', {
            apiId: api.ref,
            stageName: '$default',
            autoDeploy: true
        })

        const integration = new CfnIntegration(this, 'HttpApiIntegration', {
            apiId: api.ref,
            integrationMethod: "ANY",
            integrationType: "HTTP_PROXY",
            connectionType: "VPC_LINK",
            description: "API Integration",
            connectionId: vpc_link.ref, 
            integrationUri: props.fargate_alb.listener.listenerArn,
            payloadFormatVersion: "1.0",
        })

        const route = new CfnRoute(this, 'Route', {
            apiId: api.ref,
            routeKey: "ANY /{proxy+}",
            target: `integrations/${integration.ref}`
        })

        this.api_ref = api.ref

    }
}