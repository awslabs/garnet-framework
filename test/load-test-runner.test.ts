const { plan_load_test } =
  require("../.github/scripts/load-test-plan.js")
const { run_plan } =
  require("../.github/scripts/run-load-test.js")

export {}

const OUTPUTS = {
  GarnetLoadCluster: "garnet-cluster",
  GarnetLoadGeneratorTask: "generator-task:1",
  GarnetLoadAggregateTask: "aggregate-task:1",
  GarnetLoadSecurityGroup: "sg-123",
  GarnetLoadSubnets: "subnet-a,subnet-b",
  GarnetLoadReportBucket: "garnet-load-reports",
  GarnetLoadBrokerUrl: "http://internal.example"
}

const override_environment = (
  override: any
): Record<string, string> =>
  Object.fromEntries(
    override.containerOverrides[0].environment
      .map((entry: any) => [entry.name, entry.value])
  )

describe("AWS load-test launcher", () => {
  it("partitions one shared schedule across unique generator tasks", () => {
    const plan = plan_load_test(
      OUTPUTS,
      {
        LOAD_RUN_ID: "release-42",
        LOAD_GENERATOR_COUNT: "3",
        LOAD_RATE: "5000",
        LOAD_FIXTURE_ENTITIES: "50000",
        LOAD_START_DELAY_SECONDS: "600"
      },
      new Date("2026-09-07T12:00:00Z")
    )

    expect(plan.run_id).toBe("release42")
    expect(plan.generator_overrides).toHaveLength(3)
    const environments: Record<string, string>[] =
      plan.generator_overrides.map(override_environment)
    expect(environments.map(env => env.LOAD_GENERATOR_INDEX))
      .toEqual(["0", "1", "2"])
    expect(environments.map(env => env.LOAD_SEED))
      .toEqual(["1", "0", "0"])
    expect(new Set(environments.map(env => env.LOAD_START_AT)).size).toBe(1)
    expect(environments[0]).toMatchObject({
      LOAD_RATE: "5000",
      LOAD_FIXTURE_ENTITIES: "50000",
      LOAD_GENERATOR_COUNT: "3"
    })
    expect(plan.report_uri).toBe(
      "s3://garnet-load-reports/garnet-load/release42/aggregate.json"
    )
  })

  it("refuses to label the internal ALB path as qualification", () => {
    expect(() => plan_load_test(OUTPUTS, {
      LOAD_QUALIFICATION: "1"
    })).toThrow("internal load plane is diagnostic")
  })

  it("runs the aggregate even when one generator fails", async () => {
    const plan = plan_load_test(
      OUTPUTS,
      {
        LOAD_RUN_ID: "failure",
        LOAD_GENERATOR_COUNT: "2",
        LOAD_START_DELAY_SECONDS: "1"
      },
      new Date("2026-09-07T12:00:00Z")
    )
    const run_tasks: string[] = []
    let describe_count = 0
    const aws = jest.fn((args: string[]) => {
      if (args[1] === "run-task") {
        const task = args[args.indexOf("--task-definition") + 1]!
        run_tasks.push(task)
        return {
          tasks: [{
            taskArn: `arn:task:${run_tasks.length}`
          }],
          failures: []
        }
      }
      describe_count += 1
      const arns = args.slice(args.indexOf("--tasks") + 1)
      const aggregate =
        run_tasks[run_tasks.length - 1] === plan.aggregate_task
      return {
        tasks: arns.map((taskArn, index) => ({
          taskArn,
          lastStatus: "STOPPED",
          containers: [{
            name: aggregate
              ? "garnet-load-aggregate"
              : "garnet-load-generator",
            exitCode: aggregate || index === 0 ? 0 : 1,
            reason: "synthetic failure"
          }]
        })),
        failures: []
      }
    })

    await expect(run_plan(plan, {
      aws,
      sleep_fn: async () => {},
      now: () => 0,
      log: () => {}
    })).rejects.toThrow("synthetic failure")

    expect(run_tasks).toEqual([
      plan.generator_task,
      plan.generator_task,
      plan.aggregate_task
    ])
    expect(describe_count).toBe(2)
  })
})
