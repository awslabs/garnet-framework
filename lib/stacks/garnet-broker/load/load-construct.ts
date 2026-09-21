import {
    Aws,
    Duration,
    RemovalPolicy,
    Token
} from "aws-cdk-lib"
import {
    ISecurityGroup,
    Port,
    SecurityGroup,
    SubnetType,
    Vpc
} from "aws-cdk-lib/aws-ec2"
import {
    Cluster,
    Compatibility,
    ContainerImage,
    LogDrivers,
    NetworkMode,
    Secret as EcsSecret,
    TaskDefinition
} from "aws-cdk-lib/aws-ecs"
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs"
import { DatabaseCluster } from "aws-cdk-lib/aws-rds"
import {
    Role,
    ServicePrincipal
} from "aws-cdk-lib/aws-iam"
import {
    BlockPublicAccess,
    Bucket,
    BucketEncryption,
    ObjectLockRetention
} from "aws-cdk-lib/aws-s3"
import { ISecret } from "aws-cdk-lib/aws-secretsmanager"
import { Construct } from "constructs"
import {
    garnet_constant,
    garnet_resource_name
} from "../../../../constants"
import {
    pin_arm64_runtime
} from "../runtime/arm64-task-definition"
import {
    private_ecr_image
} from "../runtime/private-ecr-image"

export interface GarnetLoadProps {
    vpc: Vpc
    cluster: Cluster
    database: DatabaseCluster
    database_secret: ISecret
    broker_origin: string
    broker_security_group: ISecurityGroup
    broker_image: string
    load_image: string
    capacity_provider: string
    tenant: string
    sigv4_server_id: string
    sts_endpoint: string
}

/**
 * On-demand load tasks.
 *
 * These are task definitions, not services: they cost nothing while idle. The
 * The task defaults to the internal ALB diagnostic path. The launcher can
 * override only its URL and evidence mode for public qualification. Internal
 * requests authenticate with the task role and a short-lived STS proof.
 */
export class GarnetLoad extends Construct {
    public static readonly generator_role_name =
        garnet_resource_name("load-generator-role")
    public readonly generator_task: TaskDefinition
    public readonly aggregate_task: TaskDefinition
    public readonly capacity_provider: string
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
        this.capacity_provider = props.capacity_provider
        this.subnet_ids = props.vpc.selectSubnets({
            subnetType: SubnetType.PRIVATE_WITH_EGRESS
        }).subnetIds
        this.security_group = new SecurityGroup(this, "SecurityGroup", {
            vpc: props.vpc,
            description: "On-demand Garnet load generators",
            allowAllOutbound: true
        })
        props.broker_security_group.addIngressRule(
            this.security_group,
            Port.tcp(80),
            "Load generators to the production API listener"
        )
        props.database.connections.allowDefaultPortFrom(
            this.security_group,
            "Durable load-test reconciliation"
        )

        this.report_bucket = new Bucket(this, "Reports", {
            blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
            encryption: BucketEncryption.S3_MANAGED,
            enforceSSL: true,
            versioned: true,
            objectLockEnabled: true,
            objectLockDefaultRetention:
                ObjectLockRetention.compliance(Duration.days(90)),
            removalPolicy: RemovalPolicy.RETAIN
        })
        const log_group = new LogGroup(this, "Logs", {
            retention: RetentionDays.ONE_MONTH,
            removalPolicy: RemovalPolicy.DESTROY
        })
        const image =
            private_ecr_image(
                this,
                "LoadImageRepository",
                props.load_image
            ) ??
            ContainerImage.fromRegistry(props.load_image)
        const generator_role = new Role(this, "GeneratorRole", {
            roleName: GarnetLoad.generator_role_name,
            assumedBy: new ServicePrincipal("ecs-tasks.amazonaws.com")
        })
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
        const report_environment = {
            AWS_REGION: Aws.REGION,
            LOAD_REPORT_S3_BUCKET: this.report_bucket.bucketName,
            LOAD_REPORT_S3_PREFIX: "garnet-load"
        }

        this.generator_task = new TaskDefinition(
            this,
            "GeneratorTask",
            {
                family: garnet_resource_name("load-generator"),
                compatibility: Compatibility.EC2,
                networkMode: NetworkMode.AWS_VPC,
                cpu: "4096",
                memoryMiB: "8192",
                taskRole: generator_role
            }
        )
        pin_arm64_runtime(this.generator_task)
        this.generator_task.addContainer("Generator", {
            containerName: GarnetLoad.generator_container,
            image,
            entryPoint: ["/garnet-load"],
            environment: {
                ...database_environment,
                ...report_environment,
                LOAD_URL: this.broker_url,
                LOAD_TENANT: props.tenant,
                LOAD_BROKER_AUTH_MODE: "sigv4",
                LOAD_BROKER_SIGV4_SERVER_ID:
                    props.sigv4_server_id,
                LOAD_STS_ENDPOINT: props.sts_endpoint,
                LOAD_ENVIRONMENT: "aws-ecs-internal",
                LOAD_GENERATOR_VCPUS: "4",
                GARNET_IMAGE: props.broker_image
            },
            secrets: {
                ...database_secrets
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

        this.aggregate_task = new TaskDefinition(
            this,
            "AggregateTask",
            {
                family: garnet_resource_name("load-aggregate"),
                compatibility: Compatibility.EC2,
                networkMode: NetworkMode.AWS_VPC,
                cpu: "1024",
                memoryMiB: "2048"
            }
        )
        pin_arm64_runtime(this.aggregate_task)
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
