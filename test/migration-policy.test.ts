export {}

const send = jest.fn()
jest.mock("@aws-sdk/client-ecs", () => ({
  ECSClient: class {
    send = send
  },
  RunTaskCommand: class {
    constructor(readonly input: unknown) {}
  }
}), { virtual: true })

const {
  handler,
  migrationMode
} = require(
  "../lib/stacks/garnet-broker/migration/lambda/on-event"
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

  it("overrides the migration container with the enforced mode", async () => {
    send.mockResolvedValue({
      tasks: [{ taskArn: "arn:migration-task" }]
    })

    await expect(handler({
      RequestType: "Update",
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
})
