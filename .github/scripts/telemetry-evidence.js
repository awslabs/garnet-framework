const {
  database_topology,
  metric_data_queries,
  metric_data_reasons,
  metric_sum,
  telemetry_metrics
} = require('./telemetry-metrics.js')

const SHA256 = /^[0-9a-f]{64}$/i

const non_empty_string = (value, label) => {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${label} shall be a non-empty string`)
  }
  return value
}

const timestamp = (value, label) => {
  const result = non_empty_string(value, label)
  if (!Number.isFinite(Date.parse(result))) {
    throw new Error(`${label} shall be an ISO-8601 timestamp`)
  }
  return new Date(result).toISOString()
}

const positive_integer = (value, label) => {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${label} shall be a positive safe integer`)
  }
  return value
}

const non_negative_integer = (value, label) => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} shall be a non-negative safe integer`)
  }
  return value
}

const sha256 = (value, label) => {
  const result = non_empty_string(value, label)
  if (!SHA256.test(result)) {
    throw new Error(`${label} shall be a sha256 digest`)
  }
  return result
}

const qualification_window = report => {
  const configuration = report?.configuration
  const start = configuration?.startAtEpochMs
  const duration = configuration?.durationSeconds
  if (!Number.isSafeInteger(start) || start <= 0) {
    throw new Error(
      'aggregate report.configuration.startAtEpochMs is required'
    )
  }
  if (!Number.isSafeInteger(duration) || duration <= 0) {
    throw new Error(
      'aggregate report.configuration.durationSeconds is required'
    )
  }
  const end = start + duration * 1000
  if (
    start % 60_000 !== 0 ||
    end % 60_000 !== 0
  ) {
    throw new Error(
      'qualification telemetry window shall use aligned whole minutes'
    )
  }
  return {
    started_at: new Date(start).toISOString(),
    completed_at: new Date(end).toISOString()
  }
}

const assert_report_identity = (telemetry, report) => {
  if (
    report?.schemaVersion !== 5 ||
    report?.kind !== 'aggregate' ||
    report?.status !== 'passed' ||
    report?.validQualification !== true
  ) {
    throw new Error(
      'telemetry evidence requires a passing aggregate qualification report'
    )
  }
  const configuration = report.configuration
  if (configuration?.runId !== telemetry.run_id) {
    throw new Error(
      'aggregate report run id does not match the qualification plan'
    )
  }
  if (configuration?.externalTelemetryId !== telemetry.trial_id) {
    throw new Error(
      'aggregate report telemetry id does not match the qualification plan'
    )
  }
  if (configuration?.awsRegion !== telemetry.aws_region) {
    throw new Error(
      'aggregate report region does not match the qualification plan'
    )
  }
  if (configuration?.garnetImage !== telemetry.image) {
    throw new Error(
      'aggregate report image does not match the qualification plan'
    )
  }
  qualification_window(report)
}

const report_5xx = report => {
  if (!Array.isArray(report?.targets)) {
    throw new Error('aggregate report.targets is required')
  }
  let total = 0
  for (const [target_index, target] of report.targets.entries()) {
    const statuses = target?.statuses
    if (
      statuses === null ||
      typeof statuses !== 'object' ||
      Array.isArray(statuses)
    ) {
      throw new Error(
        `aggregate report.targets[${target_index}].statuses is required`
      )
    }
    for (const [status, count] of Object.entries(statuses)) {
      const numeric = Number(status)
      const value = non_negative_integer(
        count,
        `aggregate report.targets[${target_index}].statuses.${status}`
      )
      if (numeric >= 500 && numeric <= 599) total += value
    }
  }
  return total
}

const assert_application_totals = (report, metric_response) => {
  const started_requests = non_negative_integer(
    report?.steady?.started,
    'aggregate report.steady.started'
  )
  const ingress_requests = metric_sum(
    metric_response,
    'ingress_requests'
  )
  if (ingress_requests !== started_requests) {
    throw new Error(
      `public ingress telemetry counted ` +
      `${ingress_requests}/${started_requests} load requests`
    )
  }
  const expected_5xx = report_5xx(report)
  const ingress_5xx = metric_sum(metric_response, 'ingress_5xx')
  if (ingress_5xx !== expected_5xx) {
    throw new Error(
      `public ingress telemetry counted ` +
      `${ingress_5xx}/${expected_5xx} HTTP 5xx responses`
    )
  }
  if (metric_sum(metric_response, 'app_5xx') !== 0) {
    throw new Error('application telemetry reports HTTP 5xx responses')
  }
  if (metric_sum(metric_response, 'app_rejected') !== 0) {
    throw new Error('application telemetry reports rejected requests')
  }
}

const build_telemetry_artifact = ({
  telemetry,
  report,
  report_source,
  cluster,
  caller_identity,
  metric_response,
  collected_at
}) => {
  assert_report_identity(telemetry, report)
  const account_id = non_empty_string(
    caller_identity?.Account,
    'caller identity.Account'
  )
  if (account_id !== telemetry.aws_account) {
    throw new Error(
      'AWS caller account does not match the deployed qualification account'
    )
  }
  const window = qualification_window(report)
  const topology = database_topology(telemetry.database_topology)
  const metrics = telemetry_metrics(topology)
  const queries = metric_data_queries(telemetry, cluster)
  const reasons = metric_data_reasons(
    metric_response,
    window,
    queries,
    metrics
  )
  if (reasons.length > 0) {
    throw new Error(`telemetry metrics are incomplete: ${reasons.join('; ')}`)
  }
  assert_application_totals(report, metric_response)
  const collection_timestamp = timestamp(
    collected_at,
    'telemetry run.collectedAt'
  )
  if (
    Date.parse(collection_timestamp) <
    Date.parse(window.completed_at)
  ) {
    throw new Error(
      'telemetry run.collectedAt shall not precede report completion'
    )
  }
  const run = {
    runId: telemetry.run_id,
    trialTelemetryId: telemetry.trial_id,
    accountId: account_id,
    startedAt: window.started_at,
    completedAt: window.completed_at,
    collectedAt: collection_timestamp,
    report: telemetry.report_uri,
    reportVersionId: non_empty_string(
      report_source?.version_id,
      'aggregate report source.VersionId'
    ),
    reportETag: non_empty_string(
      report_source?.etag,
      'aggregate report source.ETag'
    ),
    reportSha256: sha256(
      report_source?.sha256,
      'aggregate report source.sha256'
    ),
    periodSeconds: 60,
    scanBy: 'TimestampAscending',
    pageCount: 1,
    nextTokenExhausted: true,
    messages: metric_response.Messages ?? [],
    metrics,
    metricDataQueries: queries,
    metricDataResults: metric_response.MetricDataResults
  }
  return {
    schemaVersion: 3,
    kind: 'native-telemetry-evidence',
    evidenceId: telemetry.group_id,
    source: 'aws-cloudwatch-get-metric-data',
    awsRegion: telemetry.aws_region,
    image: telemetry.image,
    databaseTopology: topology,
    startedAt: window.started_at,
    completedAt: collection_timestamp,
    trialTelemetryIds: [telemetry.trial_id],
    runs: [run]
  }
}

const same_metrics = (value, topology) =>
  JSON.stringify(value) === JSON.stringify(telemetry_metrics(topology))

const parse_run = (run, label, topology) => {
  if (run === null || typeof run !== 'object' || Array.isArray(run)) {
    throw new Error(`${label} shall be an object`)
  }
  const started_at = timestamp(run.startedAt, `${label}.startedAt`)
  const completed_at = timestamp(run.completedAt, `${label}.completedAt`)
  const collected_at = timestamp(run.collectedAt, `${label}.collectedAt`)
  if (
    Date.parse(completed_at) <= Date.parse(started_at) ||
    Date.parse(collected_at) < Date.parse(completed_at)
  ) {
    throw new Error(`${label} timestamps are not ordered`)
  }
  if (run.periodSeconds !== 60) {
    throw new Error(`${label}.periodSeconds shall be 60`)
  }
  if (run.scanBy !== 'TimestampAscending') {
    throw new Error(`${label}.scanBy shall be TimestampAscending`)
  }
  if (run.nextTokenExhausted !== true) {
    throw new Error(`${label}.nextTokenExhausted shall be true`)
  }
  if (!Array.isArray(run.messages) || run.messages.length !== 0) {
    throw new Error(`${label}.messages shall be empty`)
  }
  if (!same_metrics(run.metrics, topology)) {
    throw new Error(`${label}.metrics shall cover canonical telemetry roles`)
  }
  const metric_response = {
    MetricDataResults: run.metricDataResults,
    Messages: run.messages
  }
  const reasons = metric_data_reasons(
    metric_response,
    {
      started_at,
      completed_at
    },
    run.metricDataQueries,
    run.metrics
  )
  if (reasons.length > 0) {
    throw new Error(`${label} telemetry is incomplete: ${reasons.join('; ')}`)
  }
  if (
    metric_sum(metric_response, 'app_5xx') !== 0 ||
    metric_sum(metric_response, 'app_rejected') !== 0
  ) {
    throw new Error(`${label} reports failed or rejected application requests`)
  }
  non_empty_string(run.runId, `${label}.runId`)
  non_empty_string(run.trialTelemetryId, `${label}.trialTelemetryId`)
  const account = non_empty_string(run.accountId, `${label}.accountId`)
  if (!/^\d{12}$/.test(account)) {
    throw new Error(`${label}.accountId shall be a 12-digit AWS account`)
  }
  non_empty_string(run.report, `${label}.report`)
  const report_version = non_empty_string(
    run.reportVersionId,
    `${label}.reportVersionId`
  )
  if (report_version === 'null') {
    throw new Error(`${label}.reportVersionId requires S3 versioning`)
  }
  non_empty_string(run.reportETag, `${label}.reportETag`)
  sha256(run.reportSha256, `${label}.reportSha256`)
  positive_integer(run.pageCount, `${label}.pageCount`)
  return {
    ...run,
    startedAt: started_at,
    completedAt: completed_at,
    collectedAt: collected_at
  }
}

const parse_artifact = (value, label) => {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    value.schemaVersion !== 3 ||
    value.kind !== 'native-telemetry-evidence'
  ) {
    throw new Error(`${label} is not native telemetry evidence schema 3`)
  }
  if (value.source !== 'aws-cloudwatch-get-metric-data') {
    throw new Error(`${label}.source is not the AWS collector`)
  }
  const evidence_id = non_empty_string(
    value.evidenceId,
    `${label}.evidenceId`
  )
  const aws_region = non_empty_string(
    value.awsRegion,
    `${label}.awsRegion`
  )
  const image = non_empty_string(value.image, `${label}.image`)
  const topology = database_topology(value.databaseTopology)
  const started_at = timestamp(value.startedAt, `${label}.startedAt`)
  const completed_at = timestamp(value.completedAt, `${label}.completedAt`)
  if (!Array.isArray(value.runs) || value.runs.length === 0) {
    throw new Error(`${label}.runs shall be a non-empty array`)
  }
  const runs = value.runs.map(
    (run, index) =>
      parse_run(run, `${label}.runs[${index}]`, topology)
  )
  const trial_ids = runs.map(run => run.trialTelemetryId)
  if (
    !Array.isArray(value.trialTelemetryIds) ||
    JSON.stringify(value.trialTelemetryIds) !== JSON.stringify(trial_ids)
  ) {
    throw new Error(`${label}.trialTelemetryIds shall match its runs`)
  }
  const earliest = Math.min(
    ...runs.map(run => Date.parse(run.startedAt))
  )
  const latest = Math.max(
    ...runs.map(run => Date.parse(run.collectedAt))
  )
  if (
    Date.parse(started_at) !== earliest ||
    Date.parse(completed_at) !== latest
  ) {
    throw new Error(`${label} window shall match its runs`)
  }
  if (
    new Set(trial_ids).size !== trial_ids.length ||
    new Set(runs.map(run => run.runId)).size !== runs.length
  ) {
    throw new Error(`${label} repeats a trial or run id`)
  }
  return {
    schemaVersion: 3,
    kind: 'native-telemetry-evidence',
    evidenceId: evidence_id,
    source: 'aws-cloudwatch-get-metric-data',
    awsRegion: aws_region,
    image,
    databaseTopology: topology,
    startedAt: started_at,
    completedAt: completed_at,
    trialTelemetryIds: trial_ids,
    runs
  }
}

const windows_overlap = (left, right) =>
  Date.parse(left.startedAt) < Date.parse(right.completedAt) &&
  Date.parse(right.startedAt) < Date.parse(left.completedAt)

const merge_telemetry_artifacts = artifacts => {
  if (!Array.isArray(artifacts) || artifacts.length === 0) {
    throw new Error('at least one telemetry artifact is required')
  }
  const parsed = artifacts.map((artifact, index) =>
    parse_artifact(artifact, `artifact ${index + 1}`)
  )
  const first = parsed[0]
  for (const artifact of parsed.slice(1)) {
    for (const field of [
      'evidenceId',
      'awsRegion',
      'image',
      'source',
      'databaseTopology'
    ]) {
      if (artifact[field] !== first[field]) {
        throw new Error(`telemetry artifacts disagree on ${field}`)
      }
    }
  }
  const runs = parsed
    .flatMap(artifact => artifact.runs)
    .sort(
      (left, right) =>
        Date.parse(left.startedAt) - Date.parse(right.startedAt)
    )
  if (
    new Set(runs.map(run => run.trialTelemetryId)).size !== runs.length ||
    new Set(runs.map(run => run.runId)).size !== runs.length ||
    new Set(runs.map(run =>
      `${run.report}\n${run.reportVersionId}`
    )).size !== runs.length ||
    new Set(runs.map(run => run.accountId)).size !== 1
  ) {
    throw new Error(
      'telemetry runs shall use unique ids and reports in one AWS account'
    )
  }
  for (let left = 0; left < runs.length; left++) {
    for (let right = left + 1; right < runs.length; right++) {
      if (windows_overlap(runs[left], runs[right])) {
        throw new Error('telemetry run windows shall not overlap')
      }
    }
  }
  return parse_artifact({
    schemaVersion: 3,
    kind: 'native-telemetry-evidence',
    evidenceId: first.evidenceId,
    source: first.source,
    awsRegion: first.awsRegion,
    image: first.image,
    databaseTopology: first.databaseTopology,
    startedAt: runs[0].startedAt,
    completedAt: new Date(Math.max(
      ...runs.map(run => Date.parse(run.collectedAt))
    )).toISOString(),
    trialTelemetryIds: runs.map(run => run.trialTelemetryId),
    runs
  }, 'merged telemetry evidence')
}

module.exports = {
  build_telemetry_artifact,
  merge_telemetry_artifacts,
  qualification_window
}
