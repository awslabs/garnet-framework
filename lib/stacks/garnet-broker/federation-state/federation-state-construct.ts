import { RemovalPolicy } from "aws-cdk-lib"
import {
    ISecurityGroup,
    Port,
    SecurityGroup,
    SubnetType,
    Vpc
} from "aws-cdk-lib/aws-ec2"
import {
    CfnReplicationGroup,
    CfnSubnetGroup
} from "aws-cdk-lib/aws-elasticache"
import { Secret } from "aws-cdk-lib/aws-secretsmanager"
import { Construct } from "constructs"
import { garnet_resource_name } from "../../../../constants"

const FEDERATION_STATE_PORT = 6379

export interface GarnetFederationStateProps {
    vpc: Vpc
    node_type?: string
    engine_version?: string
}

/**
 * Disposable, replica-safe state for Registration cacheDuration and cooldown.
 *
 * The broker's Bun client is intentionally non-clustered, so this is one shard with a replica,
 * not ElastiCache Serverless or a cluster-mode-enabled topology. PostgreSQL remains authoritative;
 * a cache outage only removes load protection and response reuse.
 */
export class GarnetFederationState extends Construct {
    public readonly endpoint: string
    public readonly port = FEDERATION_STATE_PORT
    public readonly auth_token: Secret
    public readonly security_group: SecurityGroup

    constructor(
        scope: Construct,
        id: string,
        props: GarnetFederationStateProps
    ) {
        super(scope, id)

        const subnets = props.vpc.selectSubnets({
            subnetType: SubnetType.PRIVATE_ISOLATED
        })
        const subnet_group = new CfnSubnetGroup(this, "SubnetGroup", {
            description: "Private subnets for Garnet federation state",
            subnetIds: subnets.subnetIds
        })
        this.security_group = new SecurityGroup(this, "SecurityGroup", {
            vpc: props.vpc,
            description: "TLS Valkey access from Garnet Broker tasks",
            allowAllOutbound: false
        })
        this.auth_token = new Secret(this, "AuthToken", {
            description: "AUTH token for Garnet's disposable federation state",
            generateSecretString: {
                excludePunctuation: true,
                passwordLength: 48,
                requireEachIncludedType: false
            }
        })
        this.auth_token.applyRemovalPolicy(RemovalPolicy.DESTROY)

        const replication_group = new CfnReplicationGroup(
            this,
            "ReplicationGroup",
            {
                replicationGroupId:
                    garnet_resource_name("federation-state"),
                replicationGroupDescription:
                    "Replica-safe NGSI-LD cacheDuration and cooldown state",
                engine: "valkey",
                // Keep the engine line explicit: ElastiCache cannot downgrade it in place, and
                // a release must qualify Bun's RESP client before advancing this default.
                engineVersion: props.engine_version ?? "8.2",
                cacheNodeType: props.node_type ?? "cache.t4g.small",
                cacheSubnetGroupName: subnet_group.ref,
                securityGroupIds: [
                    this.security_group.securityGroupId
                ],
                port: FEDERATION_STATE_PORT,
                clusterMode: "disabled",
                numCacheClusters: 2,
                automaticFailoverEnabled: true,
                multiAzEnabled: true,
                autoMinorVersionUpgrade: true,
                atRestEncryptionEnabled: true,
                transitEncryptionEnabled: true,
                transitEncryptionMode: "required",
                authToken: this.auth_token.secretValue.unsafeUnwrap(),
                snapshotRetentionLimit: 0
            }
        )
        replication_group.applyRemovalPolicy(RemovalPolicy.DESTROY)
        replication_group.node.addDependency(subnet_group)
        replication_group.node.addDependency(this.auth_token)
        this.endpoint = replication_group.attrPrimaryEndPointAddress
    }

    allow_connections_from(peer: ISecurityGroup): void {
        this.security_group.addIngressRule(
            peer,
            Port.tcp(FEDERATION_STATE_PORT),
            "Garnet federation cache and cooldown state"
        )
    }
}
