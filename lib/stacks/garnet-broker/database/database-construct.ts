import { Aws, Duration, RemovalPolicy } from "aws-cdk-lib"
import { Alarm, TreatMissingData } from "aws-cdk-lib/aws-cloudwatch"
import { SecurityGroup, SubnetType, Vpc } from "aws-cdk-lib/aws-ec2"
import {
    AuroraPostgresEngineVersion,
    CaCertificate,
    CfnDBInstance,
    ClusterInstance,
    Credentials,
    DatabaseCluster,
    DatabaseClusterEngine,
    DatabaseProxy,
    IDatabaseProxyEndpoint,
    ParameterGroup,
    ProxyEndpointTargetRole
} from "aws-cdk-lib/aws-rds"
import { ISecret } from "aws-cdk-lib/aws-secretsmanager"
import { Construct } from "constructs"
import { deployment_params } from "../../../../architecture"
import {
    garnet_constant,
    garnet_resource_name
} from "../../../../constants"

export interface GarnetBrokerDatabaseProps {
    vpc: Vpc
    eventual_entity_reads: boolean
}

/**
 * Aurora PostgreSQL for Garnet Broker.
 *
 * Garnet connects directly to the writer. Only the explicitly eventual API reader pool uses a
 * read-only RDS Proxy endpoint so reader placement and failover do not depend on client DNS.
 */
export class GarnetBrokerDatabase extends Construct {
    public readonly cluster: DatabaseCluster
    public readonly writer: CfnDBInstance
    public readonly instances: readonly CfnDBInstance[]
    public readonly reader_proxy?: DatabaseProxy
    public readonly reader_proxy_endpoint?: IDatabaseProxyEndpoint
    public readonly security_group: SecurityGroup
    public readonly secret: ISecret

    constructor(scope: Construct, id: string, props: GarnetBrokerDatabaseProps) {
        super(scope, id)

        const engine = DatabaseClusterEngine.auroraPostgres({
            version: AuroraPostgresEngineVersion.of("18.4", "18")
        })
        this.security_group = new SecurityGroup(this, "SecurityGroup", {
            vpc: props.vpc,
            description: "Direct Aurora access for Garnet Broker tasks",
            allowAllOutbound: true
        })
        const parameter_group = new ParameterGroup(this, "ParameterGroup", {
            engine,
            parameters: {
                "rds.force_ssl": "1",
                max_wal_senders: "20",
                max_parallel_workers_per_gather: "0",
                plan_cache_mode: "force_custom_plan",
                statement_timeout: "10000"
            }
        })
        const reader_ids = deployment_params.database_reader_enabled
            ? Array.from(
                { length: deployment_params.database_reader_count },
                (_, index) => index === 0 ? "reader" : `reader${index + 1}`
            )
            : []

        this.cluster = new DatabaseCluster(this, "Cluster", {
            engine,
            parameterGroup: parameter_group,
            credentials: Credentials.fromGeneratedSecret("garnetadmin"),
            defaultDatabaseName: garnet_constant.dbname,
            clusterIdentifier: garnet_resource_name("broker-aurora"),
            vpc: props.vpc,
            vpcSubnets: {
                subnetType: SubnetType.PRIVATE_ISOLATED
            },
            securityGroups: [this.security_group],
            writer: ClusterInstance.serverlessV2("writer", {
                caCertificate: CaCertificate.RDS_CA_RSA4096_G1,
                enablePerformanceInsights: true
            }),
            readers: reader_ids.map((reader_id) =>
                ClusterInstance.serverlessV2(reader_id, {
                    caCertificate: CaCertificate.RDS_CA_RSA4096_G1,
                    enablePerformanceInsights: true,
                    scaleWithWriter: true
                })
            ),
            serverlessV2MinCapacity: deployment_params.aurora_min_capacity,
            serverlessV2MaxCapacity: deployment_params.aurora_max_capacity,
            storageType: deployment_params.aurora_storage_type,
            backup: {
                retention: Duration.days(
                    deployment_params.database_backup_retention_days
                )
            },
            cloudwatchLogsExports: ["postgresql"],
            cloudwatchLogsRetention: 30,
            deletionProtection:
                deployment_params.database_deletion_protection,
            removalPolicy: RemovalPolicy.SNAPSHOT
        })
        this.writer = this.cluster.node.findChild("writer") as CfnDBInstance
        this.instances = [
            this.writer,
            ...reader_ids.map(
                (reader_id) =>
                    this.cluster.node.findChild(reader_id) as CfnDBInstance
            )
        ]
        this.secret = this.cluster.secret!

        if (props.eventual_entity_reads) {
            const proxy_security_group = new SecurityGroup(
                this,
                "ReaderProxySecurityGroup",
                {
                    vpc: props.vpc,
                    description:
                        "Private read-only RDS Proxy for Garnet Entity reads",
                    allowAllOutbound: true
                }
            )
            this.reader_proxy = this.cluster.addProxy("ReaderProxy", {
                dbProxyName:
                    garnet_resource_name("broker-reader-proxy"),
                secrets: [this.secret],
                vpc: props.vpc,
                vpcSubnets: {
                    subnetType: SubnetType.PRIVATE_ISOLATED
                },
                securityGroups: [proxy_security_group],
                idleClientTimeout: Duration.hours(8),
                requireTLS: true
            })
            this.reader_proxy_endpoint = this.reader_proxy.addEndpoint(
                "ReadOnlyEndpoint",
                {
                    dbProxyEndpointName:
                        garnet_resource_name(
                            "broker-reader-proxy-read-only"
                        ),
                    vpc: props.vpc,
                    vpcSubnets: {
                        subnetType: SubnetType.PRIVATE_ISOLATED
                    },
                    securityGroups: [proxy_security_group],
                    targetRole: ProxyEndpointTargetRole.READ_ONLY
                }
            )
        }

        new Alarm(this, "AcuUtilizationAlarm", {
            alarmName:
                `${garnet_resource_name("broker-aurora-acu")}-${Aws.REGION}`,
            alarmDescription:
                "Garnet Broker Aurora capacity is saturated; inspect endpoint latency and scale limits.",
            metric: this.cluster.metricACUUtilization(),
            threshold: 80,
            evaluationPeriods: 5,
            datapointsToAlarm: 3,
            treatMissingData: TreatMissingData.NOT_BREACHING
        })
        if (deployment_params.database_reader_enabled) {
            new Alarm(this, "ReplicaLagAlarm", {
                alarmName:
                    `${garnet_resource_name("broker-aurora-replica-lag")}-${Aws.REGION}`,
                alarmDescription:
                    "Garnet eventual Entity reads exceed the accepted Aurora replica-lag bound.",
                metric: this.cluster.metric("AuroraReplicaLagMaximum", {
                    period: Duration.minutes(1),
                    statistic: "Maximum"
                }),
                threshold: 1_000,
                evaluationPeriods: 3,
                datapointsToAlarm: 2,
                treatMissingData: TreatMissingData.BREACHING
            })
        }
    }
}
