import { CfnOutput, NestedStack, NestedStackProps } from "aws-cdk-lib"
import { Vpc } from "aws-cdk-lib/aws-ec2"
import { ApplicationLoadBalancer } from "aws-cdk-lib/aws-elasticloadbalancingv2"
import { CfnDeliveryStream } from "aws-cdk-lib/aws-kinesisfirehose"
import { Secret } from "aws-cdk-lib/aws-secretsmanager"
import { Construct } from "constructs"
import { GarnetBrokerDatabase } from "./database/database-construct"
import { GarnetBrokerRuntime } from "./runtime/container-construct"

export interface GarnetBrokerProps extends NestedStackProps {
    vpc: Vpc
    secret: Secret
    delivery_stream: CfnDeliveryStream
    image: string
    public_origin: string
    notification_delivery_allow_origins: string
    context_allow_hosts: string
}

export class GarnetBroker extends NestedStack {
    public readonly dns_context_broker: string
    public readonly fargate_alb: ApplicationLoadBalancer

    constructor(scope: Construct, id: string, props: GarnetBrokerProps) {
        super(scope, id, props)

        const database = new GarnetBrokerDatabase(this, "Database", {
            vpc: props.vpc,
            secret: props.secret
        })
        const runtime = new GarnetBrokerRuntime(this, "Runtime", {
            vpc: props.vpc,
            database: database.cluster,
            database_secret: props.secret,
            delivery_stream: props.delivery_stream,
            image: props.image,
            public_origin: props.public_origin,
            notification_delivery_allow_origins:
                props.notification_delivery_allow_origins,
            context_allow_hosts: props.context_allow_hosts
        })

        this.fargate_alb = runtime.fargate_alb
        this.dns_context_broker = runtime.fargate_alb.loadBalancerDnsName

        new CfnOutput(this, "BrokerLoadBalancer", {
            value: this.dns_context_broker
        })
        new CfnOutput(this, "EntityEventQueue", {
            value: runtime.event_queue.queueUrl
        })
    }
}
