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
  const task = response.tasks && response.tasks[0]
  if (!task) {
    throw new Error("migration task is no longer visible to ECS")
  }
  if (task.lastStatus !== "STOPPED") return { IsComplete: false }
  const failed = (task.containers || [])
    .find((container) => container.exitCode !== 0)
  if (failed) {
    throw new Error(
      "migration failed in " +
        (failed.name || "container") +
        " with exit code " +
        failed.exitCode +
        (failed.reason ? ": " + failed.reason : "")
    )
  }
  return { IsComplete: true }
}

module.exports = { handler }
