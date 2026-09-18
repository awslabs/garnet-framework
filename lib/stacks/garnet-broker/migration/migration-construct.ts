import { CustomResource, Duration } from "aws-cdk-lib"
import { SecurityGroup, SubnetType, Vpc } from "aws-cdk-lib/aws-ec2"
import { Cluster, TaskDefinition } from "aws-cdk-lib/aws-ecs"
import { PolicyStatement } from "aws-cdk-lib/aws-iam"
import { Code, Function, Runtime } from "aws-cdk-lib/aws-lambda"
import { Provider } from "aws-cdk-lib/custom-resources"
import { Construct } from "constructs"

export interface GarnetMigrationProps {
    cluster: Cluster
    task_definition: TaskDefinition
    capacity_provider: string
    vpc: Vpc
    security_group: SecurityGroup
    release_id: string
    schema_compatibility: "unchanged" | "backward-compatible"
}

/**
 * Runs the target image's migrator and blocks CloudFormation until its container exits cleanly.
 * Broker services depend on this resource, so an incompatible schema never receives traffic.
 */
export class GarnetMigration extends Construct {
    public readonly resource: CustomResource

    constructor(scope: Construct, id: string, props: GarnetMigrationProps) {
        super(scope, id)

        const subnets = props.vpc.selectSubnets({
            subnetType: SubnetType.PRIVATE_WITH_EGRESS
        }).subnetIds
        const common_environment = {
            CLUSTER_ARN: props.cluster.clusterArn,
            TASK_DEFINITION_ARN: props.task_definition.taskDefinitionArn,
            SUBNET_IDS: subnets.join(","),
            SECURITY_GROUP_IDS: props.security_group.securityGroupId,
            CONTAINER_NAME: "MigrationContainer",
            CAPACITY_PROVIDER: props.capacity_provider
        }
        const on_event = new Function(this, "OnEvent", {
            runtime: Runtime.NODEJS_24_X,
            handler: "index.handler",
            timeout: Duration.minutes(1),
            environment: common_environment,
            code: Code.fromAsset(
                `${__dirname}/lambda/on-event`
            )
        })
        const is_complete = new Function(this, "IsComplete", {
            runtime: Runtime.NODEJS_24_X,
            handler: "index.handler",
            timeout: Duration.minutes(1),
            environment: {
                CLUSTER_ARN: props.cluster.clusterArn,
                CONTAINER_NAME: "MigrationContainer"
            },
            code: Code.fromAsset(
                `${__dirname}/lambda/is-complete`
            )
        })

        on_event.addToRolePolicy(new PolicyStatement({
            actions: ["ecs:RunTask"],
            resources: [props.task_definition.taskDefinitionArn]
        }))
        on_event.addToRolePolicy(new PolicyStatement({
            actions: ["iam:PassRole"],
            resources: [
                props.task_definition.taskRole.roleArn,
                props.task_definition.obtainExecutionRole().roleArn
            ]
        }))
        is_complete.addToRolePolicy(new PolicyStatement({
            actions: ["ecs:DescribeTasks"],
            resources: ["*"]
        }))

        const provider = new Provider(this, "Provider", {
            onEventHandler: on_event,
            isCompleteHandler: is_complete,
            queryInterval: Duration.seconds(10),
            totalTimeout: Duration.minutes(30)
        })
        this.resource = new CustomResource(this, "Resource", {
            serviceToken: provider.serviceToken,
            properties: {
                ReleaseId: props.release_id,
                SchemaCompatibility: props.schema_compatibility
            }
        })
        this.resource.node.addDependency(props.task_definition)
    }
}
