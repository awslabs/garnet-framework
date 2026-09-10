const setting = (values, name) => {
  const value = values[name]?.trim()
  return value === undefined || value === '' ? undefined : value
}

const required_output = (outputs, name) => {
  const value = outputs[name]
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${name} is missing from the deployed stack outputs`)
  }
  return value
}

const positive_integer = (env, name, fallback, maximum) => {
  const raw = setting(env, name)
  const value = raw === undefined ? fallback : Number(raw)
  if (
    !Number.isSafeInteger(value) ||
    value < 1 ||
    (maximum !== undefined && value > maximum)
  ) {
    throw new Error(
      `${name} shall be an integer from 1 to ${maximum ?? 'the safe limit'}`
    )
  }
  return value
}

const durability_run_id = (raw, now) => {
  const candidate =
    raw ||
    `D${now.toISOString().replaceAll(/[-:.TZ]/g, '').slice(0, 14)}`
  const normalized = candidate.replaceAll(/[^A-Za-z0-9]/g, '').slice(0, 32)
  if (normalized === '') {
    throw new Error('DURABILITY_RUN_ID shall contain letters or digits')
  }
  return /^[A-Za-z]/.test(normalized) ? normalized : `D${normalized}`
}

const plan_durability_test = (
  outputs,
  env = process.env,
  now = new Date()
) => {
  const run_id = durability_run_id(
    setting(env, 'DURABILITY_RUN_ID'),
    now
  )
  const mutation_count = positive_integer(
    env,
    'DURABILITY_MUTATIONS',
    12,
    1000
  )
  const pre_fault_mutations = positive_integer(
    env,
    'DURABILITY_PRE_FAULT_MUTATIONS',
    3,
    997
  )
  if (mutation_count < pre_fault_mutations + 3) {
    throw new Error(
      'DURABILITY_MUTATIONS shall leave one fault probe, one recovery ' +
      'probe, and one post-recovery mutation'
    )
  }
  const timeout_seconds = positive_integer(
    env,
    'DURABILITY_TIMEOUT_SECONDS',
    900,
    3600
  )
  const cloudtrail_wait_seconds = positive_integer(
    env,
    'DURABILITY_CLOUDTRAIL_WAIT_SECONDS',
    300,
    900
  )
  const request_timeout_ms = positive_integer(
    env,
    'DURABILITY_REQUEST_TIMEOUT_MS',
    5000,
    60000
  )
  const retry_delay_ms = positive_integer(
    env,
    'DURABILITY_RETRY_DELAY_MS',
    250,
    10000
  )
  const poll_interval_ms = positive_integer(
    env,
    'DURABILITY_POLL_INTERVAL_MS',
    1000,
    30000
  )
  const report_bucket = required_output(
    outputs,
    'GarnetLoadReportBucket'
  )
  const endpoint = required_output(outputs, 'GarnetEndpoint')
    .replace(/\/$/, '')
  const evidence_id =
    setting(env, 'DURABILITY_EVIDENCE_ID') ||
    `${run_id}-failover-evidence`
  const durability_profile =
    setting(env, 'DURABILITY_PROFILE') || 'multi-az-synchronous'
  const artifact_key =
    `garnet-load/${run_id}/durability-evidence.json`

  return {
    run_id,
    evidence_id,
    durability_profile,
    mutation_count,
    pre_fault_mutations,
    timeout_ms: timeout_seconds * 1000,
    cloudtrail_wait_ms: cloudtrail_wait_seconds * 1000,
    request_timeout_ms,
    retry_delay_ms,
    poll_interval_ms,
    endpoint,
    token_secret_arn: required_output(
      outputs,
      'GarnetApiTokenSecretArn'
    ),
    aws_region: required_output(outputs, 'GarnetAwsRegion'),
    aws_account: required_output(outputs, 'GarnetAwsAccount'),
    image: required_output(outputs, 'GarnetBrokerImage'),
    database_cluster: required_output(
      outputs,
      'GarnetDatabaseCluster'
    ),
    report_bucket,
    artifact_key,
    artifact_uri: `s3://${report_bucket}/${artifact_key}`
  }
}

module.exports = {
  plan_durability_test
}
