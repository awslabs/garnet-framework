const {
  build_telemetry_artifact,
  merge_telemetry_artifacts,
  qualification_window
} = require("../.github/scripts/telemetry-evidence.js")
const {
  metric_data_queries,
  metric_data_reasons,
  telemetry_metrics
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
  database_topology: "writer-reader",
  event_queue: "garnet-entity-events.fifo",
  api_id: "api-123",
  api_stage: "$default",
  lake_stream: "garnet-lake",
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
  startedAt: "2026-09-10T09:55:00.000Z",
  completedAt: "2026-09-10T11:01:00.000Z",
  configuration: {
    runId: telemetry.run_id,
    externalTelemetryId: telemetry.trial_id,
    awsRegion: telemetry.aws_region,
    garnetImage: telemetry.image,
    startAtEpochMs: Date.parse("2026-09-10T10:00:00.000Z"),
    durationSeconds: 3600
  },
  steady: {
    started: 300000
  },
  targets: [{
    statuses: {
      "200": 270000,
      "204": 30000
    }
  }]
}

const source = {
  version_id: "aggregate-version-1",
  etag: "\"aggregate-etag\"",
  sha256: "b".repeat(64)
}

const timestamps = (value: any) => {
  const start = value.configuration.startAtEpochMs
  const periods = value.configuration.durationSeconds / 60
  return Array.from(
    { length: periods },
    (_, index) => new Date(start + index * 60_000).toISOString()
  )
}

const complete_metrics = (
  selected_telemetry: any = telemetry,
  selected_report: any = report
) => {
  const sample_timestamps = timestamps(selected_report)
  const requests_per_period =
    selected_report.steady.started / sample_timestamps.length
  const queries = metric_data_queries(selected_telemetry, cluster)
  return {
    queries,
    response: {
      MetricDataResults: queries
        .filter((query: any) => query.ReturnData)
        .map((query: any) => ({
          Id: query.Id,
          StatusCode: "Complete",
          Timestamps: sample_timestamps,
          Values: sample_timestamps.map(() => {
            if (
              query.Id === "ingress_requests" ||
              query.Id === "app_requests"
            ) {
              return requests_per_period
            }
            if (
              [
                "ingress_5xx",
                "app_5xx",
                "app_rejected",
                "sqs_age",
                "sqs_visible",
                "firehose_failed_rows",
                "firehose_throttled",
                "firehose_partition_exceeded"
              ].includes(query.Id)
            ) {
              return 0
            }
            return query.Id === "ingress_p99" ? 0.02 : 1
          })
        })),
      Messages: []
    }
  }
}

const build = (
  selected_telemetry: any = telemetry,
  selected_report: any = report,
  collected_at = "2026-09-10T11:05:00.000Z",
  selected_source: any = source
) => {
  const metrics = complete_metrics(selected_telemetry, selected_report)
  return build_telemetry_artifact({
    telemetry: selected_telemetry,
    report: selected_report,
    report_source: selected_source,
    cluster,
    caller_identity: { Account: "111111111111" },
    metric_response: metrics.response,
    collected_at
  })
}

describe("AWS qualification telemetry evidence", () => {
  it("binds one aggregate report to canonical schema 2 evidence", () => {
    const metrics = complete_metrics()
    const window = qualification_window(report)
    expect(metric_data_reasons(
      metrics.response,
      window,
      metrics.queries,
      telemetry_metrics(telemetry.database_topology)
    )).toEqual([])

    const artifact = build()

    expect(artifact).toMatchObject({
      schemaVersion: 3,
      kind: "native-telemetry-evidence",
      evidenceId: "garnet-release",
      awsRegion: "eu-west-3",
      image: IMAGE,
      databaseTopology: "writer-reader",
      startedAt: "2026-09-10T10:00:00.000Z",
      completedAt: "2026-09-10T11:05:00.000Z",
      trialTelemetryIds: ["garnet-release-5000-1"],
      runs: [{
        runId: "release50001",
        trialTelemetryId: "garnet-release-5000-1",
        accountId: "111111111111",
        reportVersionId: "aggregate-version-1",
        reportETag: "\"aggregate-etag\"",
        reportSha256: "b".repeat(64),
        periodSeconds: 60,
        pageCount: 1,
        nextTokenExhausted: true
      }]
    })
    expect(artifact.runs[0].metricDataQueries.length).toBeGreaterThan(50)
    expect(
      artifact.runs[0].metricDataResults
        .find((result: any) => result.Id === "ingress_requests")
        .Values
    ).toHaveLength(60)
    expect(
      artifact.runs[0].metricDataQueries
        .find((query: any) => query.Id === "ingress_requests")
        .MetricStat.Metric
    ).toMatchObject({
      Namespace: "AWS/ApiGateway",
      MetricName: "Count",
      Dimensions: expect.arrayContaining([
        { Name: "ApiId", Value: "api-123" },
        { Name: "Stage", Value: "$default" }
      ])
    })
    expect(artifact.runs[0].metrics.map((metric: any) => metric.role))
      .toEqual(expect.arrayContaining([
        "database-writer-cpu-maximum-percent",
        "database-reader-cpu-maximum-percent",
        "database-replica-lag-maximum-milliseconds"
      ]))
    expect(
      artifact.runs[0].metricDataQueries.some(
        (query: any) => query.Id === "rds_writer_replica_lag"
      )
    ).toBe(false)
  })

  it("fails closed on missing samples, forged identity, or unaligned runs", () => {
    const metrics = complete_metrics()
    metrics.response.MetricDataResults =
      metrics.response.MetricDataResults.filter(
        (result: any) =>
          result.Id !== telemetry_metrics(
            telemetry.database_topology
          )[0].queryId
      )
    const window = qualification_window(report)
    expect(metric_data_reasons(
      metrics.response,
      window,
      metrics.queries,
      telemetry_metrics(telemetry.database_topology)
    )).toContain("ingress_requests has no valid datapoints")
    expect(() => build_telemetry_artifact({
      telemetry,
      report,
      report_source: source,
      cluster,
      caller_identity: { Account: "111111111111" },
      metric_response: metrics.response,
      collected_at: "2026-09-10T11:05:00.000Z"
    })).toThrow("ingress_requests has no valid datapoints")

    expect(() => build(
      { ...telemetry, image: `sha256:${"c".repeat(64)}` }
    )).toThrow(
      "aggregate report image does not match the qualification plan"
    )
    expect(() => build_telemetry_artifact({
      telemetry,
      report,
      report_source: source,
      cluster,
      caller_identity: { Account: "222222222222" },
      metric_response: complete_metrics().response,
      collected_at: "2026-09-10T11:05:00.000Z"
    })).toThrow(
      "AWS caller account does not match the deployed qualification account"
    )

    const unaligned = structuredClone(report)
    unaligned.configuration.startAtEpochMs += 1000
    expect(() => qualification_window(unaligned)).toThrow(
      "aligned whole minutes"
    )
  })

  it("rejects malformed queries and impossible canonical values", () => {
    const fractional = complete_metrics()
    fractional.response.MetricDataResults.find(
      (result: any) => result.Id === "ingress_requests"
    ).Values[0] = 4999.5
    expect(metric_data_reasons(
      fractional.response,
      qualification_window(report),
      fractional.queries,
      telemetry_metrics(telemetry.database_topology)
    )).toContain("ingress_requests does not contain integer counts")

    const excessive = complete_metrics()
    excessive.response.MetricDataResults.find(
      (result: any) => result.Id === "compute_cpu"
    ).Values[0] = 101
    expect(metric_data_reasons(
      excessive.response,
      qualification_window(report),
      excessive.queries,
      telemetry_metrics(telemetry.database_topology)
    )).toContain("compute_cpu exceeds 100 percent")

    const duplicate = complete_metrics()
    duplicate.queries[1].Id = duplicate.queries[0].Id
    expect(metric_data_reasons(
      duplicate.response,
      qualification_window(report),
      duplicate.queries,
      telemetry_metrics(telemetry.database_topology)
    )).toContain("telemetry metric queries repeat ids")
  })

  it("uses only writer roles for a shared read topology", () => {
    const artifact = build({
      ...telemetry,
      database_topology: "shared"
    })

    expect(artifact.databaseTopology).toBe("shared")
    expect(artifact.runs[0].metrics).toHaveLength(7)
    expect(artifact.runs[0].metrics.map((metric: any) => metric.role))
      .not.toContain("database-reader-cpu-maximum-percent")
    expect(artifact.runs[0].metricDataQueries.some(
      (query: any) => query.Id === "rds_reader_0_cpu"
    )).toBe(true)
  })

  it("requires a real reader for writer-reader evidence", () => {
    expect(() => metric_data_queries(telemetry, {
      DBClusterMembers: [{
        DBInstanceIdentifier: "garnet-writer",
        IsClusterWriter: true
      }]
    })).toThrow(
      "writer-reader telemetry requires at least one Aurora reader"
    )
  })

  it("merges independent trials into one canonical artifact", () => {
    const first = build()
    const second_telemetry = {
      ...telemetry,
      run_id: "release50002",
      trial_id: "garnet-release-5000-2",
      report_uri:
        "s3://garnet-load/garnet-load/release-2/aggregate.json"
    }
    const second_report = structuredClone(report)
    second_report.configuration.runId = second_telemetry.run_id
    second_report.configuration.externalTelemetryId =
      second_telemetry.trial_id
    second_report.configuration.startAtEpochMs =
      Date.parse("2026-09-10T12:00:00.000Z")
    const second = build(
      second_telemetry,
      second_report,
      "2026-09-10T13:05:00.000Z",
      {
        version_id: "aggregate-version-2",
        etag: "\"aggregate-etag-2\"",
        sha256: "c".repeat(64)
      }
    )

    const merged = merge_telemetry_artifacts([first, second])

    expect(merged.startedAt).toBe("2026-09-10T10:00:00.000Z")
    expect(merged.completedAt).toBe("2026-09-10T13:05:00.000Z")
    expect(merged.trialTelemetryIds).toEqual([
      "garnet-release-5000-1",
      "garnet-release-5000-2"
    ])
    expect(merged.runs).toHaveLength(2)
  })

  it("rejects failed application metrics during merge", () => {
    const artifact = build()
    artifact.runs[0].metricDataResults.find(
      (result: any) => result.Id === "app_5xx"
    ).Values[0] = 1

    expect(() => merge_telemetry_artifacts([artifact])).toThrow(
      "reports failed or rejected application requests"
    )
  })

  it("does not merge evidence collected with another database topology", () => {
    expect(() => merge_telemetry_artifacts([
      build(),
      build({ ...telemetry, database_topology: "shared" })
    ])).toThrow("telemetry artifacts disagree on databaseTopology")
  })
})
