import { Duration, RemovalPolicy } from "aws-cdk-lib"
import { SecurityGroup, SubnetType } from "aws-cdk-lib/aws-ec2"
import {
    AppProtocol,
    AvailabilityZoneRebalancing,
    BaseService,
    Cluster,
    Compatibility,
    ContainerDefinition,
    ContainerImage,
    DeploymentStrategy,
    Ec2Service,
    LogDrivers,
    NetworkMode,
    PropagatedTagSource,
    ScalableTaskCount,
    Secret as EcsSecret,
    TaskDefinition
} from "aws-cdk-lib/aws-ecs"
import { IRole } from "aws-cdk-lib/aws-iam"
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs"
import { Construct } from "constructs"
import { garnet_resource_name } from "../../../../constants"
import { GarnetServiceCapacity } from "./runtime-profile"
import { pin_arm64_runtime } from "./arm64-task-definition"

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
    interruption_tolerant?: boolean
    deployment_strategy?: DeploymentStrategy
    bake_time?: Duration
    task_role?: IRole
}

export interface GarnetServiceResult {
    service: BaseService
    task_definition: TaskDefinition
    container: ContainerDefinition
    scaling?: ScalableTaskCount
}

export interface GarnetTaskFactoryProps {
    cluster: Cluster
    security_group: SecurityGroup
    image: ContainerImage
    common_environment: Record<string, string>
    common_secrets: Record<string, EcsSecret>
    on_demand_capacity_provider: string
    spot_capacity_provider: string
    worker_spot_scale_out: boolean
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
        const task_definition = new TaskDefinition(
            this,
            `${spec.id}TaskDefinition`,
            {
                family: garnet_resource_name(`broker-${spec.name}`),
                compatibility: Compatibility.EC2,
                networkMode: NetworkMode.AWS_VPC,
                cpu: String(spec.capacity.cpu),
                memoryMiB: String(spec.capacity.memory_mib),
                taskRole: spec.task_role
            }
        )
        pin_arm64_runtime(task_definition)
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
        const service = new Ec2Service(this, `${spec.id}Service`, {
            cluster: this.props.cluster,
            taskDefinition: task_definition,
            serviceName: `garnet-${spec.name}`,
            desiredCount: spec.capacity.min_tasks,
            assignPublicIp: false,
            availabilityZoneRebalancing:
                AvailabilityZoneRebalancing.ENABLED,
            capacityProviderStrategies:
                spec.interruption_tolerant === true &&
                this.props.worker_spot_scale_out
                    ? [
                        {
                            capacityProvider:
                                this.props.on_demand_capacity_provider,
                            base: spec.capacity.min_tasks,
                            weight: 1
                        },
                        {
                            capacityProvider:
                                this.props.spot_capacity_provider,
                            weight: 4
                        }
                    ]
                    : [{
                        capacityProvider:
                            this.props.on_demand_capacity_provider,
                        weight: 1
                    }],
            securityGroups: [this.props.security_group],
            vpcSubnets: {
                subnetType: SubnetType.PRIVATE_WITH_EGRESS
            },
            ...(spec.deployment_strategy === undefined
                ? {
                    circuitBreaker: {
                        enable: true,
                        rollback: true
                    }
                }
                : {}),
            minHealthyPercent: 100,
            maxHealthyPercent: 200,
            healthCheckGracePeriod:
                spec.port === undefined ? undefined : Duration.seconds(90),
            enableECSManagedTags: true,
            propagateTags: PropagatedTagSource.SERVICE,
            ...(spec.deployment_strategy === undefined
                ? {}
                : {
                    deploymentStrategy: spec.deployment_strategy,
                    bakeTime: spec.bake_time
                }),
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
