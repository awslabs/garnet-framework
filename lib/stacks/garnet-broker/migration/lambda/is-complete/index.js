"use strict"

const handler = async (event) => {
  if (event.RequestType === "Delete") {
    return { IsComplete: true }
  }

  const {
    DescribeTasksCommand,
    ECSClient
  } = require("@aws-sdk/client-ecs")
  const client = new ECSClient({})
  const taskArn = event.Data && event.Data.TaskArn
  if (!taskArn) {
    throw new Error("migration provider lost the ECS task ARN")
  }
  const response = await client.send(new DescribeTasksCommand({
    cluster: process.env.CLUSTER_ARN,
    tasks: [taskArn]
  }))
  if (response.failures && response.failures.length > 0) {
    throw new Error(
      "migration task could not be described: " +
        JSON.stringify(response.failures)
    )
  }
  const task = response.tasks && response.tasks[0]
  if (!task) {
    throw new Error("migration task is no longer visible to ECS")
  }
  if (task.lastStatus !== "STOPPED") return { IsComplete: false }
  const containerName = process.env.CONTAINER_NAME
  if (!containerName) {
    throw new Error("migration container name is not configured")
  }
  const container = (task.containers || [])
    .find((candidate) => candidate.name === containerName)
  if (!container) {
    throw new Error(
      `migration task stopped without ${containerName}` +
        (task.stopCode ? ` (${task.stopCode})` : "") +
        (task.stoppedReason ? `: ${task.stoppedReason}` : "")
    )
  }
  if (container.exitCode !== 0) {
    throw new Error(
      "migration failed in " +
        containerName +
        " with exit code " +
        (container.exitCode ?? "missing") +
        (container.reason ? ": " + container.reason : "") +
        (
          !container.reason && task.stoppedReason
            ? ": " + task.stoppedReason
            : ""
        )
    )
  }
  return { IsComplete: true }
}

module.exports = { handler }
