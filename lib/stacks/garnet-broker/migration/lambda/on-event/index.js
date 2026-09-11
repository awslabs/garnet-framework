"use strict"

const migrationMode = (requestType, compatibility) => {
  if (requestType === "Create") return "apply"
  if (compatibility === "unchanged") return "verify-current"
  if (compatibility === "backward-compatible") return "apply"
  throw new Error(
    "SchemaCompatibility must be unchanged or backward-compatible"
  )
}

const requestToken = (event) => {
  const value = event.RequestId
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 64 ||
    !/^[\x21-\x7e]+$/.test(value)
  ) {
    throw new Error(
      "CloudFormation RequestId must be a printable ECS client token"
    )
  }
  return value
}

const handler = async (event) => {
  if (event.RequestType === "Delete") {
    return {
      PhysicalResourceId:
        event.PhysicalResourceId || "garnet-migration"
    }
  }

  const {
    ECSClient,
    RunTaskCommand
  } = require("@aws-sdk/client-ecs")
  const client = new ECSClient({})
  const mode = migrationMode(
    event.RequestType,
    event.ResourceProperties.SchemaCompatibility
  )
  const response = await client.send(new RunTaskCommand({
    cluster: process.env.CLUSTER_ARN,
    taskDefinition: process.env.TASK_DEFINITION_ARN,
    clientToken: requestToken(event),
    launchType: "FARGATE",
    platformVersion: "LATEST",
    count: 1,
    startedBy: "garnet-cloudformation-migration",
    networkConfiguration: {
      awsvpcConfiguration: {
        subnets: process.env.SUBNET_IDS.split(","),
        securityGroups:
          process.env.SECURITY_GROUP_IDS.split(","),
        assignPublicIp: "DISABLED"
      }
    },
    overrides: {
      containerOverrides: [{
        name: process.env.CONTAINER_NAME,
        environment: [{
          name: "DB_MIGRATION_MODE",
          value: mode
        }]
      }]
    }
  }))
  if (response.failures && response.failures.length > 0) {
    throw new Error(
      "migration task did not start: " +
        JSON.stringify(response.failures)
    )
  }
  const taskArn =
    response.tasks && response.tasks[0] && response.tasks[0].taskArn
  if (!taskArn) {
    throw new Error("ECS did not return a migration task ARN")
  }
  return {
    PhysicalResourceId:
      "garnet-migration-" +
      event.ResourceProperties.ReleaseId,
    Data: {
      TaskArn: taskArn,
      MigrationMode: mode
    }
  }
}

module.exports = {
  handler,
  migrationMode,
  requestToken
}
