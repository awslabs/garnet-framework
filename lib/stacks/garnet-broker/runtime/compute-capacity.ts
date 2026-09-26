import { Duration } from "aws-cdk-lib"
import {
    AutoScalingGroup,
    OnDemandAllocationStrategy,
    SpotAllocationStrategy
} from "aws-cdk-lib/aws-autoscaling"
import {
    InstanceType,
    LaunchTemplate,
    SecurityGroup,
    SubnetType,
    UserData,
    Vpc
} from "aws-cdk-lib/aws-ec2"
import {
    AmiHardwareType,
    AsgCapacityProvider,
    CfnCapacityProvider,
    Cluster,
    EcsOptimizedImage
} from "aws-cdk-lib/aws-ecs"
import {
    ManagedPolicy,
    Role,
    ServicePrincipal
} from "aws-cdk-lib/aws-iam"
import { Construct } from "constructs"
import { garnet_resource_name } from "../../../../constants"

export interface GarnetComputeCapacity {
    on_demand: AsgCapacityProvider
    spot: AsgCapacityProvider
}

const capacity_provider = (
    scope: Construct,
    cluster: Cluster,
    vpc: Vpc,
    id: string,
    instance_type: string,
    security_group: SecurityGroup,
    spot: boolean,
    managed_scaling: boolean
): AsgCapacityProvider => {
    const role = new Role(scope, `${id}InstanceRole`, {
        assumedBy: new ServicePrincipal("ec2.amazonaws.com"),
        managedPolicies: [
            ManagedPolicy.fromAwsManagedPolicyName(
                "service-role/AmazonEC2ContainerServiceforEC2Role"
            ),
            ManagedPolicy.fromAwsManagedPolicyName(
                "AmazonSSMManagedInstanceCore"
            )
        ]
    })
    const launch_template = new LaunchTemplate(scope, `${id}LaunchTemplate`, {
        machineImage:
            EcsOptimizedImage.amazonLinux2023(AmiHardwareType.ARM),
        userData: UserData.forLinux(),
        securityGroup: security_group,
        role,
        requireImdsv2: true,
        detailedMonitoring: false
    })
    const auto_scaling_group = new AutoScalingGroup(
        scope,
        `${id}AutoScalingGroup`,
        {
            vpc,
            vpcSubnets: {
                subnetType: SubnetType.PRIVATE_WITH_EGRESS
            },
            mixedInstancesPolicy: {
                launchTemplate: launch_template,
                launchTemplateOverrides: [{
                    instanceType: new InstanceType(instance_type)
                }],
                instancesDistribution: spot
                    ? {
                        onDemandBaseCapacity: 0,
                        onDemandPercentageAboveBaseCapacity: 0,
                        spotAllocationStrategy:
                            SpotAllocationStrategy.PRICE_CAPACITY_OPTIMIZED
                    }
                    : {
                        onDemandBaseCapacity: 0,
                        onDemandPercentageAboveBaseCapacity: 100,
                        onDemandAllocationStrategy:
                            OnDemandAllocationStrategy.PRIORITIZED
                    }
            },
            minCapacity: spot ? 0 : 2,
            maxCapacity: spot ? 64 : 32,
            newInstancesProtectedFromScaleIn: !spot,
            capacityRebalance: spot,
            defaultInstanceWarmup: Duration.minutes(3)
        }
    )
    const provider = new AsgCapacityProvider(scope, `${id}Provider`, {
        capacityProviderName:
            garnet_resource_name(
                spot ? "broker-graviton-spot" : "broker-graviton"
            ),
        autoScalingGroup: auto_scaling_group,
        enableManagedScaling: managed_scaling,
        enableManagedTerminationProtection: !spot,
        enableManagedDraining: true,
        targetCapacityPercent: 85,
        instanceWarmupPeriod: 180
    })
    if (!managed_scaling) {
        const resource = provider.node.findChild(
            `${id}Provider`
        ) as CfnCapacityProvider
        resource.addPropertyOverride(
            "AutoScalingGroupProvider.ManagedScaling",
            { Status: "DISABLED" }
        )
    }
    cluster.addAsgCapacityProvider(provider)
    return provider
}

export const add_garnet_compute_capacity = (
    scope: Construct,
    cluster: Cluster,
    vpc: Vpc,
    instance_type: string,
    spot_scale_out: boolean
): GarnetComputeCapacity => {
    const host_security_group = new SecurityGroup(
        scope,
        "HostSecurityGroup",
        {
            vpc,
            description:
                "Egress-only security group for Garnet ECS hosts",
            allowAllOutbound: true
        }
    )
    const on_demand = capacity_provider(
        scope,
        cluster,
        vpc,
        "OnDemand",
        instance_type,
        host_security_group,
        false,
        true
    )
    const spot = capacity_provider(
        scope,
        cluster,
        vpc,
        "Spot",
        instance_type,
        host_security_group,
        true,
        spot_scale_out
    )
    cluster.addDefaultCapacityProviderStrategy([{
        capacityProvider: on_demand.capacityProviderName,
        weight: 1
    }])
    return { on_demand, spot }
}
