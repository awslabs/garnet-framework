import {
    Aws,
    RemovalPolicy,
    Token
} from "aws-cdk-lib"
import {
    SecurityGroup,
    SubnetType,
    Vpc
} from "aws-cdk-lib/aws-ec2"
import {
    Cluster,
    ContainerImage,
    CpuArchitecture,
    FargateTaskDefinition,
    LogDrivers,
    OperatingSystemFamily,
    Secret as EcsSecret
} from "aws-cdk-lib/aws-ecs"
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs"
import { DatabaseCluster } from "aws-cdk-lib/aws-rds"
import {
    BlockPublicAccess,
    Bucket,
    BucketEncryption
} from "aws-cdk-lib/aws-s3"
import { ISecret, Secret } from "aws-cdk-lib/aws-secretsmanager"
import { Construct } from "constructs"
import {
    garnet_constant,
    garnet_nomenclature
} from "../../../../constants"

export interface GarnetLoadProps {
    vpc: Vpc
    cluster: Cluster
    database: DatabaseCluster
    database_secret: ISecret
    broker_origin: string
    broker_image: string
    load_image: string
}

/**
 * On-demand load tasks.
 *
 * These are task definitions, not services: they cost nothing while idle. The
 * The task defaults to the internal ALB diagnostic path. The launcher can
 * override only its non-secret URL and evidence mode for public qualification;
 * the API Authorization object always comes from Secrets Manager.
 */
export class GarnetLoad extends Construct {
    public readonly generator_task: FargateTaskDefinition
    public readonly aggregate_task: FargateTaskDefinition
    public readonly security_group: SecurityGroup
    public readonly report_bucket: Bucket
    public readonly subnet_ids: string[]
    public readonly broker_url: string
    public readonly cluster_name: string

    public static readonly generator_container = "garnet-load-generator"
    public static readonly aggregate_container = "garnet-load-aggregate"

    constructor(scope: Construct, id: string, props: GarnetLoadProps) {
        super(scope, id)

        if (!/^[^@\s]+@sha256:[0-9a-f]{64}$/.test(props.load_image)) {
            throw new Error(
                "Garnet load image must be immutable and digest-pinned"
            )
        }

        this.broker_url = `http://${props.broker_origin}`
        this.cluster_name = props.cluster.clusterName
        this.subnet_ids = props.vpc.selectSubnets({
            subnetType: SubnetType.PRIVATE_WITH_EGRESS
        }).subnetIds
        this.security_group = new SecurityGroup(this, "SecurityGroup", {
            vpc: props.vpc,
            description: "On-demand Garnet load generators",
            allowAllOutbound: true
        })
        props.database.connections.allowDefaultPortFrom(
            this.security_group,
            "Durable load-test reconciliation"
        )

        this.report_bucket = new Bucket(this, "Reports", {
            blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
            encryption: BucketEncryption.S3_MANAGED,
            enforceSSL: true,
            versioned: true,
            removalPolicy: RemovalPolicy.RETAIN
        })
        const log_group = new LogGroup(this, "Logs", {
            retention: RetentionDays.ONE_MONTH,
            removalPolicy: RemovalPolicy.DESTROY
        })
        const image = ContainerImage.fromRegistry(props.load_image)
        const database_environment = {
            LOAD_DATABASE_HOST: props.database.clusterEndpoint.hostname,
            LOAD_DATABASE_PORT: Token.asString(
                props.database.clusterEndpoint.port
            ),
            LOAD_DATABASE_NAME: garnet_constant.dbname,
            LOAD_DATABASE_SSL_MODE: "require"
        }
        const database_secrets = {
            LOAD_DATABASE_USER: EcsSecret.fromSecretsManager(
                props.database_secret,
                "username"
            ),
            LOAD_DATABASE_PASSWORD: EcsSecret.fromSecretsManager(
                props.database_secret,
                "password"
            )
        }
        const api_token_secret = Secret.fromSecretNameV2(
            this,
            "ApiTokenSecret",
            garnet_nomenclature.garnet_api_client_secret
        )
        const report_environment = {
            AWS_REGION: Aws.REGION,
            LOAD_REPORT_S3_BUCKET: this.report_bucket.bucketName,
            LOAD_REPORT_S3_PREFIX: "garnet-load"
        }

        this.generator_task = new FargateTaskDefinition(
            this,
            "GeneratorTask",
            {
                family: "garnet-load-generator",
                cpu: 4096,
                memoryLimitMiB: 8192,
                runtimePlatform: {
                    cpuArchitecture: CpuArchitecture.ARM64,
                    operatingSystemFamily: OperatingSystemFamily.LINUX
                }
            }
        )
        this.generator_task.addContainer("Generator", {
            containerName: GarnetLoad.generator_container,
            image,
            entryPoint: ["/garnet-load"],
            environment: {
                ...database_environment,
                ...report_environment,
                LOAD_URL: this.broker_url,
                LOAD_ENVIRONMENT: "aws-ecs-internal",
                LOAD_GENERATOR_VCPUS: "4",
                GARNET_IMAGE: props.broker_image
            },
            secrets: {
                ...database_secrets,
                LOAD_HEADERS_JSON:
                    EcsSecret.fromSecretsManager(api_token_secret)
            },
            logging: LogDrivers.awsLogs({
                streamPrefix: "garnet/load-generator",
                logGroup: log_group
            })
        })
        this.report_bucket.grantPut(
            this.generator_task.taskRole,
            "garnet-load/*"
        )

        this.aggregate_task = new FargateTaskDefinition(
            this,
            "AggregateTask",
            {
                family: "garnet-load-aggregate",
                cpu: 1024,
                memoryLimitMiB: 2048,
                runtimePlatform: {
                    cpuArchitecture: CpuArchitecture.ARM64,
                    operatingSystemFamily: OperatingSystemFamily.LINUX
                }
            }
        )
        this.aggregate_task.addContainer("Aggregate", {
            containerName: GarnetLoad.aggregate_container,
            image,
            entryPoint: ["/garnet-load-aggregate"],
            environment: {
                ...database_environment,
                ...report_environment
            },
            secrets: database_secrets,
            logging: LogDrivers.awsLogs({
                streamPrefix: "garnet/load-aggregate",
                logGroup: log_group
            })
        })
        this.report_bucket.grantReadWrite(
            this.aggregate_task.taskRole,
            "garnet-load/*"
        )
    }
}
