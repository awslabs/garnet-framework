// GARNET PARAMETERS
export const Parameters = {
    /**
     * Immutable Garnet Broker image, for example:
     * public.ecr.aws/example/garnet-broker@sha256:<64 hexadecimal characters>
     */
    garnet_broker_image: "",

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
    garnet_load_image: "",

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
     * Comma-separated remote JSON-LD context hosts approved for this environment. Empty is the
     * secure deny-all default.
     */
    garnet_context_allow_hosts: "",

    /**
     * Route eligible current and temporal Entity reads to Aurora's reader endpoint.
     * This explicitly accepts replica lag; keep false for conformance and read-after-write users.
     */
    garnet_eventual_entity_reads: false,

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
     * Tenant bound to the bootstrap API credential stored in Secrets Manager.
     * Production tenant onboarding should issue one tenant-scoped credential
     * per client rather than sharing this bootstrap credential.
     */
    garnet_bootstrap_tenant: "default",

    // API Authorization
    authorization: true
}
