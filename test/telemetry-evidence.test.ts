const {
  build_telemetry_artifact,
  merge_telemetry_artifacts
} = require("../.github/scripts/telemetry-evidence.js")
const {
  REQUIRED_METRIC_IDS,
  metric_data_queries,
  metric_data_reasons
} = require("../.github/scripts/telemetry-metrics.js")

export {}

const IMAGE =
  `public.ecr.aws/garnet/broker@sha256:${"a".repeat(64)}`

const telemetry = {
  group_id: "garnet-release",
  trial_id: "garnet-release-5000-1",
  run_id: "release50001",
  aws_region: "eu-west-3",
  aws_account: "111111111111",
  image: IMAGE,
  broker_cluster: "garnet-broker-cluster",
  database_cluster: "garnet-broker-aurora",
  event_queue: "garnet-entity-events.fifo",
  report_uri:
    "s3://garnet-load/garnet-load/release/aggregate.json"
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

const report = {
  schemaVersion: 5,
  kind: "aggregate",
  status: "passed",
  validQualification: true,
  startedAt: "2026-09-10T10:00:00.000Z",
  completedAt: "2026-09-10T11:01:00.000Z",
  configuration: {
    runId: telemetry.run_id,
    externalTelemetryId: telemetry.trial_id,
    awsRegion: telemetry.aws_region,
    garnetImage: telemetry.image
  },
  totals: {
    started: 300000
  }
}

const complete_metrics = () => ({
  MetricDataResults: metric_data_queries(telemetry, cluster)
    .map((query: any) => ({
      Id: query.Id,
      StatusCode: "Complete",
      Timestamps: [
        "2026-09-10T10:01:00.000Z",
        "2026-09-10T11:00:00.000Z"
      ],
      Values: query.Id === "app_requests"
        ? [150000, 150000]
        : ["app_5xx", "app_rejected"].includes(query.Id)
          ? [0, 0]
          : [1, 1]
    })),
  Messages: []
})

describe("AWS qualification telemetry evidence", () => {
  it("binds one aggregate report to complete CloudWatch evidence", () => {
    const metrics = complete_metrics()
    expect(metric_data_reasons(metrics, {
      started_at: report.startedAt,
      completed_at: report.completedAt
    })).toEqual([])

    const artifact = build_telemetry_artifact({
      telemetry,
      report,
      report_source: {
        version_id: "aggregate-version-1",
        etag: "\"aggregate-etag\""
      },
      cluster,
      caller_identity: { Account: "111111111111" },
      metric_response: metrics,
      collected_at: "2026-09-10T11:05:00.000Z"
    })

    expect(artifact).toMatchObject({
      schemaVersion: 1,
      kind: "native-telemetry-evidence",
      evidenceId: "garnet-release",
      awsRegion: "eu-west-3",
      image: IMAGE,
      trialTelemetryIds: ["garnet-release-5000-1"],
      collection: {
        runId: "release50001",
        trialTelemetryId: "garnet-release-5000-1",
        accountId: "111111111111",
        reportVersionId: "aggregate-version-1",
        reportETag: "\"aggregate-etag\"",
        brokerCluster: "garnet-broker-cluster",
        databaseCluster: "garnet-broker-aurora",
        entityEventQueue: "garnet-entity-events.fifo",
        periodSeconds: 60
      }
    })
    expect(artifact.collection.metricDataQueries.length).toBeGreaterThan(30)
    expect(
      artifact.collection.metricDataResults
        .find((result: any) => result.Id === "app_requests")
        .Values
    ).toEqual([150000, 150000])
  })

  it("fails closed when required telemetry or report identity is missing", () => {
    const metrics = complete_metrics()
    metrics.MetricDataResults = metrics.MetricDataResults.filter(
      (result: any) => result.Id !== REQUIRED_METRIC_IDS[0]
    )

    expect(metric_data_reasons(metrics)).toContain(
      "app_requests has no valid datapoints"
    )
    expect(() => build_telemetry_artifact({
      telemetry,
      report,
      report_source: {
        version_id: "aggregate-version-1",
        etag: "\"aggregate-etag\""
      },
      cluster,
      caller_identity: { Account: "111111111111" },
      metric_response: metrics,
      collected_at: "2026-09-10T11:05:00.000Z"
    })).toThrow("app_requests has no valid datapoints")
    expect(() => build_telemetry_artifact({
      telemetry,
      report,
      report_source: {
        version_id: "aggregate-version-1",
        etag: "\"aggregate-etag\""
      },
      cluster,
      caller_identity: { Account: "111111111111" },
      metric_response: complete_metrics(),
      collected_at: "2026-09-10T11:05:00.000Z"
    })).not.toThrow()
    expect(() => build_telemetry_artifact({
      telemetry: { ...telemetry, image: `sha256:${"b".repeat(64)}` },
      report,
      report_source: {
        version_id: "aggregate-version-1",
        etag: "\"aggregate-etag\""
      },
      cluster,
      caller_identity: { Account: "111111111111" },
      metric_response: complete_metrics(),
      collected_at: "2026-09-10T11:05:00.000Z"
    })).toThrow(
      "aggregate report image does not match the qualification plan"
    )
    expect(() => build_telemetry_artifact({
      telemetry,
      report,
      report_source: {
        version_id: "aggregate-version-1",
        etag: "\"aggregate-etag\""
      },
      cluster,
      caller_identity: { Account: "222222222222" },
      metric_response: complete_metrics(),
      collected_at: "2026-09-10T11:05:00.000Z"
    })).toThrow(
      "AWS caller account does not match the deployed qualification account"
    )
  })

  it("merges independent trials without dropping their raw collections", () => {
    const first = build_telemetry_artifact({
      telemetry,
      report,
      report_source: {
        version_id: "aggregate-version-1",
        etag: "\"aggregate-etag\""
      },
      cluster,
      caller_identity: { Account: "111111111111" },
      metric_response: complete_metrics(),
      collected_at: "2026-09-10T11:05:00.000Z"
    })
    const second = structuredClone(first)
    second.startedAt = "2026-09-10T12:00:00.000Z"
    second.completedAt = "2026-09-10T13:01:00.000Z"
    second.trialTelemetryIds = ["garnet-release-5000-2"]
    second.collection.runId = "release50002"
    second.collection.trialTelemetryId = "garnet-release-5000-2"
    second.collection.collectedAt = "2026-09-10T13:05:00.000Z"
    second.collection.metricDataResults.forEach((result: any) => {
      result.Timestamps = [
        "2026-09-10T12:01:00.000Z",
        "2026-09-10T13:00:00.000Z"
      ]
    })

    const merged = merge_telemetry_artifacts([first, second])

    expect(merged.startedAt).toBe("2026-09-10T10:00:00.000Z")
    expect(merged.completedAt).toBe("2026-09-10T13:01:00.000Z")
    expect(merged.trialTelemetryIds).toEqual([
      "garnet-release-5000-1",
      "garnet-release-5000-2"
    ])
    expect(merged.runs).toHaveLength(2)
  })

  it("rejects malformed retained runs during merge", () => {
    const artifact = build_telemetry_artifact({
      telemetry,
      report,
      report_source: {
        version_id: "aggregate-version-1",
        etag: "\"aggregate-etag\""
      },
      cluster,
      caller_identity: { Account: "111111111111" },
      metric_response: complete_metrics(),
      collected_at: "2026-09-10T11:05:00.000Z"
    })
    artifact.collection.metricDataResults.find(
      (result: any) => result.Id === "app_5xx"
    ).Values = [0, 1]

    expect(() => merge_telemetry_artifacts([artifact])).toThrow(
      "reports failed or rejected requests"
    )
  })
})
