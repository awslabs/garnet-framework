const {
  database_members,
  metric_data_queries,
  metric_data_reasons,
  metric_sum
} = require('./telemetry-metrics.js')

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
  return result
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
}

const assert_application_totals = (report, metric_response) => {
  const started_requests = report.totals?.started
  if (
    !Number.isSafeInteger(started_requests) ||
    started_requests <= 0 ||
    metric_sum(metric_response, 'app_requests') < started_requests
  ) {
    throw new Error(
      'application request telemetry does not account for the load report'
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
  const metric_window = {
    started_at: report.startedAt,
    completed_at: report.completedAt
  }
  const reasons = metric_data_reasons(metric_response, metric_window)
  if (reasons.length > 0) {
    throw new Error(`telemetry metrics are incomplete: ${reasons.join('; ')}`)
  }
  assert_application_totals(report, metric_response)
  const started_at = timestamp(report.startedAt, 'aggregate report.startedAt')
  const completed_at = timestamp(
    report.completedAt,
    'aggregate report.completedAt'
  )
  if (Date.parse(completed_at) < Date.parse(started_at)) {
    throw new Error(
      'aggregate report.completedAt shall not precede startedAt'
    )
  }
  const collection_timestamp = timestamp(
    collected_at,
    'collection.collectedAt'
  )
  if (Date.parse(collection_timestamp) < Date.parse(completed_at)) {
    throw new Error(
      'collection.collectedAt shall not precede report completion'
    )
  }
  return {
    schemaVersion: 1,
    kind: 'native-telemetry-evidence',
    evidenceId: telemetry.group_id,
    source: 'aws-cloudwatch-get-metric-data',
    awsRegion: telemetry.aws_region,
    image: telemetry.image,
    startedAt: started_at,
    completedAt: completed_at,
    trialTelemetryIds: [telemetry.trial_id],
    collection: {
      runId: telemetry.run_id,
      trialTelemetryId: telemetry.trial_id,
      accountId: account_id,
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
      brokerCluster: telemetry.broker_cluster,
      databaseCluster: telemetry.database_cluster,
      databaseMembers: database_members(cluster),
      entityEventQueue: telemetry.event_queue,
      periodSeconds: 60,
      metricDataQueries: metric_data_queries(telemetry, cluster),
      metricDataResults: metric_response.MetricDataResults,
      messages: metric_response.Messages ?? []
    }
  }
}

const parse_artifact = (value, label) => {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    value.schemaVersion !== 1 ||
    value.kind !== 'native-telemetry-evidence'
  ) {
    throw new Error(`${label} is not native telemetry evidence schema 1`)
  }
  non_empty_string(value.evidenceId, `${label}.evidenceId`)
  non_empty_string(value.awsRegion, `${label}.awsRegion`)
  non_empty_string(value.image, `${label}.image`)
  if (value.source !== 'aws-cloudwatch-get-metric-data') {
    throw new Error(`${label}.source is not the AWS collector`)
  }
  const started_at = timestamp(value.startedAt, `${label}.startedAt`)
  const completed_at = timestamp(value.completedAt, `${label}.completedAt`)
  if (Date.parse(completed_at) < Date.parse(started_at)) {
    throw new Error(`${label}.completedAt shall not precede startedAt`)
  }
  if (
    !Array.isArray(value.trialTelemetryIds) ||
    value.trialTelemetryIds.length !== 1 ||
    typeof value.trialTelemetryIds[0] !== 'string' ||
    value.trialTelemetryIds[0].trim() === ''
  ) {
    throw new Error(`${label} shall contain exactly one trial telemetry id`)
  }
  if (
    value.collection === null ||
    typeof value.collection !== 'object' ||
    Array.isArray(value.collection)
  ) {
    throw new Error(`${label}.collection is required`)
  }
  const collection = value.collection
  non_empty_string(collection.runId, `${label}.collection.runId`)
  if (collection.trialTelemetryId !== value.trialTelemetryIds[0]) {
    throw new Error(
      `${label}.collection trial id does not match its artifact`
    )
  }
  non_empty_string(collection.accountId, `${label}.collection.accountId`)
  non_empty_string(
    collection.reportVersionId,
    `${label}.collection.reportVersionId`
  )
  non_empty_string(collection.reportETag, `${label}.collection.reportETag`)
  const collected_at = timestamp(
    collection.collectedAt,
    `${label}.collection.collectedAt`
  )
  if (Date.parse(collected_at) < Date.parse(completed_at)) {
    throw new Error(
      `${label}.collection.collectedAt shall not precede completedAt`
    )
  }
  if (
    !Array.isArray(collection.metricDataQueries) ||
    collection.metricDataQueries.length === 0
  ) {
    throw new Error(`${label}.collection.metricDataQueries is required`)
  }
  const metric_response = {
    MetricDataResults: collection.metricDataResults,
    Messages: collection.messages
  }
  const reasons = metric_data_reasons(metric_response, {
    started_at,
    completed_at
  })
  if (reasons.length > 0) {
    throw new Error(
      `${label}.collection telemetry is incomplete: ${reasons.join('; ')}`
    )
  }
  if (
    metric_sum(metric_response, 'app_5xx') !== 0 ||
    metric_sum(metric_response, 'app_rejected') !== 0
  ) {
    throw new Error(`${label}.collection reports failed or rejected requests`)
  }
  return value
}

const merge_telemetry_artifacts = artifacts => {
  if (!Array.isArray(artifacts) || artifacts.length === 0) {
    throw new Error('at least one telemetry artifact is required')
  }
  const runs = artifacts.map((artifact, index) =>
    parse_artifact(artifact, `artifact ${index + 1}`)
  )
  const first = runs[0]
  for (const artifact of runs.slice(1)) {
    for (const field of ['evidenceId', 'awsRegion', 'image']) {
      if (artifact[field] !== first[field]) {
        throw new Error(`telemetry artifacts disagree on ${field}`)
      }
    }
  }
  const trial_ids = runs.map(artifact => artifact.trialTelemetryIds[0])
  if (new Set(trial_ids).size !== trial_ids.length) {
    throw new Error('telemetry artifacts repeat a trial telemetry id')
  }
  return {
    schemaVersion: 1,
    kind: 'native-telemetry-evidence',
    evidenceId: first.evidenceId,
    source: 'aws-cloudwatch-get-metric-data',
    awsRegion: first.awsRegion,
    image: first.image,
    startedAt: new Date(Math.min(
      ...runs.map(artifact => Date.parse(artifact.startedAt))
    )).toISOString(),
    completedAt: new Date(Math.max(
      ...runs.map(artifact => Date.parse(artifact.completedAt))
    )).toISOString(),
    trialTelemetryIds: trial_ids,
    runs: runs.map(artifact => artifact.collection)
  }
}

module.exports = {
  build_telemetry_artifact,
  merge_telemetry_artifacts
}
