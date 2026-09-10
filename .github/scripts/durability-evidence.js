const crypto = require('crypto')

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

const compare_strings = (left, right) =>
  left < right ? -1 : left > right ? 1 : 0

const mutation_digest = mutations => {
  const rows = mutations
    .map(({ mutationId, entityId, expectedValue }) => [
      mutationId,
      entityId,
      expectedValue
    ])
    .sort((left, right) =>
      compare_strings(left[0], right[0]) ||
      compare_strings(left[1], right[1]))
    .map(row => JSON.stringify(row))
  return crypto.createHash('sha256')
    .update(`${rows.join('\n')}\n`)
    .digest('hex')
}

const cluster_summary = cluster => {
  if (!cluster || typeof cluster !== 'object') {
    throw new Error('RDS cluster observation is missing')
  }
  const members = cluster.DBClusterMembers
  if (!Array.isArray(members) || members.length < 2) {
    throw new Error(
      'durability qualification requires an Aurora writer and reader'
    )
  }
  const summarized = members.map(member => ({
    identifier: non_empty_string(
      member.DBInstanceIdentifier,
      'RDS cluster member identifier'
    ),
    writer: member.IsClusterWriter === true
  }))
  if (summarized.filter(member => member.writer).length !== 1) {
    throw new Error('RDS cluster shall expose exactly one writer')
  }
  return {
    identifier: non_empty_string(
      cluster.DBClusterIdentifier,
      'RDS cluster identifier'
    ),
    status: non_empty_string(cluster.Status, 'RDS cluster status'),
    members: summarized
  }
}

const writer_identifier = cluster =>
  cluster_summary(cluster).members.find(member => member.writer).identifier

const parse_cloudtrail_event = (event, plan) => {
  const event_id = non_empty_string(
    event?.EventId,
    'CloudTrail failover EventId'
  )
  let raw
  try {
    raw = JSON.parse(event.CloudTrailEvent)
  } catch {
    throw new Error('CloudTrail failover event has invalid event JSON')
  }
  if (
    raw.eventName !== 'FailoverDBCluster' ||
    raw.awsRegion !== plan.aws_region ||
    raw.recipientAccountId !== plan.aws_account ||
    !JSON.stringify(raw.requestParameters || {})
      .includes(plan.database_cluster)
  ) {
    throw new Error(
      'CloudTrail event does not match this Aurora failover'
    )
  }
  return { event_id, raw }
}

const observation = (phase, source, at, cluster) => {
  const summary = cluster_summary(cluster)
  return {
    at: timestamp(at, `${phase} observation timestamp`),
    phase,
    source,
    state: summary.status,
    details: summary
  }
}

const validate_reconciliation = (
  mutations,
  attempts,
  { startedAt, failureInjectedAt, recoveredAt, completedAt }
) => {
  if (!Array.isArray(mutations) || mutations.length === 0) {
    throw new Error('durability mutations are required')
  }
  if (!Array.isArray(attempts) || attempts.length === 0) {
    throw new Error('durability attempts are required')
  }
  const mutation_ids = mutations.map(mutation =>
    non_empty_string(mutation.mutationId, 'mutation id'))
  const entity_ids = mutations.map(mutation =>
    non_empty_string(mutation.entityId, 'mutation Entity id'))
  if (new Set(mutation_ids).size !== mutation_ids.length) {
    throw new Error('durability mutation ids shall be unique')
  }
  if (new Set(entity_ids).size !== entity_ids.length) {
    throw new Error('durability mutation Entity ids shall be unique')
  }
  const mutation_id_set = new Set(mutation_ids)
  const attempt_ids = attempts.map(attempt =>
    non_empty_string(attempt.attemptId, 'attempt id'))
  if (new Set(attempt_ids).size !== attempt_ids.length) {
    throw new Error('durability attempt ids shall be unique')
  }
  const attempts_by_mutation = new Map()
  for (const attempt of attempts) {
    const mutation_id = non_empty_string(
      attempt.mutationId,
      'attempt mutation id'
    )
    if (!mutation_id_set.has(mutation_id)) {
      throw new Error(`attempt references unknown mutation ${mutation_id}`)
    }
    const started = timestamp(attempt.startedAt, 'attempt startedAt')
    const completed = timestamp(attempt.completedAt, 'attempt completedAt')
    if (
      Date.parse(started) < Date.parse(startedAt) ||
      Date.parse(completed) < Date.parse(started) ||
      Date.parse(completed) > Date.parse(completedAt)
    ) {
      throw new Error(`attempt timeline is invalid for ${mutation_id}`)
    }
    const grouped = attempts_by_mutation.get(mutation_id) || []
    grouped.push(attempt)
    attempts_by_mutation.set(mutation_id, grouped)
  }
  for (const mutation of mutations) {
    non_empty_string(mutation.expectedValue, 'mutation expected value')
    non_empty_string(mutation.observedValue, 'mutation observed value')
    if (mutation.expectedValue !== mutation.observedValue) {
      throw new Error(
        `durability reconciliation failed for ${mutation.entityId}`
      )
    }
    const acknowledged_at = timestamp(
      mutation.acknowledgedAt,
      'mutation acknowledgedAt'
    )
    const verified_at = timestamp(
      mutation.verifiedAt,
      'mutation verifiedAt'
    )
    if (
      Date.parse(acknowledged_at) > Date.parse(verified_at) ||
      Date.parse(verified_at) < Date.parse(recoveredAt) ||
      Date.parse(verified_at) > Date.parse(completedAt)
    ) {
      throw new Error(
        `durability verification timeline failed for ${mutation.entityId}`
      )
    }
    const grouped = attempts_by_mutation.get(mutation.mutationId) || []
    const acknowledged = grouped.filter(
      attempt => attempt.outcome === 'acknowledged'
    )
    if (
      grouped.length !== mutation.attemptCount ||
      acknowledged.length !== 1 ||
      Date.parse(acknowledged[0].completedAt) !==
        Date.parse(acknowledged_at) ||
      grouped.some(attempt =>
        Date.parse(attempt.startedAt) > Date.parse(acknowledged_at))
    ) {
      throw new Error(
        `durability attempt accounting failed for ${mutation.entityId}`
      )
    }
  }
  if (!mutations.some(mutation =>
    Date.parse(mutation.acknowledgedAt) <= Date.parse(failureInjectedAt))) {
    throw new Error('durability evidence has no pre-fault mutation')
  }
  if (!mutations.some(mutation =>
    Date.parse(mutation.acknowledgedAt) >= Date.parse(recoveredAt))) {
    throw new Error('durability evidence has no post-recovery mutation')
  }
  if (!attempts.some(attempt =>
    Date.parse(attempt.startedAt) <= Date.parse(recoveredAt) &&
    Date.parse(attempt.completedAt) >= Date.parse(failureInjectedAt))) {
    throw new Error('durability evidence has no fault-overlapping attempt')
  }
}

const build_durability_artifact = ({
  plan,
  started_at,
  failure_injected_at,
  recovered_at,
  completed_at,
  collected_at,
  caller_identity,
  cloudtrail_event,
  fault_response,
  before_cluster,
  requested_cluster,
  after_cluster,
  before_observed_at,
  fault_observed_at,
  after_observed_at,
  mutations,
  attempts
}) => {
  if (caller_identity?.Account !== plan.aws_account) {
    throw new Error(
      'AWS caller account does not match the deployed Garnet account'
    )
  }
  const trail = parse_cloudtrail_event(cloudtrail_event, plan)
  const startedAt = timestamp(started_at, 'durability startedAt')
  const failureInjectedAt = timestamp(
    failure_injected_at,
    'durability failureInjectedAt'
  )
  const recoveredAt = timestamp(recovered_at, 'durability recoveredAt')
  const completedAt = timestamp(completed_at, 'durability completedAt')
  const collectedAt = timestamp(collected_at, 'durability collectedAt')
  if (
    Date.parse(startedAt) > Date.parse(failureInjectedAt) ||
    Date.parse(failureInjectedAt) > Date.parse(recoveredAt) ||
    Date.parse(recoveredAt) > Date.parse(completedAt) ||
    Date.parse(completedAt) > Date.parse(collectedAt)
  ) {
    throw new Error('durability timestamps are not ordered')
  }
  validate_reconciliation(mutations, attempts, {
    startedAt,
    failureInjectedAt,
    recoveredAt,
    completedAt
  })
  if (
    Date.parse(before_observed_at) > Date.parse(failureInjectedAt) ||
    Date.parse(fault_observed_at) < Date.parse(failureInjectedAt) ||
    Date.parse(fault_observed_at) > Date.parse(recoveredAt) ||
    Date.parse(after_observed_at) < Date.parse(recoveredAt)
  ) {
    throw new Error('durability observation timestamps are not ordered')
  }

  return {
    schemaVersion: 2,
    kind: 'native-durability-evidence',
    evidenceId: plan.evidence_id,
    source: 'aws-rds-cloudtrail-and-api-reconciliation',
    durabilityProfile: plan.durability_profile,
    awsRegion: plan.aws_region,
    image: plan.image,
    startedAt,
    failureInjectedAt,
    recoveredAt,
    completedAt,
    failureMode: 'Aurora writer failover',
    recovered: true,
    dataLoss: false,
    collection: {
      accountId: plan.aws_account,
      collectedAt,
      mutationDigest: mutation_digest(mutations),
      fault: {
        provider: 'aws-rds-cloudtrail',
        operation: 'FailoverDBCluster',
        executionId: trail.event_id,
        target: plan.database_cluster,
        request: {
          DBClusterIdentifier: plan.database_cluster,
          Region: plan.aws_region
        },
        response: {
          failoverApi: fault_response,
          cloudTrail: trail.raw
        }
      },
      mutations,
      attempts,
      observations: [
        observation(
          'before-fault',
          'rds-describe-db-clusters',
          before_observed_at,
          before_cluster
        ),
        observation(
          'fault-requested',
          'rds-failover-db-cluster',
          fault_observed_at,
          requested_cluster
        ),
        observation(
          'after-recovery',
          'rds-describe-db-clusters',
          after_observed_at,
          after_cluster
        )
      ]
    }
  }
}

module.exports = {
  build_durability_artifact,
  cluster_summary,
  mutation_digest,
  parse_cloudtrail_event,
  writer_identifier
}
