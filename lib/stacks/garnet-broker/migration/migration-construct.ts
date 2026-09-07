import { CustomResource, Duration } from "aws-cdk-lib"
import { SecurityGroup, SubnetType, Vpc } from "aws-cdk-lib/aws-ec2"
import { Cluster, FargateTaskDefinition } from "aws-cdk-lib/aws-ecs"
import { PolicyStatement } from "aws-cdk-lib/aws-iam"
import { Code, Function, Runtime } from "aws-cdk-lib/aws-lambda"
import { Provider } from "aws-cdk-lib/custom-resources"
import { Construct } from "constructs"

export interface GarnetMigrationProps {
    cluster: Cluster
    task_definition: FargateTaskDefinition
    vpc: Vpc
    security_group: SecurityGroup
    release_id: string
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
            SECURITY_GROUP_IDS: props.security_group.securityGroupId
        }
        const on_event = new Function(this, "OnEvent", {
            runtime: Runtime.NODEJS_22_X,
            handler: "index.handler",
            timeout: Duration.minutes(1),
            environment: common_environment,
            code: Code.fromInline(`
const { ECSClient, RunTaskCommand } = require("@aws-sdk/client-ecs")
const client = new ECSClient({})

exports.handler = async (event) => {
  if (event.RequestType === "Delete") {
    return { PhysicalResourceId: event.PhysicalResourceId || "garnet-migration" }
  }
  const response = await client.send(new RunTaskCommand({
    cluster: process.env.CLUSTER_ARN,
    taskDefinition: process.env.TASK_DEFINITION_ARN,
    launchType: "FARGATE",
    platformVersion: "LATEST",
    count: 1,
    startedBy: "garnet-cloudformation-migration",
    networkConfiguration: {
      awsvpcConfiguration: {
        subnets: process.env.SUBNET_IDS.split(","),
        securityGroups: process.env.SECURITY_GROUP_IDS.split(","),
        assignPublicIp: "DISABLED"
      }
    }
  }))
  if (response.failures && response.failures.length > 0) {
    throw new Error("migration task did not start: " + JSON.stringify(response.failures))
  }
  const taskArn = response.tasks && response.tasks[0] && response.tasks[0].taskArn
  if (!taskArn) throw new Error("ECS did not return a migration task ARN")
  return {
    PhysicalResourceId: "garnet-migration-" + event.ResourceProperties.ReleaseId,
    Data: { TaskArn: taskArn }
  }
}
            `)
        })
        const is_complete = new Function(this, "IsComplete", {
            runtime: Runtime.NODEJS_22_X,
            handler: "index.handler",
            timeout: Duration.minutes(1),
            environment: {
                CLUSTER_ARN: props.cluster.clusterArn
            },
            code: Code.fromInline(`
const { DescribeTasksCommand, ECSClient } = require("@aws-sdk/client-ecs")
const client = new ECSClient({})

exports.handler = async (event) => {
  if (event.RequestType === "Delete") return { IsComplete: true }
  const taskArn = event.Data && event.Data.TaskArn
  if (!taskArn) throw new Error("migration provider lost the ECS task ARN")
  const response = await client.send(new DescribeTasksCommand({
    cluster: process.env.CLUSTER_ARN,
    tasks: [taskArn]
  }))
  const task = response.tasks && response.tasks[0]
  if (!task) throw new Error("migration task is no longer visible to ECS")
  if (task.lastStatus !== "STOPPED") return { IsComplete: false }
  const failed = (task.containers || []).find((container) => container.exitCode !== 0)
  if (failed) {
    throw new Error(
      "migration failed in " + (failed.name || "container") +
      " with exit code " + failed.exitCode +
      (failed.reason ? ": " + failed.reason : "")
    )
  }
  return { IsComplete: true }
}
            `)
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
                ReleaseId: props.release_id
            }
        })
        this.resource.node.addDependency(props.task_definition)
    }
}
