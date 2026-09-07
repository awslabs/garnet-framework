import { Duration, RemovalPolicy } from "aws-cdk-lib"
import { SecurityGroup, SubnetType } from "aws-cdk-lib/aws-ec2"
import {
    AppProtocol,
    Cluster,
    ContainerDefinition,
    ContainerImage,
    CpuArchitecture,
    FargatePlatformVersion,
    FargateService,
    FargateTaskDefinition,
    LogDrivers,
    OperatingSystemFamily,
    PropagatedTagSource,
    ScalableTaskCount,
    Secret as EcsSecret
} from "aws-cdk-lib/aws-ecs"
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs"
import { Construct } from "constructs"
import { GarnetServiceCapacity } from "./runtime-profile"

export interface GarnetServiceSpec {
    id: string
    name: string
    entry_point: string
    capacity: GarnetServiceCapacity
    environment?: Record<string, string>
    secrets?: Record<string, EcsSecret>
    port?: {
        name: string
        number: number
        service_connect_server?: boolean
    }
    service_connect_client?: boolean
    cpu_autoscaling?: boolean
}

export interface GarnetServiceResult {
    service: FargateService
    task_definition: FargateTaskDefinition
    container: ContainerDefinition
    scaling?: ScalableTaskCount
}

export interface GarnetTaskFactoryProps {
    cluster: Cluster
    security_group: SecurityGroup
    image: ContainerImage
    common_environment: Record<string, string>
    common_secrets: Record<string, EcsSecret>
}

export class GarnetTaskFactory extends Construct {
    constructor(
        scope: Construct,
        id: string,
        private readonly props: GarnetTaskFactoryProps
    ) {
        super(scope, id)
    }

    create_service(spec: GarnetServiceSpec): GarnetServiceResult {
        const log_group = new LogGroup(this, `${spec.id}Logs`, {
            retention: RetentionDays.ONE_MONTH,
            removalPolicy: RemovalPolicy.DESTROY
        })
        const task_definition = new FargateTaskDefinition(
            this,
            `${spec.id}TaskDefinition`,
            {
                family: `garnet-${spec.name}`,
                cpu: spec.capacity.cpu,
                memoryLimitMiB: spec.capacity.memory_mib,
                runtimePlatform: {
                    cpuArchitecture: CpuArchitecture.ARM64,
                    operatingSystemFamily: OperatingSystemFamily.LINUX
                }
            }
        )
        const environment = {
            ...this.props.common_environment,
            DB_POOL_MAX: String(spec.capacity.database_pool),
            ...(spec.environment ?? {})
        }
        const container = task_definition.addContainer(`${spec.id}Container`, {
            containerName: `garnet-${spec.name}`,
            image: this.props.image,
            essential: true,
            entryPoint: [spec.entry_point],
            environment,
            secrets: {
                ...this.props.common_secrets,
                ...(spec.secrets ?? {})
            },
            logging: LogDrivers.awsLogs({
                streamPrefix: `garnet/${spec.name}`,
                logGroup: log_group
            }),
            ...(spec.port === undefined
                ? {}
                : {
                    healthCheck: {
                        command: ["CMD", "/garnet-healthcheck"],
                        interval: Duration.seconds(30),
                        timeout: Duration.seconds(5),
                        retries: 3,
                        startPeriod: Duration.seconds(30)
                    }
                })
        })
        if (spec.port !== undefined) {
            container.addPortMappings({
                name: spec.port.name,
                containerPort: spec.port.number,
                hostPort: spec.port.number,
                appProtocol: AppProtocol.http
            })
        }

        const namespace =
            this.props.cluster.defaultCloudMapNamespace?.namespaceName
        const service = new FargateService(this, `${spec.id}Service`, {
            cluster: this.props.cluster,
            taskDefinition: task_definition,
            serviceName: `garnet-${spec.name}`,
            desiredCount: spec.capacity.min_tasks,
            assignPublicIp: false,
            platformVersion: FargatePlatformVersion.LATEST,
            securityGroups: [this.props.security_group],
            vpcSubnets: {
                subnetType: SubnetType.PRIVATE_WITH_EGRESS
            },
            circuitBreaker: {
                enable: true,
                rollback: true
            },
            minHealthyPercent: 100,
            maxHealthyPercent: 200,
            healthCheckGracePeriod:
                spec.port === undefined ? undefined : Duration.seconds(90),
            enableECSManagedTags: true,
            propagateTags: PropagatedTagSource.SERVICE,
            ...(
                namespace === undefined ||
                (!spec.service_connect_client &&
                    spec.port?.service_connect_server !== true)
                    ? {}
                    : {
                        serviceConnectConfiguration: {
                            namespace,
                            ...(spec.port?.service_connect_server === true
                                ? {
                                    services: [{
                                        portMappingName: spec.port.name,
                                        dnsName: spec.name,
                                        port: spec.port.number
                                    }]
                                }
                                : {})
                        }
                    }
            )
        })

        let scaling: ScalableTaskCount | undefined
        if (spec.capacity.max_tasks > spec.capacity.min_tasks) {
            scaling = service.autoScaleTaskCount({
                minCapacity: spec.capacity.min_tasks,
                maxCapacity: spec.capacity.max_tasks
            })
            if (spec.cpu_autoscaling !== false) {
                scaling.scaleOnCpuUtilization(`${spec.id}CpuScaling`, {
                    targetUtilizationPercent: 60,
                    scaleInCooldown: Duration.seconds(120),
                    scaleOutCooldown: Duration.seconds(30)
                })
            }
        }
        return { service, task_definition, container, scaling }
    }
}
