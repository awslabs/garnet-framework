import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

const { plan_load_test } =
  require("../.github/scripts/load-test-plan.js")
const {
  collect_telemetry_evidence,
  run_plan
} =
  require("../.github/scripts/run-load-test.js")

export {}

const OUTPUTS = {
  GarnetLoadCluster: "garnet-cluster",
  GarnetLoadGeneratorTask: "generator-task:1",
  GarnetLoadAggregateTask: "aggregate-task:1",
  GarnetLoadSecurityGroup: "sg-123",
  GarnetLoadSubnets: "subnet-a,subnet-b",
  GarnetLoadReportBucket: "garnet-load-reports",
  GarnetLoadBrokerUrl: "http://internal.example",
  GarnetEndpoint: "https://public.example",
  GarnetAwsRegion: "eu-west-3",
  GarnetAwsAccount: "111111111111",
  GarnetBrokerImage:
    `public.ecr.aws/garnet/broker@sha256:${"a".repeat(64)}`,
  GarnetBrokerCluster: "garnet-broker-cluster",
  GarnetDatabaseCluster: "garnet-broker-aurora",
  GarnetEntityEventQueueName: "garnet-entity-events.fifo"
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
      LOAD_GENERATOR_COUNT: "3",
      LOAD_URL: "http://internal.example",
      LOAD_ENVIRONMENT: "aws-ecs-internal"
    })
    expect(environments[0]).not.toHaveProperty("LOAD_QUALIFICATION")
    expect(environments[0]).not.toHaveProperty("LOAD_HEADERS_JSON")
    expect(plan.qualification).toBe(false)
    expect(plan.report_uri).toBe(
      "s3://garnet-load-reports/garnet-load/release42/aggregate.json"
    )
  })

  it("routes qualification through public authenticated ingress", () => {
    const plan = plan_load_test(
      OUTPUTS,
      {
        LOAD_QUALIFICATION: "true",
        LOAD_GENERATOR_COUNT: "2",
        LOAD_START_DELAY_SECONDS: "60",
        LOAD_TELEMETRY_GROUP_ID: "garnet-release",
        LOAD_EXTERNAL_TELEMETRY_ID: "garnet-release-5000-1"
      },
      new Date("2026-09-07T12:00:00Z")
    )

    expect(plan.qualification).toBe(true)
    expect(plan.telemetry).toMatchObject({
      group_id: "garnet-release",
      trial_id: "garnet-release-5000-1",
      run_id: "R20260907120000",
      aws_region: "eu-west-3",
      aws_account: "111111111111",
      broker_cluster: "garnet-broker-cluster",
      database_cluster: "garnet-broker-aurora",
      event_queue: "garnet-entity-events.fifo",
      artifact_key:
        "garnet-load/R20260907120000/telemetry-evidence.json"
    })
    for (const override of plan.generator_overrides) {
      expect(override_environment(override)).toMatchObject({
        LOAD_URL: "https://public.example",
        LOAD_ENVIRONMENT: "aws-ecs",
        LOAD_QUALIFICATION: "1"
      })
      expect(override_environment(override))
        .not.toHaveProperty("LOAD_HEADERS_JSON")
    }
  })

  it("fails closed when public qualification has no deployed endpoint", () => {
    const { GarnetEndpoint: _endpoint, ...internal_outputs } = OUTPUTS

    expect(() => plan_load_test(internal_outputs, {
      LOAD_QUALIFICATION: "1",
      LOAD_TELEMETRY_GROUP_ID: "garnet-release",
      LOAD_EXTERNAL_TELEMETRY_ID: "garnet-release-1"
    })).toThrow("GarnetEndpoint is missing")
  })

  it("rejects an ambiguous qualification value", () => {
    expect(() => plan_load_test(OUTPUTS, {
      LOAD_QUALIFICATION: "sometimes"
    })).toThrow("LOAD_QUALIFICATION shall be 1, 0, true, or false")
  })

  it("requires an explicit telemetry group for qualification", () => {
    expect(() => plan_load_test(OUTPUTS, {
      LOAD_QUALIFICATION: "1",
      LOAD_EXTERNAL_TELEMETRY_ID: "garnet-release-1"
    })).toThrow(
      "LOAD_TELEMETRY_GROUP_ID is required for qualification"
    )
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

  it("collects telemetry only after a successful qualification aggregate", async () => {
    const plan = plan_load_test(
      OUTPUTS,
      {
        LOAD_RUN_ID: "qualification",
        LOAD_QUALIFICATION: "1",
        LOAD_TELEMETRY_GROUP_ID: "garnet-release",
        LOAD_EXTERNAL_TELEMETRY_ID: "garnet-release-5000-1",
        LOAD_START_DELAY_SECONDS: "1"
      },
      new Date("2026-09-07T12:00:00Z")
    )
    const task_definitions = new Map<string, string>()
    const aws = jest.fn((args: string[]) => {
      if (args[1] === "run-task") {
        const task_definition =
          args[args.indexOf("--task-definition") + 1]!
        const task_arn = `arn:task:${task_definitions.size + 1}`
        task_definitions.set(task_arn, task_definition)
        return {
          tasks: [{ taskArn: task_arn }],
          failures: []
        }
      }
      const arns = args.slice(args.indexOf("--tasks") + 1)
      return {
        tasks: arns.map(taskArn => ({
          taskArn,
          lastStatus: "STOPPED",
          containers: [{
            name: task_definitions.get(taskArn) === plan.aggregate_task
              ? "garnet-load-aggregate"
              : "garnet-load-generator",
            exitCode: 0
          }]
        })),
        failures: []
      }
    })
    let aggregate_launched = false
    const collect_telemetry = jest.fn(async () => {
      aggregate_launched = aws.mock.calls.some(
        call =>
          call[0][1] === "run-task" &&
          call[0].includes(plan.aggregate_task)
      )
    })

    await run_plan(plan, {
      aws,
      sleep_fn: async () => {},
      now: () => 0,
      log: () => {},
      collect_telemetry_fn: collect_telemetry
    })

    expect(collect_telemetry).toHaveBeenCalledTimes(1)
    expect(aggregate_launched).toBe(true)
  })

  it("writes and uploads raw telemetry evidence for the exact aggregate", async () => {
    const plan = plan_load_test(
      OUTPUTS,
      {
        LOAD_RUN_ID: "evidence",
        LOAD_QUALIFICATION: "1",
        LOAD_TELEMETRY_GROUP_ID: "garnet-release",
        LOAD_EXTERNAL_TELEMETRY_ID: "garnet-release-5000-1",
        LOAD_START_DELAY_SECONDS: "1"
      },
      new Date("2026-09-07T12:00:00Z")
    )
    const output_directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "garnet-evidence-test-")
    )
    const report = {
      schemaVersion: 5,
      kind: "aggregate",
      status: "passed",
      validQualification: true,
      startedAt: "2026-09-07T12:01:00.000Z",
      completedAt: "2026-09-07T13:02:00.000Z",
      configuration: {
        runId: "evidence",
        externalTelemetryId: "garnet-release-5000-1",
        awsRegion: "eu-west-3",
        garnetImage: OUTPUTS.GarnetBrokerImage
      },
      totals: {
        started: 2
      }
    }
    const cluster = {
      DBClusterMembers: [{
        DBInstanceIdentifier: "garnet-writer",
        IsClusterWriter: true
      }, {
        DBInstanceIdentifier: "garnet-reader",
        IsClusterWriter: false
      }]
    }
    const uploads: string[][] = []
    const aws = jest.fn((args: string[]) => {
      if (args[0] === "s3api" && args[1] === "get-object") {
        fs.writeFileSync(args[args.length - 1]!, JSON.stringify(report))
        return {
          VersionId: "aggregate-version-1",
          ETag: "\"aggregate-etag\""
        }
      }
      if (args[0] === "rds") {
        return { DBClusters: [cluster] }
      }
      if (args[0] === "cloudwatch") {
        const queries = JSON.parse(
          args[args.indexOf("--metric-data-queries") + 1]!
        )
        return {
          MetricDataResults: queries.map((query: any) => ({
            Id: query.Id,
            StatusCode: "Complete",
            Timestamps: [
              "2026-09-07T12:02:00.000Z",
              "2026-09-07T13:01:00.000Z"
            ],
            Values: ["app_5xx", "app_rejected"].includes(query.Id)
              ? [0, 0]
              : [1, 1]
          })),
          Messages: []
        }
      }
      if (args[0] === "sts") {
        return { Account: "111111111111" }
      }
      if (args[0] === "s3api" && args[1] === "put-object") {
        uploads.push(args)
        return { VersionId: "evidence-version-1" }
      }
      throw new Error(`unexpected AWS call: ${args.join(" ")}`)
    })

    try {
      const result = await collect_telemetry_evidence(plan, {
        aws,
        now: () => Date.parse("2026-09-07T13:05:00.000Z"),
        sleep_fn: async () => {},
        log: () => {},
        env: { LOAD_EVIDENCE_OUTPUT_DIR: output_directory }
      })

      expect(result).toMatchObject({
        uri:
          "s3://garnet-load-reports/garnet-load/evidence/telemetry-evidence.json",
        version_id: "evidence-version-1"
      })
      const artifact = JSON.parse(
        fs.readFileSync(result.path, "utf8")
      )
      expect(artifact).toMatchObject({
        evidenceId: "garnet-release",
        trialTelemetryIds: ["garnet-release-5000-1"],
        collection: {
          runId: "evidence",
          trialTelemetryId: "garnet-release-5000-1",
          accountId: "111111111111",
          reportVersionId: "aggregate-version-1",
          reportETag: "\"aggregate-etag\"",
          databaseMembers: [
            { identifier: "garnet-writer", writer: true },
            { identifier: "garnet-reader", writer: false }
          ]
        }
      })
      expect(uploads).toHaveLength(1)
      expect(
        uploads[0][uploads[0].indexOf("--key") + 1]
      ).toBe("garnet-load/evidence/telemetry-evidence.json")
    } finally {
      fs.rmSync(output_directory, { recursive: true, force: true })
    }
  })
})
