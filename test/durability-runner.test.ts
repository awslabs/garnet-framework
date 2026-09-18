import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

const {
  plan_durability_test
} = require("../.github/scripts/durability-plan.js")
const {
  run_durability_test
} = require("../.github/scripts/run-durability-test.js")
const {
  write_artifact
} = require("../.github/scripts/durability-aws.js")

export {}

const OUTPUTS = {
  GarnetEndpoint: "https://public.example",
  GarnetAwsRegion: "eu-west-3",
  GarnetAwsAccount: "111111111111",
  GarnetBrokerImage:
    `public.ecr.aws/garnet/broker@sha256:${"a".repeat(64)}`,
  GarnetDatabaseCluster: "garnet-broker-aurora",
  GarnetLoadReportBucket: "garnet-load-reports"
}

const cluster = (writer: string, status = "available") => ({
  DBClusterIdentifier: "garnet-broker-aurora",
  Status: status,
  DBClusterMembers: [{
    DBInstanceIdentifier: writer,
    IsClusterWriter: true
  }, {
    DBInstanceIdentifier:
      writer === "garnet-a" ? "garnet-b" : "garnet-a",
    IsClusterWriter: false
  }]
})

describe("AWS durability qualification runner", () => {
  it("plans a bounded explicit failover run", () => {
    const plan = plan_durability_test(OUTPUTS, {
      DURABILITY_RUN_ID: "release-42",
      DURABILITY_MUTATIONS: "8",
      DURABILITY_PRE_FAULT_MUTATIONS: "2"
    }, new Date("2026-09-10T05:00:00Z"))

    expect(plan).toMatchObject({
      run_id: "release42",
      evidence_id: "release42-failover-evidence",
      mutation_count: 8,
      pre_fault_mutations: 2,
      endpoint: "https://public.example",
      database_cluster: "garnet-broker-aurora",
      artifact_uri:
        "s3://garnet-load-reports/garnet-load/release42/" +
        "durability-evidence.json"
    })
  })

  it("requires enough mutations to prove every failover phase", () => {
    expect(() => plan_durability_test(OUTPUTS, {
      DURABILITY_MUTATIONS: "4",
      DURABILITY_PRE_FAULT_MUTATIONS: "2"
    })).toThrow(
      "DURABILITY_MUTATIONS shall leave one fault probe"
    )
  })

  it("fails over, reconciles every mutation, and cleans up probes", async () => {
    const plan = plan_durability_test(OUTPUTS, {
      DURABILITY_RUN_ID: "evidence",
      DURABILITY_MUTATIONS: "4",
      DURABILITY_PRE_FAULT_MUTATIONS: "1",
      DURABILITY_RETRY_DELAY_MS: "1",
      DURABILITY_POLL_INTERVAL_MS: "1"
    }, new Date("2026-09-10T05:00:00Z"))
    const values = new Map<string, string>()
    let time = Date.parse("2026-09-10T05:00:00.000Z")
    let fault_attempts = 0
    const request_fn = jest.fn(async (
      url: string,
      options: { method?: string; body?: string } = {}
    ) => {
      time += 100
      const match = /\/entities\/([^/?]+)(?:\/attrs)?/.exec(url)
      const entity_id =
        match === null ? undefined : decodeURIComponent(match[1]!)
      const method = options.method || "GET"
      if (method === "DELETE") {
        const existed = entity_id === undefined
          ? false
          : values.delete(entity_id)
        return { status: existed ? 204 : 404, body: "" }
      }
      if (method === "POST") {
        const body = JSON.parse(options.body!)
        values.set(body.id, body.status.value)
        return { status: 201, body: "" }
      }
      if (method === "PATCH") {
        const body = JSON.parse(options.body!)
        if (
          entity_id?.endsWith(":0002") &&
          fault_attempts++ === 0
        ) {
          throw new Error("synthetic connection reset")
        }
        values.set(entity_id!, body.status.value)
        return { status: 204, body: "" }
      }
      const value = values.get(entity_id!)
      return value === undefined
        ? { status: 404, body: "" }
        : {
            status: 200,
            body: JSON.stringify({
              id: entity_id,
              type: "DurabilityProbe",
              status: { type: "Property", value }
            })
          }
    })
    let describe_count = 0
    const cloudtrail = {
      EventId: "event-123",
      CloudTrailEvent: JSON.stringify({
        eventTime: "2026-09-10T05:00:02Z",
        eventName: "FailoverDBCluster",
        awsRegion: "eu-west-3",
        recipientAccountId: "111111111111",
        requestParameters: {
          dBClusterIdentifier: "garnet-broker-aurora"
        }
      })
    }
    const aws = jest.fn((args: string[]) => {
      if (args[0] === "rds" && args[1] === "describe-db-clusters") {
        describe_count += 1
        return {
          DBClusters: [
            describe_count === 1
              ? cluster("garnet-a")
              : cluster("garnet-b")
          ]
        }
      }
      if (args[0] === "rds" && args[1] === "failover-db-cluster") {
        return { DBCluster: cluster("garnet-a", "failing-over") }
      }
      if (args[0] === "cloudtrail") {
        return { Events: [cloudtrail] }
      }
      if (args[0] === "sts") {
        return { Account: "111111111111" }
      }
      throw new Error(`unexpected AWS call: ${args.join(" ")}`)
    })
    let artifact: any

    const result = await run_durability_test(plan, {
      aws,
      token_loader: () => "Bearer token",
      request_fn,
      now: () => time,
      sleep_fn: async (milliseconds: number) => {
        time += milliseconds
      },
      log: () => {},
      write_artifact_fn: (_plan: any, value: any) => {
        artifact = value
        return { uri: plan.artifact_uri, sha256: "a".repeat(64) }
      }
    })

    expect(result).toMatchObject({
      uri: plan.artifact_uri,
      sha256: "a".repeat(64)
    })
    expect(artifact).toMatchObject({
      schemaVersion: 2,
      recovered: true,
      dataLoss: false,
      collection: {
        accountId: "111111111111",
        fault: { executionId: "event-123" }
      }
    })
    expect(artifact.collection.mutations).toHaveLength(4)
    expect(artifact.collection.attempts).toHaveLength(5)
    expect(artifact.collection.mutations.every(
      (mutation: any) =>
        mutation.expectedValue === mutation.observedValue
    )).toBe(true)
    expect(values.size).toBe(0)
  })

  it("writes mode-0600 evidence and uploads the exact file", () => {
    const plan = plan_durability_test(OUTPUTS, {
      DURABILITY_RUN_ID: "upload"
    })
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "garnet-durability-test-")
    )
    const calls: string[][] = []
    try {
      const result = write_artifact(plan, { schemaVersion: 2 }, {
        aws: (args: string[]) => {
          calls.push(args)
          return {
            VersionId: "version-1",
            ETag: "\"etag-1\""
          }
        },
        env: { DURABILITY_EVIDENCE_OUTPUT_DIR: directory },
        log: () => {}
      })

      expect(fs.statSync(result.path).mode & 0o777).toBe(0o600)
      expect(result).toMatchObject({
        uri: plan.artifact_uri,
        version_id: "version-1",
        etag: "\"etag-1\""
      })
      expect(
        calls[0][calls[0].indexOf("--body") + 1]
      ).toBe(result.path)
    } finally {
      fs.rmSync(directory, { recursive: true, force: true })
    }
  })
})
