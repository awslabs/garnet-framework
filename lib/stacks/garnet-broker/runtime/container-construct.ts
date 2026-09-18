import {
    Annotations,
    Arn,
    Aws,
    Duration,
    RemovalPolicy,
    Token
} from "aws-cdk-lib"
import { CfnScalingPolicy } from
    "aws-cdk-lib/aws-applicationautoscaling"
import { Alarm, TreatMissingData } from "aws-cdk-lib/aws-cloudwatch"
import {
    Port,
    SecurityGroup,
    SubnetType,
    Vpc
} from "aws-cdk-lib/aws-ec2"
import {
    AlternateTarget,
    Cluster,
    Compatibility,
    ContainerImage,
    ContainerInsights,
    DeploymentStrategy,
    ListenerRuleConfiguration,
    LogDrivers,
    NetworkMode,
    Secret as EcsSecret,
    TaskDefinition
} from "aws-cdk-lib/aws-ecs"
import {
    ApplicationListenerRule,
    ApplicationLoadBalancer,
    ApplicationProtocol,
    ApplicationTargetGroup,
    ListenerAction,
    ListenerCondition,
    TargetType
} from "aws-cdk-lib/aws-elasticloadbalancingv2"
import { Rule, Schedule } from "aws-cdk-lib/aws-events"
import { EcsTask } from "aws-cdk-lib/aws-events-targets"
import { PolicyStatement } from "aws-cdk-lib/aws-iam"
import { Repository } from "aws-cdk-lib/aws-ecr"
import { CfnDeliveryStream } from "aws-cdk-lib/aws-kinesisfirehose"
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs"
import { DatabaseCluster } from "aws-cdk-lib/aws-rds"
import { ISecret, Secret } from "aws-cdk-lib/aws-secretsmanager"
import { Construct } from "constructs"
import {
    DEPLOYMENT_STRATEGY,
    deployment_params
} from "../../../../architecture"
import {
    garnet_broker_connector_role_names,
    garnet_constant,
    garnet_resource_name,
    garnet_sigv4_server_id,
    garnet_sts_endpoint
} from "../../../../constants"
import { GarnetMigration } from "../migration/migration-construct"
import { GarnetLoad } from "../load/load-construct"
import {
    GARNET_API_REQUESTS_PER_TARGET_MINUTE,
    GARNET_SERVICE_CAPACITY
} from "./runtime-profile"
import { scale_on_matcher_partitions } from "./matcher-scaling"
import { scale_on_worker_utilization } from "./worker-scaling"
import { GarnetApiDeploymentGuard } from "./api-deployment-guard"
import {
    GarnetServiceResult,
    GarnetTaskFactory
} from "./task-factory"
import { add_garnet_compute_capacity } from "./compute-capacity"

export interface GarnetBrokerRuntimeProps {
    vpc: Vpc
    database: DatabaseCluster
    database_secret: ISecret
    federation_state_host: string
    federation_state_port: number
    federation_state_secret: Secret
    eventual_entity_reads: boolean
    delivery_stream: CfnDeliveryStream
    image: string
    load_image: string
    public_origin: string
    notification_delivery_allow_origins: string
    private_notification_origin: string
    context_allow_hosts: string
    oidc_issuer: string
    oidc_audiences: string
    oidc_tenant_claim: string
    bootstrap_admin_subject: string
    bootstrap_tenant: string
    authorization_policies: string
    authorization_bindings: string
    temporal_history_retention_days: number
    temporal_history_retention_max_gib: number
    temporal_history_retention_max_partitions: number
}

const private_ecr_image = (
    scope: Construct,
    reference: string
): ContainerImage | undefined => {
    const match = /^(\d{12})\.dkr\.ecr\.([a-z0-9-]+)\.(?:amazonaws\.com(?:\.cn)?)\/([^@]+)@sha256:([0-9a-f]{64})$/
        .exec(reference)
    if (match === null) return undefined

    const [, account, region, repository_name, digest] = match
    const partition = region!.startsWith("cn-")
        ? "aws-cn"
        : region!.startsWith("us-gov-")
            ? "aws-us-gov"
            : region!.startsWith("us-iso-")
                ? "aws-iso"
                : region!.startsWith("us-isob-")
                    ? "aws-iso-b"
                    : "aws"
    const repository = Repository.fromRepositoryAttributes(
        scope,
        "BrokerImageRepository",
        {
            repositoryName: repository_name!,
            repositoryArn: Arn.format({
                partition,
                service: "ecr",
                region,
                account,
                resource: "repository",
                resourceName: repository_name
            })
        }
    )
    return ContainerImage.fromEcrRepository(
        repository,
        `sha256:${digest}`
    )
}

const request_count_per_target_metric = (
    id: string,
    target: ApplicationTargetGroup
): CfnScalingPolicy.TargetTrackingMetricDataQueryProperty => ({
    id,
    returnData: false,
    metricStat: {
        metric: {
            namespace: "AWS/ApplicationELB",
            metricName: "RequestCountPerTarget",
            dimensions: [
                {
                    name: "LoadBalancer",
                    value: target.firstLoadBalancerFullName
                },
                {
                    name: "TargetGroup",
                    value: target.targetGroupFullName
                }
            ]
        },
        stat: "Sum"
    }
})

export class GarnetBrokerRuntime extends Construct {
    public readonly broker_alb: ApplicationLoadBalancer
    public readonly sg_broker: SecurityGroup
    public readonly cluster: Cluster
    public readonly load?: GarnetLoad

    constructor(scope: Construct, id: string, props: GarnetBrokerRuntimeProps) {
        super(scope, id)

        if (!/^[^@\s]+@sha256:[0-9a-f]{64}$/.test(props.image)) {
            throw new Error(
                "Garnet Broker image must be immutable and digest-pinned"
            )
        }
        const oidc_issuer = new URL(props.oidc_issuer)
        if (
            oidc_issuer.protocol !== "https:" ||
            oidc_issuer.username !== "" ||
            oidc_issuer.password !== "" ||
            oidc_issuer.search !== "" ||
            oidc_issuer.hash !== ""
        ) {
            throw new Error("Garnet OIDC issuer must be an exact HTTPS URL")
        }
        const oidc_audiences = props.oidc_audiences
            .split(",")
            .map((audience) => audience.trim())
            .filter((audience) => audience !== "")
        if (oidc_audiences.length === 0) {
            throw new Error("Garnet OIDC audiences cannot be empty")
        }
        const configured_bindings = JSON.parse(
            props.authorization_bindings
        ) as unknown
        if (!Array.isArray(configured_bindings)) {
            throw new Error(
                "Garnet authorization bindings must be a JSON array"
            )
        }
        const configured_policies = JSON.parse(
            props.authorization_policies
        ) as unknown
        if (!Array.isArray(configured_policies)) {
            throw new Error(
                "Garnet authorization policies must be a JSON array"
            )
        }

        const image =
            private_ecr_image(this, props.image) ??
            ContainerImage.fromRegistry(props.image)
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
            clusterName: garnet_resource_name("broker-cluster"),
            containerInsightsV2: ContainerInsights.ENHANCED,
            defaultCloudMapNamespace: {
                name: "garnet-framework.local"
            }
        })
        const compute = add_garnet_compute_capacity(
            this,
            this.cluster,
            props.vpc,
            deployment_params.ecs_instance_type
        )

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
            // Non-HTTP worker binaries have no caller boundary. The API task
            // overrides this with OIDC plus workload SigV4 below.
            AUTH_MODE: "none",
            DBHOST: props.database.clusterEndpoint.hostname,
            DBPORT: Token.asString(props.database.clusterEndpoint.port),
            DBNAME: garnet_constant.dbname,
            DBSSL: "require",
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
        const migration_task = new TaskDefinition(
            this,
            "MigrationTaskDefinition",
            {
                family: garnet_resource_name("broker-migration"),
                compatibility: Compatibility.EC2,
                networkMode: NetworkMode.AWS_VPC,
                cpu: "512",
                memoryMiB: "1024"
            }
        )
        migration_task.addContainer("MigrationContainer", {
            image,
            entryPoint: ["/garnet-migrate"],
            environment: {
                ...common_environment,
                DB_POOL_MAX: "1",
                DB_MIGRATION_MODE: "apply"
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
            capacity_provider: compute.on_demand.capacityProviderName,
            vpc: props.vpc,
            security_group: this.sg_broker,
            release_id: props.image.split("@sha256:")[1],
            schema_compatibility:
                deployment_params.schema_compatibility
        })

        const factory = new GarnetTaskFactory(this, "Services", {
            cluster: this.cluster,
            security_group: this.sg_broker,
            image,
            common_environment,
            common_secrets,
            on_demand_capacity_provider:
                compute.on_demand.capacityProviderName,
            spot_capacity_provider:
                compute.spot.capacityProviderName,
            worker_spot_scale_out:
                deployment_params.worker_spot_scale_out
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
            ENTITY_EVENT_TRANSPORT: "postgres",
            ENTITY_EVENT_MATCHER_MODE: "external",
            FEDERATION_STATE_HOST: props.federation_state_host,
            FEDERATION_STATE_PORT: String(props.federation_state_port),
            FEDERATION_STATE_TLS: "true",
            FEDERATION_STATE_PREFIX: "garnet:federation:v1",
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
                EcsSecret.fromSecretsManager(callback_token),
            FEDERATION_STATE_PASSWORD:
                EcsSecret.fromSecretsManager(
                    props.federation_state_secret
                )
        }
        const blue_green =
            deployment_params.deployment_strategy ===
                DEPLOYMENT_STRATEGY.BlueGreen
        const sigv4_server_id = garnet_sigv4_server_id
        const sts_endpoint = garnet_sts_endpoint
        const api = add(factory.create_service({
            id: "Api",
            name: "api",
            entry_point: "/garnet-broker",
            capacity: GARNET_SERVICE_CAPACITY.api,
            environment: {
                ...distributed_environment,
                AUTH_MODE: "oidc+sigv4",
                AUTHORIZATION_MODE: "policy",
                AUTH_OIDC_ISSUERS: oidc_issuer.href.replace(/\/$/, ""),
                AUTH_OIDC_AUDIENCES: oidc_audiences.join(","),
                AUTH_OIDC_TENANT_CLAIM: props.oidc_tenant_claim,
                AUTH_OIDC_TENANT_GRANTS: JSON.stringify({
                    [props.bootstrap_admin_subject]: [
                        props.bootstrap_tenant
                    ]
                }),
                AUTH_SIGV4_SERVER_ID: sigv4_server_id,
                AUTH_SIGV4_STS_ENDPOINT: sts_endpoint,
                AUTHORIZATION_POLICIES:
                    JSON.stringify(configured_policies),
                PORT: "8080",
                BROKER_WORKERS: "2",
                ...(
                    props.eventual_entity_reads
                        ? {
                            READ_DBHOST:
                                props.database.clusterReadEndpoint.hostname,
                            READ_CONSISTENCY: "eventual",
                            READ_DB_POOL_MAX: String(
                                GARNET_SERVICE_CAPACITY.api
                                    .reader_database_pool
                            )
                        }
                        : {}
                ),
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
            cpu_autoscaling: blue_green,
            deployment_strategy: blue_green
                ? DeploymentStrategy.BLUE_GREEN
                : undefined,
            bake_time: blue_green
                ? Duration.minutes(
                    deployment_params.deployment_bake_time_minutes
                )
                : undefined
        }))
        api.service.node.addDependency(federation.service)
        if (blue_green) {
            Annotations.of(api.service).acknowledgeWarning(
                "@aws-cdk/aws-ecs:shouldUseCircuitBreaker",
                "ECS blue/green uses deployment alarms with rollback; " +
                    "the rolling deployment circuit breaker is inapplicable."
            )
        }

        const matcher = add(factory.create_service({
            id: "Matcher",
            name: "matcher",
            entry_point: "/garnet-matcher",
            capacity: GARNET_SERVICE_CAPACITY.matcher,
            cpu_autoscaling: false,
            interruption_tolerant: true,
            environment: {
                ENTITY_EVENT_TRANSPORT: "postgres",
                ENTITY_EVENT_POSTGRES_CLAIM_BATCH: "64",
                ENTITY_EVENT_POSTGRES_LEASE_MS: "60000",
                ENTITY_EVENT_POSTGRES_HEARTBEAT_MS: "5000",
                ENTITY_EVENT_POSTGRES_WORKER_STALE_MS: "15000",
                ENTITY_EVENT_POSTGRES_IDLE_MAX_MS: "500",
                ENTITY_EVENT_POSTGRES_MAX_ATTEMPTS: "20",
                ENTITY_EVENT_SINKS: "garnet-lake",
                WORKER_METRICS: "emf",
                WORKER_METRICS_NAMESPACE: "Garnet/Broker",
                WORKER_METRICS_SERVICE: "garnet-matcher",
                WORKER_METRICS_INTERVAL_MS: "60000"
            }
        }))
        if (matcher.scaling === undefined) {
            throw new Error("Garnet matcher requires task-count scaling")
        }
        scale_on_matcher_partitions({
            scope: this,
            id: "MatcherPartitionScaling",
            scaling: matcher.scaling,
            target_pending_partitions_per_worker: 4
        })

        const sink = add(factory.create_service({
            id: "LakeSink",
            name: "lake-sink",
            entry_point: "/garnet-event-sink",
            capacity: GARNET_SERVICE_CAPACITY.sink,
            interruption_tolerant: true,
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

        const notification_origins = [
            ...props.notification_delivery_allow_origins
                .split(",")
                .map((origin) => origin.trim())
                .filter((origin) => origin !== ""),
            props.private_notification_origin
        ]
        const delivery = add(factory.create_service({
            id: "Delivery",
            name: "delivery",
            entry_point: "/garnet-delivery",
            capacity: GARNET_SERVICE_CAPACITY.delivery,
            interruption_tolerant: true,
            environment: {
                NOTIFICATION_DELIVERY_ALLOW_ORIGINS:
                    [...new Set(notification_origins)].join(","),
                WORKER_METRICS: "emf",
                WORKER_METRICS_NAMESPACE: "Garnet/Broker",
                WORKER_METRICS_SERVICE: "garnet-delivery",
                WORKER_METRICS_INTERVAL_MS: "60000"
            }
        }))
        if (delivery.scaling === undefined) {
            throw new Error("Garnet delivery requires task-count scaling")
        }
        scale_on_worker_utilization({
            id: "DeliveryUtilizationScaling",
            scaling: delivery.scaling,
            service_name: "garnet-delivery",
            target_utilization_percent: 70
        })
        add(factory.create_service({
            id: "Scheduler",
            name: "notification-scheduler",
            entry_point: "/garnet-notification-scheduler",
            capacity: GARNET_SERVICE_CAPACITY.scheduler,
            interruption_tolerant: true
        }))
        const reconciler = add(factory.create_service({
            id: "Reconciler",
            name: "subscription-reconciler",
            entry_point: "/garnet-subscription-reconciler",
            capacity: GARNET_SERVICE_CAPACITY.reconciler,
            environment: {
                ...distributed_environment,
                WORKER_METRICS: "emf",
                WORKER_METRICS_NAMESPACE: "Garnet/Broker",
                WORKER_METRICS_SERVICE:
                    "garnet-subscription-planner",
                WORKER_METRICS_INTERVAL_MS: "60000"
            },
            secrets: distributed_secrets,
            cpu_autoscaling: false,
            interruption_tolerant: true
        }))
        if (reconciler.scaling === undefined) {
            throw new Error(
                "Garnet subscription reconciler requires task-count scaling"
            )
        }
        scale_on_worker_utilization({
            id: "ReconcilerUtilizationScaling",
            scaling: reconciler.scaling,
            service_name: "garnet-subscription-planner",
            target_utilization_percent: 70
        })
        const sg_alb = new SecurityGroup(this, "LoadBalancerSecurityGroup", {
            vpc: props.vpc,
            description: "Internal API Gateway VPC link to Garnet Broker",
            allowAllOutbound: true
        })
        this.sg_broker.addIngressRule(
            sg_alb,
            Port.tcp(8080),
            "ALB to Garnet API tasks"
        )
        this.broker_alb = new ApplicationLoadBalancer(this, "LoadBalancer", {
            vpc: props.vpc,
            internetFacing: false,
            securityGroup: sg_alb,
            loadBalancerName: garnet_resource_name("broker-alb"),
            idleTimeout: Duration.seconds(60),
            dropInvalidHeaderFields: true
        })
        const production_target = new ApplicationTargetGroup(
            this,
            "ApiProductionTarget",
            {
                vpc: props.vpc,
                port: 8080,
                protocol: ApplicationProtocol.HTTP,
                targetType: TargetType.IP,
                healthCheck: {
                    path: "/health",
                    port: "8080",
                    healthyHttpCodes: "200",
                    interval: Duration.seconds(30),
                    timeout: Duration.seconds(5)
                }
            }
        )
        production_target.setAttribute(
            "deregistration_delay.timeout_seconds",
            "30"
        )
        const production_listener = this.broker_alb.addListener(
            "ProductionListener",
            {
            port: 80,
                defaultAction: ListenerAction.fixedResponse(404, {
                    messageBody: "Not Found"
                })
            }
        )
        const production_rule = new ApplicationListenerRule(
            this,
            "ProductionRule",
            {
                listener: production_listener,
                priority: 1,
                conditions: [ListenerCondition.pathPatterns(["/*"])],
                targetGroups: [production_target]
            }
        )
        let alternate_target: ApplicationTargetGroup | undefined
        if (blue_green) {
            alternate_target = new ApplicationTargetGroup(
                this,
                "ApiTestTarget",
                {
                    vpc: props.vpc,
                    port: 8080,
                    protocol: ApplicationProtocol.HTTP,
                    targetType: TargetType.IP,
                    healthCheck: {
                        path: "/health",
                        port: "8080",
                        healthyHttpCodes: "200",
                        interval: Duration.seconds(30),
                        timeout: Duration.seconds(5)
                    },
                    deregistrationDelay: Duration.seconds(30)
                }
            )
            const test_listener = this.broker_alb.addListener(
                "TestListener",
                {
                    port:
                        deployment_params.deployment_test_listener_port,
                    defaultAction: ListenerAction.fixedResponse(404, {
                        messageBody: "Not Found"
                    })
                }
            )
            const test_rule = new ApplicationListenerRule(
                this,
                "TestRule",
                {
                    listener: test_listener,
                    priority: 1,
                    conditions: [ListenerCondition.pathPatterns(["/*"])],
                    targetGroups: [alternate_target]
                }
            )
            production_target.addTarget(
                api.service.loadBalancerTarget({
                    containerName: "garnet-api",
                    containerPort: 8080,
                    alternateTarget: new AlternateTarget(
                        "ApiAlternateTarget",
                        {
                            alternateTargetGroup: alternate_target,
                            productionListener:
                                ListenerRuleConfiguration
                                    .applicationListenerRule(
                                        production_rule
                                    ),
                            testListener:
                                ListenerRuleConfiguration
                                    .applicationListenerRule(test_rule)
                        }
                    )
                })
            )
            new GarnetApiDeploymentGuard(
                this,
                "ApiDeploymentGuard",
                {
                    vpc: props.vpc,
                    service: api.service,
                    load_balancer: this.broker_alb,
                    load_balancer_security_group: sg_alb,
                    test_listener_port:
                        deployment_params
                            .deployment_test_listener_port,
                    production_target,
                    test_target: alternate_target
                }
            )
        } else {
            production_target.addTarget(
                api.service.loadBalancerTarget({
                    containerName: "garnet-api",
                    containerPort: 8080
                })
            )
        }

        sg_alb.addIngressRule(
            this.sg_broker,
            Port.tcp(80),
            "Snapshot workers to the production API listener"
        )
        const snapshot = add(factory.create_service({
            id: "Snapshot",
            name: "snapshot",
            entry_point: "/garnet-snapshot",
            capacity: GARNET_SERVICE_CAPACITY.snapshot,
            cpu_autoscaling: false,
            interruption_tolerant: true,
            environment: {
                FEDERATION_DEFAULT_LOCAL:
                    distributed_environment.FEDERATION_DEFAULT_LOCAL,
                SNAPSHOT_BROKER_URL:
                    `http://${this.broker_alb.loadBalancerDnsName}`,
                SNAPSHOT_BROKER_AUTH_MODE: "sigv4",
                SNAPSHOT_BROKER_SIGV4_SERVER_ID:
                    sigv4_server_id,
                SNAPSHOT_STS_ENDPOINT: sts_endpoint,
                SNAPSHOT_QUERY_MAX_ATTEMPTS: "4",
                SNAPSHOT_QUERY_RETRY_BASE_MS: "250",
                SNAPSHOT_QUERY_RETRY_MAX_MS: "5000",
                SNAPSHOT_QUERY_TIMEOUT_MS: "30000",
                SNAPSHOT_WORKERS: "2",
                WORKER_METRICS: "emf",
                WORKER_METRICS_NAMESPACE: "Garnet/Broker",
                WORKER_METRICS_SERVICE: "garnet-snapshot",
                WORKER_METRICS_INTERVAL_MS: "60000"
            }
        }))
        const snapshot_principal =
            `arn:${Aws.PARTITION}:sts::${Aws.ACCOUNT_ID}:assumed-role/` +
            snapshot.task_definition.taskRole.roleName
        const connector_principals =
            garnet_broker_connector_role_names.map((role_name) =>
                `arn:${Aws.PARTITION}:sts::${Aws.ACCOUNT_ID}:` +
                `assumed-role/${role_name}`
            )
        const bootstrap_principal =
            `${oidc_issuer.href.replace(/\/$/, "")}#` +
            encodeURIComponent(props.bootstrap_admin_subject)
        const sigv4_tenant_grants: Record<string, string[]> = {
            [snapshot_principal]: [props.bootstrap_tenant],
            ...Object.fromEntries(
                connector_principals.map((principal) => [
                    principal,
                    [props.bootstrap_tenant]
                ])
            )
        }
        const authorization_bindings: unknown[] = [
            {
                principalKind: "oidc",
                principalId: bootstrap_principal,
                tenant: props.bootstrap_tenant,
                policies: [{
                    identifier:
                        "arn:garnet:authorization::garnet:" +
                        "managed-policy/TenantAdministrator",
                    version: "v1"
                }]
            },
            {
                principalKind: "sigv4",
                principalId: snapshot_principal,
                tenant: props.bootstrap_tenant,
                policies: [{
                    identifier:
                        "arn:garnet:authorization::garnet:" +
                        "managed-policy/TenantReadOnly",
                    version: "v1"
                }]
            },
            ...connector_principals.map((principal) => ({
                principalKind: "sigv4",
                principalId: principal,
                tenant: props.bootstrap_tenant,
                policies: [{
                    identifier:
                        "arn:garnet:authorization::garnet:" +
                        "managed-policy/TenantEntityEditor",
                    version: "v1"
                }]
            })),
            ...configured_bindings
        ]
        snapshot.service.node.addDependency(api.service)
        if (snapshot.scaling === undefined) {
            throw new Error("Garnet snapshot requires task-count scaling")
        }
        scale_on_worker_utilization({
            id: "SnapshotUtilizationScaling",
            scaling: snapshot.scaling,
            service_name: "garnet-snapshot",
            target_utilization_percent: 70
        })

        if (props.load_image.trim() !== "") {
            this.load = new GarnetLoad(this, "Load", {
                vpc: props.vpc,
                cluster: this.cluster,
                database: props.database,
                database_secret: props.database_secret,
                broker_origin: this.broker_alb.loadBalancerDnsName,
                broker_image: props.image,
                load_image: props.load_image,
                tenant: props.bootstrap_tenant,
                sigv4_server_id,
                sts_endpoint,
                capacity_provider:
                    compute.on_demand.capacityProviderName
            })
            const load_principal =
                `arn:${Aws.PARTITION}:sts::${Aws.ACCOUNT_ID}:assumed-role/` +
                this.load.generator_task.taskRole.roleName
            sigv4_tenant_grants[load_principal] = [
                props.bootstrap_tenant
            ]
            authorization_bindings.push({
                principalKind: "sigv4",
                principalId: load_principal,
                tenant: props.bootstrap_tenant,
                policies: [{
                    identifier:
                        "arn:garnet:authorization::garnet:" +
                        "managed-policy/TenantAdministrator",
                    version: "v1"
                }]
            })
        }
        api.container.addEnvironment(
            "AUTH_SIGV4_TENANT_GRANTS",
            JSON.stringify(sigv4_tenant_grants)
        )
        api.container.addEnvironment(
            "AUTHORIZATION_BINDINGS",
            JSON.stringify(authorization_bindings)
        )

        if (api.scaling === undefined) {
            throw new Error("Garnet API requires task-count scaling")
        }
        if (alternate_target === undefined) {
            api.scaling.scaleOnRequestCount("ApiRequestScaling", {
                // ALBRequestCountPerTarget is measured over one minute.
                requestsPerTarget:
                    GARNET_API_REQUESTS_PER_TARGET_MINUTE,
                targetGroup: production_target,
                scaleInCooldown: Duration.seconds(180),
                scaleOutCooldown: Duration.seconds(30)
            })
        } else {
            const target = api.scaling.scalableTargetRef
            new CfnScalingPolicy(
                this,
                "ApiBlueGreenRequestScaling",
                {
                    policyName: garnet_resource_name(
                        "api-bluegreen-request-scaling"
                    ),
                    policyType: "TargetTrackingScaling",
                    resourceId: target.resourceId,
                    scalableDimension: target.scalableDimension,
                    serviceNamespace: target.serviceNamespace,
                    targetTrackingScalingPolicyConfiguration: {
                        targetValue:
                            GARNET_API_REQUESTS_PER_TARGET_MINUTE,
                        scaleInCooldown: 180,
                        scaleOutCooldown: 30,
                        customizedMetricSpecification: {
                            metrics: [
                                {
                                    id: "requests_per_target",
                                    expression:
                                        "FILL(production_requests_per_target, 0) + " +
                                        "FILL(alternate_requests_per_target, 0)",
                                    label:
                                        "Garnet API requests per active target",
                                    returnData: true
                                },
                                request_count_per_target_metric(
                                    "production_requests_per_target",
                                    production_target
                                ),
                                request_count_per_target_metric(
                                    "alternate_requests_per_target",
                                    alternate_target
                                )
                            ]
                        }
                    }
                }
            )
        }

        const maintenance_log = new LogGroup(this, "MaintenanceLogs", {
            retention: RetentionDays.ONE_MONTH,
            removalPolicy: RemovalPolicy.DESTROY
        })
        const maintenance_task = new TaskDefinition(
            this,
            "MaintenanceTaskDefinition",
            {
                family: garnet_resource_name("broker-maintenance"),
                compatibility: Compatibility.EC2,
                networkMode: NetworkMode.AWS_VPC,
                cpu: "512",
                memoryMiB: "1024"
            }
        )
        maintenance_task.addContainer("MaintenanceContainer", {
            image,
            entryPoint: ["/garnet-maintenance"],
            environment: {
                ...common_environment,
                DB_POOL_MAX: "1",
                TEMPORAL_HISTORY_RETENTION_DAYS:
                    String(props.temporal_history_retention_days),
                TEMPORAL_HISTORY_RETENTION_MAX_GIB:
                    String(props.temporal_history_retention_max_gib),
                TEMPORAL_HISTORY_RETENTION_MAX_PARTITIONS:
                    String(
                        props.temporal_history_retention_max_partitions
                    )
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
            metric: production_target.metrics.unhealthyHostCount(),
            threshold: 1,
            evaluationPeriods: 3,
            datapointsToAlarm: 2,
            treatMissingData: TreatMissingData.NOT_BREACHING
        })

        // Keep the array live as an explicit inventory: every long-lived role above must depend on
        // the migration gate, including roles added later.
        if (services.length !== 8) {
            throw new Error("Garnet Broker runtime must define exactly eight services")
        }
    }
}
