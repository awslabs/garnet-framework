import {
    Aws,
    CfnOutput,
    Duration,
    NestedStack,
    NestedStackProps,
    RemovalPolicy
} from "aws-cdk-lib"
import {
    EndpointType,
    LambdaRestApi
} from "aws-cdk-lib/aws-apigateway"
import {
    InterfaceVpcEndpoint,
    Peer,
    Port,
    SecurityGroup,
    Vpc
} from "aws-cdk-lib/aws-ec2"
import {
    AnyPrincipal,
    Effect,
    PolicyDocument,
    PolicyStatement
} from "aws-cdk-lib/aws-iam"
import {
    Architecture,
    Code,
    Function,
    Runtime
} from "aws-cdk-lib/aws-lambda"
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs"
import { Construct } from "constructs"
import {
    garnet_nomenclature,
    garnet_resource_name
} from "../../../constants"

export interface AwsIotCoreMqttConnectorProps extends NestedStackProps {
    vpc: Vpc
    tenant: string
}

/**
 * Optional built-in connector that publishes NGSI-LD Subscription
 * notifications to tenant- and Subscription-isolated AWS IoT Core topics.
 *
 * The connector is deliberately one-way. It does not synchronize AWS IoT
 * Things, Thing Groups, presence, registry events, or shadows into Broker
 * entities.
 */
export class AwsIotCoreMqttConnector extends NestedStack {
    public readonly endpoint: string
    public readonly notification_origin: string
    public readonly api_key_id: string

    constructor(
        scope: Construct,
        id: string,
        props: AwsIotCoreMqttConnectorProps
    ) {
        super(scope, id, props)

        const endpoint_security_group = new SecurityGroup(
            this,
            "EndpointSecurityGroup",
            {
                vpc: props.vpc,
                allowAllOutbound: true,
                description:
                    "Private API Gateway endpoint for Garnet notifications"
            }
        )
        endpoint_security_group.addIngressRule(
            Peer.ipv4(props.vpc.vpcCidrBlock),
            Port.tcp(443),
            "HTTPS from the Garnet VPC"
        )
        const endpoint = new InterfaceVpcEndpoint(this, "VpcEndpoint", {
            vpc: props.vpc,
            service: {
                name: `com.amazonaws.${Aws.REGION}.execute-api`,
                port: 443
            },
            privateDnsEnabled: true,
            securityGroups: [endpoint_security_group]
        })

        const notification_logs = new LogGroup(this, "NotificationLogs", {
            retention: RetentionDays.ONE_MONTH,
            removalPolicy: RemovalPolicy.DESTROY
        })
        const notification = new Function(this, "NotificationFunction", {
            functionName:
                garnet_nomenclature.garnet_iot_core_mqtt_connector_lambda,
            description:
                "Publish NGSI-LD Subscription notifications to AWS IoT Core MQTT",
            runtime: Runtime.NODEJS_24_X,
            architecture: Architecture.ARM_64,
            code: Code.fromAsset(
                `${__dirname}/lambda`
            ),
            handler: "index.handler",
            timeout: Duration.seconds(50),
            memorySize: 512,
            logGroup: notification_logs,
            environment: {
                AWSIOTREGION: Aws.REGION,
                GARNET_TENANT: props.tenant
            }
        })
        notification.addToRolePolicy(new PolicyStatement({
            actions: ["iot:Publish"],
            resources: [
                `arn:${Aws.PARTITION}:iot:${Aws.REGION}:` +
                `${Aws.ACCOUNT_ID}:topic/garnet-framework/` +
                "tenants/*/subscriptions/*"
            ]
        }))

        const api_policy = new PolicyDocument({
            statements: [
                new PolicyStatement({
                    principals: [new AnyPrincipal()],
                    actions: ["execute-api:Invoke"],
                    resources: ["execute-api:/*"],
                    effect: Effect.DENY,
                    conditions: {
                        StringNotEquals: {
                            "aws:SourceVpce": endpoint.vpcEndpointId
                        }
                    }
                }),
                new PolicyStatement({
                    principals: [new AnyPrincipal()],
                    actions: ["execute-api:Invoke"],
                    resources: ["execute-api:/*"],
                    effect: Effect.ALLOW,
                    conditions: {
                        StringEquals: {
                            "aws:SourceVpce": endpoint.vpcEndpointId
                        }
                    }
                })
            ]
        })
        const api = new LambdaRestApi(this, "Api", {
            restApiName:
                garnet_resource_name("iot-core-mqtt-connector-api"),
            endpointTypes: [EndpointType.PRIVATE],
            handler: notification,
            policy: api_policy,
            description:
                "Optional private NGSI-LD Subscription to IoT Core MQTT connector",
            defaultMethodOptions: {
                apiKeyRequired: true
            },
            deployOptions: {
                stageName: "notifications",
                throttlingBurstLimit: 2000,
                throttlingRateLimit: 1000
            }
        })
        const api_key = api.addApiKey("ConnectorApiKey", {
            description:
                "Capability required in Subscription endpoint receiverInfo"
        })
        const usage_plan = api.addUsagePlan("ConnectorUsagePlan", {
            description:
                "Bounded ingress for the optional IoT Core MQTT connector",
            throttle: {
                burstLimit: 2000,
                rateLimit: 1000
            }
        })
        usage_plan.addApiKey(api_key)
        usage_plan.addApiStage({
            stage: api.deploymentStage
        })

        this.endpoint = api.url
        this.notification_origin =
            `https://${api.restApiId}.execute-api.${Aws.REGION}.amazonaws.com`
        this.api_key_id = api_key.keyId

        new CfnOutput(this, "ApiEndpoint", {
            value: this.endpoint,
            description:
                "Private NGSI-LD Subscription to IoT Core MQTT endpoint"
        })
        new CfnOutput(this, "ApiKeyId", {
            value: this.api_key_id,
            description:
                "Retrieve this API key value and send it as x-api-key via NGSI-LD receiverInfo"
        })
    }
}
