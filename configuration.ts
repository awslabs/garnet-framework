import { ARCHITECTURE, DEPLOYMENT_STRATEGY } from "./architecture"
import { BROKER_ENGINE } from "./broker-engine"

// GARNET PARAMETERS
export const Parameters = {
    /**
     * Context broker implementation.
     *
     * Scorpio remains the default until Garnet's AWS soak and release comparison gates pass.
     * Garnet uses the distributed architecture and requires a digest-pinned multi-architecture
     * image below.
     */
    broker_engine: BROKER_ENGINE.Scorpio,

    /**
     * Immutable Garnet Broker image, for example:
     * public.ecr.aws/example/garnet-broker@sha256:<64 hexadecimal characters>
     */
    garnet_broker_image: "",

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
     * Choose between Concentrated (single container) or Distributed (microservices) architecture.
     * You can fine-tune the deployment parameters in architecture.ts
     * - Concentrated: All services in one container, suitable for development and testing
     * - Distributed: 8 specialized m
     * icroservices, recommended for production deployments
    */
    architecture: ARCHITECTURE.Concentrated,

    /**
     * How the broker services are rolled out.
     * - Rolling (default): tasks are replaced in place. A failing deployment is
     *   detected by the circuit breaker and rolled back automatically.
     * - BlueGreen: a second task set is started alongside the current one. You can
     *   validate it on the test listener (see deployment_test_listener_port) before
     *   any production traffic moves, then traffic shifts and the old task set is
     *   kept for deployment_bake_time_minutes so rollback is near-instant.
     *
     * IMPORTANT: both task sets share a single Aurora cluster. Use Rolling for any
     * Scorpio release that carries a database schema migration, because rolling back
     * to the previous task set would leave it running against a migrated schema.
     * See DEPLOYMENT.md for the full trade-off.
     */
    deployment_strategy: DEPLOYMENT_STRATEGY.Rolling,

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

    // API Authorization
    authorization: true
}
