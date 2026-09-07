import {
    Aws,
    Duration,
    RemovalPolicy,
    Token
} from "aws-cdk-lib"
import { Alarm, TreatMissingData } from "aws-cdk-lib/aws-cloudwatch"
import {
    Peer,
    Port,
    SecurityGroup,
    SubnetType,
    Vpc
} from "aws-cdk-lib/aws-ec2"
import {
    Cluster,
    ContainerImage,
    ContainerInsights,
    CpuArchitecture,
    FargateTaskDefinition,
    LogDrivers,
    OperatingSystemFamily,
    Secret as EcsSecret
} from "aws-cdk-lib/aws-ecs"
import {
    ApplicationLoadBalancer,
    ApplicationProtocol,
    ApplicationTargetGroup,
    ListenerAction
} from "aws-cdk-lib/aws-elasticloadbalancingv2"
import { Rule, Schedule } from "aws-cdk-lib/aws-events"
import { EcsTask } from "aws-cdk-lib/aws-events-targets"
import { PolicyStatement } from "aws-cdk-lib/aws-iam"
import { CfnDeliveryStream } from "aws-cdk-lib/aws-kinesisfirehose"
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs"
import { DatabaseCluster } from "aws-cdk-lib/aws-rds"
import {
    DeduplicationScope,
    FifoThroughputLimit,
    Queue,
    QueueEncryption
} from "aws-cdk-lib/aws-sqs"
import { Secret } from "aws-cdk-lib/aws-secretsmanager"
import { Construct } from "constructs"
import { garnet_constant } from "../../../../constants"
import { GarnetMigration } from "../migration/migration-construct"
import { GARNET_SERVICE_CAPACITY } from "./runtime-profile"
import {
    GarnetServiceResult,
    GarnetTaskFactory
} from "./task-factory"

export interface GarnetBrokerRuntimeProps {
    vpc: Vpc
    database: DatabaseCluster
    database_secret: Secret
    delivery_stream: CfnDeliveryStream
    image: string
    public_origin: string
    notification_delivery_allow_origins: string
    context_allow_hosts: string
}

export class GarnetBrokerRuntime extends Construct {
    public readonly fargate_alb: ApplicationLoadBalancer
    public readonly sg_broker: SecurityGroup
    public readonly cluster: Cluster
    public readonly event_queue: Queue

    constructor(scope: Construct, id: string, props: GarnetBrokerRuntimeProps) {
        super(scope, id)

        if (!/^[^@\s]+@sha256:[0-9a-f]{64}$/.test(props.image)) {
            throw new Error(
                "Garnet Broker image must be immutable and digest-pinned"
            )
        }

        const image = ContainerImage.fromRegistry(props.image)
        this.sg_broker = new SecurityGroup(this, "SecurityGroup", {
            vpc: props.vpc,
            description: "Garnet Broker API and worker tasks",
            allowAllOutbound: true
        })
        props.database.connections.allowDefaultPortFrom(
            this.sg_broker,
            "Direct Garnet Broker PostgreSQL pools"
        )
        this.sg_broker.addIngressRule(
            this.sg_broker,
            Port.tcp(8080),
            "Private federation and worker health traffic"
        )

        this.cluster = new Cluster(this, "Cluster", {
            vpc: props.vpc,
            clusterName: "garnet-broker-cluster-garnet",
            containerInsightsV2: ContainerInsights.ENHANCED,
            defaultCloudMapNamespace: {
                name: "garnet.local"
            }
        })

        const event_dlq = new Queue(this, "EntityEventDeadLetterQueue", {
            fifo: true,
            encryption: QueueEncryption.SQS_MANAGED,
            retentionPeriod: Duration.days(14)
        })
        this.event_queue = new Queue(this, "EntityEventQueue", {
            fifo: true,
            encryption: QueueEncryption.SQS_MANAGED,
            contentBasedDeduplication: false,
            deduplicationScope: DeduplicationScope.MESSAGE_GROUP,
            fifoThroughputLimit: FifoThroughputLimit.PER_MESSAGE_GROUP_ID,
            visibilityTimeout: Duration.seconds(60),
            receiveMessageWaitTime: Duration.seconds(20),
            retentionPeriod: Duration.days(4),
            deadLetterQueue: {
                queue: event_dlq,
                maxReceiveCount: 20
            }
        })
        new Alarm(this, "EntityEventAgeAlarm", {
            metric: this.event_queue.metricApproximateAgeOfOldestMessage(),
            threshold: 60,
            evaluationPeriods: 3,
            datapointsToAlarm: 2,
            treatMissingData: TreatMissingData.NOT_BREACHING
        })
        new Alarm(this, "EntityEventDeadLetterAlarm", {
            metric: event_dlq.metricApproximateNumberOfMessagesVisible(),
            threshold: 1,
            evaluationPeriods: 1,
            treatMissingData: TreatMissingData.NOT_BREACHING
        })

        const federation_token = new Secret(this, "FederationRouterToken", {
            description: "Shared capability for Garnet's private federation resolver",
            generateSecretString: {
                excludePunctuation: true,
                passwordLength: 48
            }
        })
        const callback_token = new Secret(this, "SubscriptionCallbackToken", {
            description: "Capability for distributed Subscription callbacks",
            generateSecretString: {
                excludePunctuation: true,
                passwordLength: 48
            }
        })
        const common_environment = {
            DBHOST: props.database.clusterEndpoint.hostname,
            DBPORT: Token.asString(props.database.clusterEndpoint.port),
            DBNAME: garnet_constant.dbname,
            DB_POOL_MAX_REQUIRED: "true",
            DB_STATEMENT_TIMEOUT_MS: "10000",
            DB_MAX_PARALLEL_WORKERS_PER_GATHER: "0",
            DB_JIT: "off",
            AWS_REGION: Aws.REGION,
            CONTEXT_ALLOW_HOSTS: props.context_allow_hosts,
            CONTEXT_SOURCE_ID: "urn:ngsi-ld:ContextSource:garnet",
            CONTEXT_SOURCE_ALIAS: "garnet",
            SPLIT_ENTITIES_DEFAULT: "false"
        }
        const common_secrets = {
            DBUSER: EcsSecret.fromSecretsManager(
                props.database_secret,
                "username"
            ),
            DBPASS: EcsSecret.fromSecretsManager(
                props.database_secret,
                "password"
            )
        }

        const migration_log = new LogGroup(this, "MigrationLogs", {
            retention: RetentionDays.ONE_MONTH,
            removalPolicy: RemovalPolicy.DESTROY
        })
        const migration_task = new FargateTaskDefinition(
            this,
            "MigrationTaskDefinition",
            {
                family: "garnet-broker-migration",
                cpu: 512,
                memoryLimitMiB: 1024,
                runtimePlatform: {
                    cpuArchitecture: CpuArchitecture.ARM64,
                    operatingSystemFamily: OperatingSystemFamily.LINUX
                }
            }
        )
        migration_task.addContainer("MigrationContainer", {
            image,
            entryPoint: ["/garnet-migrate"],
            environment: {
                ...common_environment,
                DB_POOL_MAX: "1"
            },
            secrets: common_secrets,
            logging: LogDrivers.awsLogs({
                streamPrefix: "garnet/migration",
                logGroup: migration_log
            })
        })
        const migration = new GarnetMigration(this, "Migration", {
            cluster: this.cluster,
            task_definition: migration_task,
            vpc: props.vpc,
            security_group: this.sg_broker,
            release_id: props.image.split("@sha256:")[1]
        })

        const factory = new GarnetTaskFactory(this, "Services", {
            cluster: this.cluster,
            security_group: this.sg_broker,
            image,
            common_environment,
            common_secrets
        })
        const services: GarnetServiceResult[] = []
        const add = (service: GarnetServiceResult): GarnetServiceResult => {
            service.service.node.addDependency(migration.resource)
            services.push(service)
            return service
        }

        const federation = add(factory.create_service({
            id: "Federation",
            name: "federation",
            entry_point: "/garnet-federation",
            capacity: GARNET_SERVICE_CAPACITY.federation,
            environment: {
                PORT: "8080",
                FEDERATION_CONTROL_WAKEUP: "listen",
                FEDERATION_CONTROL_POLL_MS: "5000"
            },
            secrets: {
                FEDERATION_ROUTER_TOKEN:
                    EcsSecret.fromSecretsManager(federation_token)
            },
            port: {
                name: "federation",
                number: 8080,
                service_connect_server: true
            }
        }))

        const distributed_environment = {
            ENTITY_EVENT_TRANSPORT: "sqs-watermark",
            ENTITY_EVENT_WATERMARK_QUEUE_URL: this.event_queue.queueUrl,
            NOTIFICATION_DELIVERY_MODE: "external",
            PERIODIC_NOTIFICATION_MODE: "external",
            DISTRIBUTED_SUBSCRIPTION_RECONCILIATION_MODE: "external",
            FEDERATION_DEFAULT_LOCAL: "true",
            FEDERATION_ROUTER_URL: "http://federation:8080",
            FEDERATION_ROUTER_TIMEOUT_MS: "500",
            ...(
                props.public_origin.trim() === ""
                    ? {}
                    : {
                        BROKER_PUBLIC_ORIGIN: props.public_origin.trim(),
                        DISTRIBUTED_SUBSCRIPTION_PUBLIC_URL:
                            props.public_origin.trim()
                    }
            )
        }
        const distributed_secrets = {
            FEDERATION_ROUTER_TOKEN:
                EcsSecret.fromSecretsManager(federation_token),
            DISTRIBUTED_SUBSCRIPTION_CALLBACK_TOKEN:
                EcsSecret.fromSecretsManager(callback_token)
        }
        const api = add(factory.create_service({
            id: "Api",
            name: "api",
            entry_point: "/garnet-broker",
            capacity: GARNET_SERVICE_CAPACITY.api,
            environment: {
                ...distributed_environment,
                PORT: "8080",
                BROKER_WORKERS: "2",
                HTTP_MAX_IN_FLIGHT: "512",
                HTTP_MAX_REQUEST_BODY_BYTES: "134217728",
                SNAPSHOT_WORKERS: "0",
                APPLICATION_METRICS: "emf",
                APPLICATION_METRICS_NAMESPACE: "Garnet/Broker",
                APPLICATION_METRICS_SERVICE: "garnet-api",
                APPLICATION_METRICS_INTERVAL_MS: "60000",
                APPLICATION_METRICS_MAX_SERIES: "256"
            },
            secrets: distributed_secrets,
            port: {
                name: "api",
                number: 8080
            },
            service_connect_client: true,
            cpu_autoscaling: false
        }))
        api.service.node.addDependency(federation.service)

        const relay = add(factory.create_service({
            id: "Relay",
            name: "relay",
            entry_point: "/garnet-relay",
            capacity: GARNET_SERVICE_CAPACITY.relay,
            environment: {
                ENTITY_EVENT_TRANSPORT: "sqs-watermark",
                ENTITY_EVENT_WATERMARK_QUEUE_URL: this.event_queue.queueUrl
            }
        }))
        this.event_queue.grantSendMessages(relay.task_definition.taskRole)

        const matcher = add(factory.create_service({
            id: "Matcher",
            name: "matcher",
            entry_point: "/garnet-matcher",
            capacity: GARNET_SERVICE_CAPACITY.matcher,
            environment: {
                ENTITY_EVENT_TRANSPORT: "sqs-watermark",
                ENTITY_EVENT_WATERMARK_QUEUE_URL: this.event_queue.queueUrl,
                ENTITY_EVENT_SINKS: "garnet-lake"
            }
        }))
        matcher.service.node.addDependency(relay.service)
        this.event_queue.grantConsumeMessages(matcher.task_definition.taskRole)

        const sink = add(factory.create_service({
            id: "LakeSink",
            name: "lake-sink",
            entry_point: "/garnet-event-sink",
            capacity: GARNET_SERVICE_CAPACITY.sink,
            environment: {
                ENTITY_EVENT_SINK_NAME: "garnet-lake",
                ENTITY_EVENT_SINK_TRANSPORT: "firehose",
                ENTITY_EVENT_FIREHOSE_STREAM_NAME:
                    props.delivery_stream.deliveryStreamName!
            }
        }))
        sink.service.node.addDependency(matcher.service)
        sink.task_definition.taskRole.addToPrincipalPolicy(
            new PolicyStatement({
                actions: ["firehose:PutRecord", "firehose:PutRecordBatch"],
                resources: [props.delivery_stream.attrArn]
            })
        )

        add(factory.create_service({
            id: "Delivery",
            name: "delivery",
            entry_point: "/garnet-delivery",
            capacity: GARNET_SERVICE_CAPACITY.delivery,
            environment: {
                NOTIFICATION_DELIVERY_ALLOW_ORIGINS:
                    props.notification_delivery_allow_origins
            }
        }))
        add(factory.create_service({
            id: "Scheduler",
            name: "notification-scheduler",
            entry_point: "/garnet-notification-scheduler",
            capacity: GARNET_SERVICE_CAPACITY.scheduler
        }))
        add(factory.create_service({
            id: "Reconciler",
            name: "subscription-reconciler",
            entry_point: "/garnet-subscription-reconciler",
            capacity: GARNET_SERVICE_CAPACITY.reconciler,
            environment: distributed_environment,
            secrets: distributed_secrets
        }))
        add(factory.create_service({
            id: "Snapshot",
            name: "snapshot",
            entry_point: "/garnet-broker",
            capacity: GARNET_SERVICE_CAPACITY.snapshot,
            environment: {
                ...distributed_environment,
                PORT: "8080",
                BROKER_WORKERS: "1",
                HTTP_MAX_IN_FLIGHT: "16",
                SNAPSHOT_WORKERS: "2"
            },
            secrets: distributed_secrets,
            port: {
                name: "snapshot",
                number: 8080
            },
            service_connect_client: true
        }))

        const sg_alb = new SecurityGroup(this, "LoadBalancerSecurityGroup", {
            vpc: props.vpc,
            description: "Internal API Gateway VPC link to Garnet Broker",
            allowAllOutbound: true
        })
        sg_alb.addIngressRule(
            Peer.ipv4(props.vpc.vpcCidrBlock),
            Port.tcp(80),
            "HTTP from the Garnet VPC link"
        )
        this.sg_broker.addIngressRule(
            sg_alb,
            Port.tcp(8080),
            "ALB to Garnet API tasks"
        )
        this.fargate_alb = new ApplicationLoadBalancer(this, "LoadBalancer", {
            vpc: props.vpc,
            internetFacing: false,
            securityGroup: sg_alb,
            loadBalancerName: "garnet-broker-alb-garnet",
            idleTimeout: Duration.seconds(60),
            dropInvalidHeaderFields: true
        })
        const listener = this.fargate_alb.addListener("Listener", {
            port: 80,
            defaultAction: ListenerAction.fixedResponse(404)
        })
        const target_group: ApplicationTargetGroup = listener.addTargets(
            "ApiTarget",
            {
                targets: [api.service],
                port: 8080,
                protocol: ApplicationProtocol.HTTP,
                healthCheck: {
                    path: "/health",
                    port: "8080",
                    healthyHttpCodes: "200",
                    interval: Duration.seconds(30),
                    timeout: Duration.seconds(5)
                }
            }
        )
        target_group.setAttribute(
            "deregistration_delay.timeout_seconds",
            "30"
        )
        api.service
            .autoScaleTaskCount({
                minCapacity: GARNET_SERVICE_CAPACITY.api.min_tasks,
                maxCapacity: GARNET_SERVICE_CAPACITY.api.max_tasks
            })
            .scaleOnRequestCount("ApiRequestScaling", {
                requestsPerTarget: 750,
                targetGroup: target_group,
                scaleInCooldown: Duration.seconds(180),
                scaleOutCooldown: Duration.seconds(30)
            })

        const maintenance_log = new LogGroup(this, "MaintenanceLogs", {
            retention: RetentionDays.ONE_MONTH,
            removalPolicy: RemovalPolicy.DESTROY
        })
        const maintenance_task = new FargateTaskDefinition(
            this,
            "MaintenanceTaskDefinition",
            {
                family: "garnet-broker-maintenance",
                cpu: 512,
                memoryLimitMiB: 1024,
                runtimePlatform: {
                    cpuArchitecture: CpuArchitecture.ARM64,
                    operatingSystemFamily: OperatingSystemFamily.LINUX
                }
            }
        )
        maintenance_task.addContainer("MaintenanceContainer", {
            image,
            entryPoint: ["/garnet-maintenance"],
            environment: {
                ...common_environment,
                DB_POOL_MAX: "1"
            },
            secrets: common_secrets,
            logging: LogDrivers.awsLogs({
                streamPrefix: "garnet/maintenance",
                logGroup: maintenance_log
            })
        })
        const maintenance_rule = new Rule(this, "MaintenanceSchedule", {
            schedule: Schedule.cron({
                minute: "0",
                hour: "3"
            })
        })
        maintenance_rule.addTarget(new EcsTask({
            cluster: this.cluster,
            taskDefinition: maintenance_task,
            taskCount: 1,
            subnetSelection: {
                subnetType: SubnetType.PRIVATE_WITH_EGRESS
            },
            securityGroups: [this.sg_broker]
        }))
        maintenance_rule.node.addDependency(migration.resource)

        new Alarm(this, "ApiUnhealthyHostAlarm", {
            metric: target_group.metrics.unhealthyHostCount(),
            threshold: 1,
            evaluationPeriods: 3,
            datapointsToAlarm: 2,
            treatMissingData: TreatMissingData.NOT_BREACHING
        })

        // Keep the array live as an explicit inventory: every long-lived role above must depend on
        // the migration gate, including roles added later.
        if (services.length !== 9) {
            throw new Error("Garnet Broker runtime must define exactly nine services")
        }
    }
}
