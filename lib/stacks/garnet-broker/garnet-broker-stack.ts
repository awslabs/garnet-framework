import { CfnOutput, NestedStack, NestedStackProps } from "aws-cdk-lib"
import { Vpc } from "aws-cdk-lib/aws-ec2"
import { ApplicationLoadBalancer } from "aws-cdk-lib/aws-elasticloadbalancingv2"
import { CfnDeliveryStream } from "aws-cdk-lib/aws-kinesisfirehose"
import { Secret } from "aws-cdk-lib/aws-secretsmanager"
import { Construct } from "constructs"
import { deployment_params } from "../../../architecture"
import { GarnetBrokerDatabase } from "./database/database-construct"
import { GarnetFederationState } from "./federation-state/federation-state-construct"
import { GarnetBrokerRuntime } from "./runtime/container-construct"
import { GarnetLoad } from "./load/load-construct"

export interface GarnetBrokerProps extends NestedStackProps {
    vpc: Vpc
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
    load_oidc_secret_arn?: string
    load_oidc_subject?: string
    load_oidc_client_id?: string
    authorization_cutover_stopped?: boolean
    bootstrap_tenant: string
    authorization_policies: string
    authorization_bindings: string
    eventual_entity_reads: boolean
    eventual_entity_read_route: "aurora-reader" | "rds-proxy"
    temporal_history_retention_days: number
    temporal_history_retention_max_gib: number
    temporal_history_retention_max_partitions: number
}

export class GarnetBroker extends NestedStack {
    public readonly dns_context_broker: string
    public readonly broker_alb: ApplicationLoadBalancer
    public readonly load?: GarnetLoad
    public readonly cluster_name: string
    public readonly database_cluster_identifier: string
    public readonly authorization_configuration_digest: string

    constructor(scope: Construct, id: string, props: GarnetBrokerProps) {
        super(scope, id, props)

        if (
            props.eventual_entity_reads &&
            !deployment_params.database_reader_enabled
        ) {
            throw new Error(
                "Eventual Entity reads require an Aurora reader"
            )
        }
        if (
            !props.eventual_entity_reads &&
            props.eventual_entity_read_route !== "aurora-reader"
        ) {
            throw new Error(
                "RDS Proxy routing requires eventual Entity reads"
            )
        }
        const load_oidc_secret_arn =
            props.load_oidc_secret_arn?.trim() ?? ""
        const load_oidc_subject =
            props.load_oidc_subject?.trim() ?? ""
        const load_oidc_client_id =
            props.load_oidc_client_id?.trim() ?? ""
        const load_oidc_values = [
            load_oidc_secret_arn,
            load_oidc_subject,
            load_oidc_client_id
        ].filter((value) => value !== "")
        if (load_oidc_values.length !== 0 && load_oidc_values.length !== 3) {
            throw new Error(
                "Garnet load OIDC secret, subject, and client must be " +
                "configured together"
            )
        }
        const load_oidc_secret =
            load_oidc_secret_arn === ""
                ? undefined
                : Secret.fromSecretCompleteArn(
                    this,
                    "LoadOidcSecret",
                    load_oidc_secret_arn
                )

        const database = new GarnetBrokerDatabase(this, "Database", {
            vpc: props.vpc,
            eventual_entity_reads: props.eventual_entity_reads
        })
        const federation_state = new GarnetFederationState(
            this,
            "FederationState",
            {
                vpc: props.vpc
            }
        )
        const runtime = new GarnetBrokerRuntime(this, "Runtime", {
            vpc: props.vpc,
            database: database.cluster,
            database_instances: database.instances,
            database_secret: database.secret,
            reader_proxy: database.reader_proxy,
            reader_proxy_endpoint: database.reader_proxy_endpoint,
            federation_state_host: federation_state.endpoint,
            federation_state_port: federation_state.port,
            federation_state_secret: federation_state.auth_token,
            eventual_entity_reads: props.eventual_entity_reads,
            eventual_entity_read_route:
                props.eventual_entity_read_route,
            delivery_stream: props.delivery_stream,
            image: props.image,
            load_image: props.load_image,
            public_origin: props.public_origin,
            notification_delivery_allow_origins:
                props.notification_delivery_allow_origins,
            private_notification_origin:
                props.private_notification_origin,
            context_allow_hosts: props.context_allow_hosts,
            oidc_issuer: props.oidc_issuer,
            oidc_audiences: props.oidc_audiences,
            oidc_tenant_claim: props.oidc_tenant_claim,
            bootstrap_admin_subject: props.bootstrap_admin_subject,
            load_oidc_secret,
            load_oidc_subject,
            load_oidc_client_id,
            authorization_cutover_stopped:
                props.authorization_cutover_stopped ?? false,
            bootstrap_tenant: props.bootstrap_tenant,
            authorization_policies: props.authorization_policies,
            authorization_bindings: props.authorization_bindings,
            temporal_history_retention_days:
                props.temporal_history_retention_days,
            temporal_history_retention_max_gib:
                props.temporal_history_retention_max_gib,
            temporal_history_retention_max_partitions:
                props.temporal_history_retention_max_partitions
        })
        federation_state.allow_connections_from(runtime.sg_broker)

        this.broker_alb = runtime.broker_alb
        this.dns_context_broker = runtime.broker_alb.loadBalancerDnsName
        this.load = runtime.load
        this.cluster_name = runtime.cluster.clusterName
        this.database_cluster_identifier =
            database.cluster.clusterIdentifier
        this.authorization_configuration_digest =
            runtime.authorization_configuration_digest

        new CfnOutput(this, "BrokerLoadBalancer", {
            value: this.dns_context_broker
        })
    }
}
