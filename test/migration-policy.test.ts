export {}

const send = jest.fn()
jest.mock("@aws-sdk/client-ecs", () => ({
  ECSClient: class {
    send = send
  },
  RunTaskCommand: class {
    constructor(readonly input: unknown) {}
  },
  DescribeTasksCommand: class {
    constructor(readonly input: unknown) {}
  }
}), { virtual: true })

const {
  handler,
  migrationMode,
  requestToken
} = require(
  "../lib/stacks/garnet-broker/migration/lambda/on-event"
)
const {
  handler: completionHandler
} = require(
  "../lib/stacks/garnet-broker/migration/lambda/is-complete"
)

describe("Garnet schema migration policy", () => {
  beforeEach(() => {
    send.mockReset()
    process.env.CLUSTER_ARN = "arn:cluster"
    process.env.TASK_DEFINITION_ARN = "arn:task"
    process.env.SUBNET_IDS = "subnet-a,subnet-b"
    process.env.SECURITY_GROUP_IDS = "sg-a"
    process.env.CONTAINER_NAME = "MigrationContainer"
  })

  it("initializes a new database regardless of update policy", () => {
    expect(migrationMode("Create", "unchanged")).toBe("apply")
    expect(
      migrationMode("Create", "backward-compatible")
    ).toBe("apply")
  })

  it("verifies unchanged releases without applying migrations", () => {
    expect(migrationMode("Update", "unchanged"))
      .toBe("verify-current")
  })

  it("applies only explicitly backward-compatible updates", () => {
    expect(
      migrationMode("Update", "backward-compatible")
    ).toBe("apply")
    expect(() => migrationMode("Update", "writer-drain"))
      .toThrow(/unchanged or backward-compatible/)
  })

  it("uses the CloudFormation request id as the ECS idempotency token", () => {
    expect(requestToken({
      RequestId: "62be9e62-31f1-4a09-9c81-8fb6793d2617"
    })).toBe("62be9e62-31f1-4a09-9c81-8fb6793d2617")
    expect(() => requestToken({ RequestId: "bad token" }))
      .toThrow(/printable ECS client token/)
  })

  it("overrides the migration container with the enforced mode", async () => {
    send.mockResolvedValue({
      tasks: [{ taskArn: "arn:migration-task" }]
    })

    await expect(handler({
      RequestType: "Update",
      RequestId: "62be9e62-31f1-4a09-9c81-8fb6793d2617",
      ResourceProperties: {
        ReleaseId: "abc123",
        SchemaCompatibility: "unchanged"
      }
    })).resolves.toEqual({
      PhysicalResourceId: "garnet-migration-abc123",
      Data: {
        TaskArn: "arn:migration-task",
        MigrationMode: "verify-current"
      }
    })

    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0]![0].input).toMatchObject({
      clientToken: "62be9e62-31f1-4a09-9c81-8fb6793d2617",
      overrides: {
        containerOverrides: [{
          name: "MigrationContainer",
          environment: [{
            name: "DB_MIGRATION_MODE",
            value: "verify-current"
          }]
        }]
      }
    })
  })

  it("waits until the exact migration container exits successfully", async () => {
    send
      .mockResolvedValueOnce({
        tasks: [{
          taskArn: "arn:migration-task",
          lastStatus: "RUNNING"
        }]
      })
      .mockResolvedValueOnce({
        tasks: [{
          taskArn: "arn:migration-task",
          lastStatus: "STOPPED",
          containers: [{
            name: "MigrationContainer",
            exitCode: 0
          }]
        }]
      })
    const event = {
      RequestType: "Update",
      Data: {
        TaskArn: "arn:migration-task"
      }
    }

    await expect(completionHandler(event))
      .resolves.toEqual({ IsComplete: false })
    await expect(completionHandler(event))
      .resolves.toEqual({ IsComplete: true })
  })

  it("fails closed when ECS never started the migration container", async () => {
    send.mockResolvedValue({
      tasks: [{
        taskArn: "arn:migration-task",
        lastStatus: "STOPPED",
        stopCode: "TaskFailedToStart",
        stoppedReason: "CannotPullContainerError",
        containers: []
      }]
    })

    await expect(completionHandler({
      RequestType: "Update",
      Data: {
        TaskArn: "arn:migration-task"
      }
    })).rejects.toThrow(
      /stopped without MigrationContainer.*CannotPullContainerError/
    )
  })

  it("fails closed on missing exit codes and ECS describe failures", async () => {
    send
      .mockResolvedValueOnce({
        tasks: [{
          taskArn: "arn:migration-task",
          lastStatus: "STOPPED",
          stoppedReason: "Essential container exited",
          containers: [{
            name: "MigrationContainer"
          }]
        }]
      })
      .mockResolvedValueOnce({
        failures: [{
          arn: "arn:migration-task",
          reason: "MISSING"
        }]
      })
    const event = {
      RequestType: "Update",
      Data: {
        TaskArn: "arn:migration-task"
      }
    }

    await expect(completionHandler(event))
      .rejects.toThrow(/exit code missing/)
    await expect(completionHandler(event))
      .rejects.toThrow(/could not be described/)
  })
})
