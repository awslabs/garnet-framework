import { Aws, Duration, RemovalPolicy } from "aws-cdk-lib"
import { Alarm, TreatMissingData } from "aws-cdk-lib/aws-cloudwatch"
import { SecurityGroup, SubnetType, Vpc } from "aws-cdk-lib/aws-ec2"
import {
    AuroraPostgresEngineVersion,
    CaCertificate,
    ClusterInstance,
    Credentials,
    DatabaseCluster,
    DatabaseClusterEngine,
    ParameterGroup
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
}

/**
 * Aurora PostgreSQL for Garnet Broker.
 *
 * Garnet connects directly to the writer. RDS Proxy is deliberately absent: PostgreSQL LISTEN,
 * prepared statements, session settings, and large batch statements pin sessions and remove the
 * multiplexing benefit while adding another latency and failure boundary.
 */
export class GarnetBrokerDatabase extends Construct {
    public readonly cluster: DatabaseCluster
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
                "rds.force_ssl": "1"
            }
        })

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
            readers: deployment_params.database_reader_enabled
                ? [
                    ClusterInstance.serverlessV2("reader", {
                        caCertificate: CaCertificate.RDS_CA_RSA4096_G1,
                        enablePerformanceInsights: true,
                        scaleWithWriter: true
                    })
                ]
                : [],
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
        this.secret = this.cluster.secret!

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
