// GARNET PARAMETERS
export const Parameters = {
    /**
     * Immutable Garnet Broker image, for example:
     * public.ecr.aws/example/garnet-broker@sha256:<64 hexadecimal characters>
     */
    garnet_broker_image: "539762775523.dkr.ecr.us-east-1.amazonaws.com/garnet-broker@sha256:f3a26990453705b916f7b151b6d3683203374f165e453af5f9dd580e3fbfa3ef",

    /**
     * Canary-only current-Entity request batching. The Broker keeps this path
     * disabled when max is 1. Four workers match the four writer connections
     * available to each of the two Broker processes in one API task.
     */
    entity_mutation_batch_max: 64,
    entity_mutation_batch_workers_per_process: 4,
    entity_mutation_batch_window_ms: 5,
    entity_mutation_batch_queue_max_per_process: 1024,
    entity_mutation_batch_diagnostics: true,

    /**
     * Required release declaration. "unchanged" verifies that the target image
     * needs no database migration. "backward-compatible" allows the migrator
     * to run while the previous task revision is still alive.
     */
    garnet_schema_compatibility: "unchanged" as
        "unchanged" | "backward-compatible",

    /**
     * Optional immutable load-runner image built from test/load/Dockerfile.
     * When set, the stack creates idle on-demand ECS task definitions and an
     * S3 evidence bucket; no load tasks run during deployment.
     */
    garnet_load_image: "539762775523.dkr.ecr.us-east-1.amazonaws.com/garnet-load@sha256:50bdf0ca189a8d09fa735b7f88391992f8163e3f2f1275236671c3dec1359047",

    /**
     * Public broker origin used for absolute EntityMap and distributed Subscription callback
     * URLs. Leave empty only for deployments that do not expose those distributed operations.
     */
    garnet_broker_public_origin: "",

    /**
     * Exact comma-separated HTTP(S) origins approved for notification delivery. An empty value
     * keeps outbound HTTP notification delivery deny-all.
     */
    garnet_notification_delivery_allow_origins: "",

    /**
     * Optional built-in connector that publishes NGSI-LD Subscription
     * notifications to AWS IoT Core MQTT. Disabled by default: the core
     * architecture creates no AWS IoT resources or registry synchronization.
     */
    aws_iot_core_mqtt_connector_enabled: false,

    /**
     * Comma-separated remote JSON-LD context hosts approved for this environment. Empty is the
     * secure deny-all default.
     */
    garnet_context_allow_hosts: "",

    /**
     * Route eligible current and temporal Entity reads to Aurora's reader endpoint.
     * This explicitly accepts replica lag; keep false for conformance and read-after-write users.
     */
    garnet_eventual_entity_reads: true,

    /**
     * Provision the read-only proxy with eventual reads, but move API traffic
     * only after the deployed /garnet-reader-probe validates the exact endpoint.
     */
    garnet_eventual_entity_read_route: "rds-proxy" as
        "aurora-reader" | "rds-proxy",

    /**
     * Keep a warm Aurora reader as a failover target. Eventual reads may also use
     * it, but ordinary strongly consistent reads continue to use the writer.
     * Disposable development deployments may disable it to remove one database
     * instance from the baseline cost.
     */
    database_reader_enabled: true,
    database_reader_count: 1,

    /**
     * Start at a cost-safe production floor and retain measured burst capacity.
     * Performance qualification may temporarily pre-warm this range, but the
     * committed profile must not leave that temporary floor active.
     */
    aurora_min_capacity: 2,
    aurora_max_capacity: 128,
    aurora_storage: "standard" as "standard" | "io-optimized",

    /**
     * ECS runs on ARM64 EC2 capacity rather than Fargate. CD resolves "auto"
     * to the newest available Graviton generation; this repository default is
     * the Graviton5 C9g profile available in us-east-1.
     */
    ecs_instance_type: "c9g.2xlarge",

    /**
     * Keep the final low-cost profile entirely on On-Demand EC2. Re-enable
     * Spot only when measured worker scale-out justifies a warm provider.
     */
    worker_spot_scale_out: false,

    /**
     * See regions in which you can deploy Garnet: 
     * https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-vpc-links.html#http-api-vpc-link-availability
    */
    aws_region: "us-east-1",  

    /**
     * Production uses one NAT gateway per Availability Zone. Set this to 1
     * only for disposable test environments that accept an egress AZ
     * dependency and cross-AZ traffic.
     */
    nat_gateway_count: 2 as 1 | 2,

    /**
     * Production data-safety defaults. Disable deletion protection only for a
     * disposable environment that is expected to be destroyed by CDK.
     */
    database_deletion_protection: true,
    database_backup_retention_days: 35,

    /**
     * Keep up to one year or 500 GiB of queryable Temporal history in Aurora,
     * whichever ceiling is reached first. Immutable Entity events continue to
     * the Iceberg lake for long-term analytics.
     */
    temporal_history_retention_days: 365,
    temporal_history_retention_max_gib: 500,
    temporal_history_retention_max_partitions: 12,

    /**
     * Blue/green is the production default for the externally routed API.
     * Workers still use rolling updates with ECS circuit breakers because two
     * concurrent consumer revisions would not isolate side effects.
     */
    deployment_strategy: "bluegreen" as "rolling" | "bluegreen",

    /**
     * How long the previous task set is retained after traffic shifts, giving you a
     * window to roll back without redeploying. Blue/green only. Both task sets run
     * (and bill) for this duration.
     */
    deployment_bake_time_minutes: 10,

    /**
     * Port on the internal ALB that routes to the new task set before traffic shifts,
     * so it can be validated in place. Blue/green only, never internet facing.
     */
    deployment_test_listener_port: 8080,

    /**
     * Explicit runbook-only assembly for an authorization policy cutover.
     * It stops only the five authorization executors and lowers their
     * autoscaling minima to zero. Never leave this enabled after cutover.
     */
    garnet_authorization_cutover_stopped: false,

    /** Exact external OpenID Connect issuer accepted end-to-end. */
    garnet_oidc_issuer: "https://cognito-idp.eu-west-1.amazonaws.com/eu-west-1_AqETShPTz",

    /** Comma-separated OAuth audience values accepted by API Gateway and Broker. */
    garnet_oidc_audiences: "bft0on5hj7tp0benss55ars6n",

    /** Claim containing one tenant or a tenant array when the IdP supplies it. */
    garnet_oidc_tenant_claim: "garnet_tenants",

    /** Stable `sub` of the initial tenant administrator in the external IdP. */
    garnet_bootstrap_admin_subject: "82b50474-8021-706f-627f-cdc5632dc664",

    /** Optional complete Secrets Manager ARN with `username` and `password`. */
    garnet_load_oidc_secret_arn: "",

    /** Optional OIDC `sub` granted load-only read and Entity mutation access. */
    garnet_load_oidc_subject: "",

    /** Cognito app-client identifier used by the renewable load credential. */
    garnet_load_oidc_client_id: "",

    /**
     * Optional JSON arrays of custom policy documents and additional exact
     * principal bindings. Broker validates and freezes both before listening.
     */
    garnet_authorization_policies: "[]",
    garnet_authorization_bindings: "[]",

    /** Tenant receiving the initial TenantAdministrator attachment. */
    garnet_bootstrap_tenant: "default",
}
