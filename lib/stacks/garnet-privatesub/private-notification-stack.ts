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
    Policy,
    PolicyDocument,
    PolicyStatement,
    Role,
    ServicePrincipal
} from "aws-cdk-lib/aws-iam"
import { CfnTopicRule } from "aws-cdk-lib/aws-iot"
import {
    Architecture,
    Code,
    Function,
    LayerVersion,
    Runtime
} from "aws-cdk-lib/aws-lambda"
import { CfnDeliveryStream } from "aws-cdk-lib/aws-kinesisfirehose"
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs"
import { Bucket } from "aws-cdk-lib/aws-s3"
import { Construct } from "constructs"
import {
    garnet_nomenclature,
    garnet_resource_name
} from "../../../constants"

export interface GarnetPrivateSubProps extends NestedStackProps {
    vpc: Vpc
    bucket_name: string
}

/**
 * Private NGSI-LD notification ingress.
 *
 * Garnet Broker posts directly to the private API endpoint. Legacy queue
 * discovery and the competing-consumer bridge do not exist in this stack.
 */
export class GarnetPrivateSub extends NestedStack {
    public readonly private_sub_endpoint: string
    public readonly notification_origin: string

    constructor(
        scope: Construct,
        id: string,
        props: GarnetPrivateSubProps
    ) {
        super(scope, id, props)

        const layer = new LayerVersion(this, "Layer", {
            code: Code.fromAsset("./lib/layers"),
            compatibleRuntimes: [Runtime.NODEJS_24_X]
        })
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
            functionName: garnet_nomenclature.garnet_private_sub_lambda,
            description:
                "Publish private NGSI-LD notifications to AWS IoT Core",
            runtime: Runtime.NODEJS_24_X,
            architecture: Architecture.ARM_64,
            layers: [layer],
            code: Code.fromAsset(
                `${__dirname}/lambda/garnetSub`
            ),
            handler: "index.handler",
            timeout: Duration.seconds(50),
            memorySize: 512,
            logGroup: notification_logs,
            environment: {
                AWSIOTREGION: Aws.REGION
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
                    effect: Effect.ALLOW
                })
            ]
        })
        const api = new LambdaRestApi(this, "Api", {
            restApiName:
                garnet_resource_name("private-subscription-api"),
            endpointTypes: [EndpointType.PRIVATE],
            handler: notification,
            policy: api_policy,
            description:
                "Private callback endpoint for Garnet Broker Subscriptions",
            deployOptions: {
                stageName: "privatesub"
            }
        })
        this.private_sub_endpoint = api.url
        this.notification_origin =
            `https://${api.restApiId}.execute-api.${Aws.REGION}.amazonaws.com`

        new CfnOutput(this, "ApiEndpoint", {
            value: this.private_sub_endpoint,
            description: "Private NGSI-LD notification endpoint"
        })

        const bucket = Bucket.fromBucketName(
            this,
            "GarnetBucket",
            props.bucket_name
        )
        const firehose_role = new Role(this, "FirehoseRole", {
            assumedBy: new ServicePrincipal("firehose.amazonaws.com")
        })
        bucket.grantReadWrite(firehose_role)
        const stream = new CfnDeliveryStream(this, "NotificationStream", {
            deliveryStreamName:
                garnet_nomenclature.garnet_sub_firehose_stream,
            deliveryStreamType: "DirectPut",
            extendedS3DestinationConfiguration: {
                bucketArn: bucket.bucketArn,
                roleArn: firehose_role.roleArn,
                bufferingHints: {
                    intervalInSeconds: 60,
                    sizeInMBs: 64
                },
                processingConfiguration: {
                    enabled: true,
                    processors: [{
                        type: "MetadataExtraction",
                        parameters: [
                            {
                                parameterName:
                                    "MetadataExtractionQuery",
                                parameterValue:
                                    "{tenant:._garnetTenant,type:.type}"
                            },
                            {
                                parameterName: "JsonParsingEngine",
                                parameterValue: "JQ-1.6"
                            }
                        ]
                    }]
                },
                dynamicPartitioningConfiguration: {
                    enabled: true
                },
                prefix:
                    "tenant=!{partitionKeyFromQuery:tenant}/" +
                    "type=!{partitionKeyFromQuery:type}/" +
                    "dt=!{timestamp:yyyy}-!{timestamp:MM}-" +
                    "!{timestamp:dd}-!{timestamp:HH}/",
                errorOutputPrefix:
                    "type=!{firehose:error-output-type}/" +
                    "dt=!{timestamp:yyyy}-!{timestamp:MM}-" +
                    "!{timestamp:dd}-!{timestamp:HH}/"
            }
        })
        const iot_role = new Role(this, "IotRuleRole", {
            assumedBy: new ServicePrincipal("iot.amazonaws.com")
        })
        iot_role.attachInlinePolicy(new Policy(this, "IotRulePolicy", {
            statements: [
                new PolicyStatement({
                    resources: [stream.attrArn],
                    actions: [
                        "firehose:DescribeDeliveryStream",
                        "firehose:PutRecord",
                        "firehose:PutRecordBatch"
                    ]
                })
            ]
        }))
        new CfnTopicRule(this, "IotRule", {
            ruleName: garnet_nomenclature.garnet_subscriptions_rule,
            topicRulePayload: {
                awsIotSqlVersion: "2016-03-23",
                ruleDisabled: false,
                sql:
                    "SELECT *, topic(3) AS _garnetTenant " +
                    "FROM 'garnet-framework/tenants/+/subscriptions/+'",
                actions: [{
                    firehose: {
                        deliveryStreamName: stream.ref,
                        roleArn: iot_role.roleArn,
                        separator: "\n"
                    }
                }]
            }
        })
    }
}
