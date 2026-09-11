const PASSTHROUGH_SETTINGS = [
  'LOAD_PROFILE',
  'LOAD_WORKLOAD',
  'LOAD_RATE',
  'LOAD_DURATION_SECONDS',
  'LOAD_WARMUP_SECONDS',
  'LOAD_FIXTURE_ENTITIES',
  'LOAD_SEED_BATCH_SIZE',
  'LOAD_MAX_IN_FLIGHT',
  'LOAD_REQUEST_TIMEOUT_MS',
  'LOAD_PUMP_INTERVAL_MS',
  'LOAD_SAMPLE_EVERY',
  'LOAD_DATABASE_EVENT_DRAIN',
  'LOAD_ALLOW_ERRORS',
  'LOAD_MAX_READ_P99_MS',
  'LOAD_MAX_WRITE_P99_MS',
  'LOAD_MAX_QUEUE_P99_MS',
  'LOAD_EXTERNAL_TELEMETRY_ID',
  'LOAD_SYSTEM_COST_PER_HOUR',
  'LOAD_TENANT',
  'GARNET_COMMIT'
]

const setting = (values, name) => {
  const value = values[name]?.trim()
  return value === undefined || value === '' ? undefined : value
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

const positive_number = (env, name, fallback) => {
  const raw = setting(env, name)
  const value = raw === undefined ? fallback : Number(raw)
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} shall be a positive number`)
  }
  return value
}

const boolean_setting = (env, name, fallback = false) => {
  const raw = setting(env, name)
  if (raw === undefined) return fallback
  if (raw === '1' || raw.toLowerCase() === 'true') return true
  if (raw === '0' || raw.toLowerCase() === 'false') return false
  throw new Error(`${name} shall be 1, 0, true, or false`)
}

const load_run_id = (raw, now) => {
  const candidate =
    raw ||
    `R${now.toISOString().replaceAll(/[-:.TZ]/g, '').slice(0, 14)}`
  const normalized = candidate.replaceAll(/[^A-Za-z0-9]/g, '').slice(0, 32)
  if (normalized === '') {
    throw new Error('LOAD_RUN_ID shall contain letters or digits')
  }
  return /^[A-Za-z]/.test(normalized) ? normalized : `R${normalized}`
}

const required_output = (outputs, name) => {
  const value = outputs[name]
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(
      `${name} is missing; deploy with a digest-pinned GARNET_LOAD_IMAGE first`
    )
  }
  return value
}

const environment = values =>
  Object.entries(values).map(([name, value]) => ({ name, value: String(value) }))

const plan_load_test = (outputs, env = process.env, now = new Date()) => {
  const qualification = boolean_setting(env, 'LOAD_QUALIFICATION')

  const generator_count = positive_integer(
    env,
    'LOAD_GENERATOR_COUNT',
    qualification ? 2 : 1,
    32
  )
  const fixture_entities = positive_integer(
    env,
    'LOAD_FIXTURE_ENTITIES',
    qualification ? 50_000 : 1000
  )
  const duration_seconds = positive_number(
    env,
    'LOAD_DURATION_SECONDS',
    qualification ? 3_600 : 10
  )
  const warmup_seconds = positive_number(
    env,
    'LOAD_WARMUP_SECONDS',
    qualification ? 60 : 2
  )
  const telemetry_wait_seconds = positive_integer(
    env,
    'LOAD_TELEMETRY_WAIT_SECONDS',
    900,
    3600
  )
  const start_delay_seconds = positive_number(
    env,
    'LOAD_START_DELAY_SECONDS',
    fixture_entities >= 50000 ? 900 : 120
  )
  const run_id = load_run_id(setting(env, 'LOAD_RUN_ID'), now)
  const telemetry_group_id = setting(env, 'LOAD_TELEMETRY_GROUP_ID')
  const telemetry_trial_id = setting(env, 'LOAD_EXTERNAL_TELEMETRY_ID')
  if (qualification) {
    if (generator_count < 2) {
      throw new Error(
        'LOAD_GENERATOR_COUNT shall be at least 2 for qualification'
      )
    }
    if (fixture_entities < 50_000) {
      throw new Error(
        'LOAD_FIXTURE_ENTITIES shall be at least 50000 for qualification'
      )
    }
    if (
      !Number.isSafeInteger(duration_seconds) ||
      duration_seconds < 3_600 ||
      duration_seconds % 60 !== 0
    ) {
      throw new Error(
        'LOAD_DURATION_SECONDS shall be whole minutes and at least 3600 for qualification'
      )
    }
    if (warmup_seconds < 60) {
      throw new Error(
        'LOAD_WARMUP_SECONDS shall be at least 60 for qualification'
      )
    }
    if (telemetry_group_id === undefined) {
      throw new Error(
        'LOAD_TELEMETRY_GROUP_ID is required for qualification'
      )
    }
    if (telemetry_trial_id === undefined) {
      throw new Error(
        'LOAD_EXTERNAL_TELEMETRY_ID is required for qualification'
      )
    }
    if (
      telemetry_trial_id !== telemetry_group_id &&
      !telemetry_trial_id.startsWith(`${telemetry_group_id}-`)
    ) {
      throw new Error(
        'LOAD_EXTERNAL_TELEMETRY_ID shall belong to LOAD_TELEMETRY_GROUP_ID'
      )
    }
  }
  const configured_start = setting(env, 'LOAD_START_AT')
  const requested_start = configured_start === undefined
    ? new Date(now.getTime() + start_delay_seconds * 1000)
    : new Date(
      Number.isFinite(Number(configured_start))
        ? Number(configured_start)
        : configured_start
    )
  const start_at =
    qualification && configured_start === undefined
      ? new Date(
        Math.ceil(requested_start.getTime() / 60_000) * 60_000
      )
      : requested_start
  if (
    Number.isNaN(start_at.getTime()) ||
    start_at.getTime() <= now.getTime()
  ) {
    throw new Error('LOAD_START_AT shall be a future epoch or ISO timestamp')
  }
  if (qualification && start_at.getTime() % 60_000 !== 0) {
    throw new Error(
      'LOAD_START_AT shall align to a whole minute for qualification'
    )
  }
  const actual_start_delay_seconds =
    Math.ceil((start_at.getTime() - now.getTime()) / 1000)

  const shared = {
    LOAD_RUN_ID: run_id,
    LOAD_GENERATOR_COUNT: String(generator_count),
    LOAD_FIXTURE_ENTITIES: String(fixture_entities),
    LOAD_DURATION_SECONDS: String(duration_seconds),
    LOAD_WARMUP_SECONDS: String(warmup_seconds),
    LOAD_START_AT: start_at.toISOString(),
    LOAD_URL: required_output(
      outputs,
      qualification ? 'GarnetEndpoint' : 'GarnetLoadBrokerUrl'
    ),
    LOAD_ENVIRONMENT: qualification ? 'aws-ecs' : 'aws-ecs-internal',
    ...(qualification ? { LOAD_QUALIFICATION: '1' } : {})
  }
  for (const name of PASSTHROUGH_SETTINGS) {
    const value = setting(env, name)
    if (value !== undefined) shared[name] = value
  }

  const subnets = required_output(outputs, 'GarnetLoadSubnets')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean)
  if (subnets.length === 0) {
    throw new Error('GarnetLoadSubnets contains no subnet ids')
  }
  const network_configuration = {
    awsvpcConfiguration: {
      subnets,
      securityGroups: [
        required_output(outputs, 'GarnetLoadSecurityGroup')
      ],
      assignPublicIp: 'DISABLED'
    }
  }
  const generator_overrides = Array.from(
    { length: generator_count },
    (_, index) => ({
      containerOverrides: [{
        name: 'garnet-load-generator',
        environment: environment({
          ...shared,
          LOAD_GENERATOR_INDEX: String(index),
          LOAD_SEED: index === 0 ? '1' : '0'
        })
      }]
    })
  )
  const report_bucket = required_output(
    outputs,
    'GarnetLoadReportBucket'
  )
  const report_key =
    `garnet-load/${run_id}/aggregate.json`
  const telemetry = qualification
    ? {
        group_id: telemetry_group_id,
        trial_id: telemetry_trial_id,
        run_id,
        aws_region: required_output(outputs, 'GarnetAwsRegion'),
        aws_account: required_output(outputs, 'GarnetAwsAccount'),
        image: required_output(outputs, 'GarnetBrokerImage'),
        broker_cluster: required_output(
          outputs,
          'GarnetBrokerCluster'
        ),
        database_cluster: required_output(
          outputs,
          'GarnetDatabaseCluster'
        ),
        database_topology: required_output(
          outputs,
          'GarnetDatabaseTopology'
        ),
        api_id: required_output(outputs, 'GarnetApiId'),
        api_stage: required_output(outputs, 'GarnetApiStage'),
        lake_stream: required_output(
          outputs,
          'GarnetLakeDeliveryStream'
        ),
        report_bucket,
        report_key,
        report_uri: `s3://${report_bucket}/${report_key}`,
        artifact_key:
          `garnet-load/${run_id}/telemetry-evidence.json`,
        wait_timeout_ms: telemetry_wait_seconds * 1000
      }
    : undefined

  return {
    cluster: required_output(outputs, 'GarnetLoadCluster'),
    generator_task: required_output(outputs, 'GarnetLoadGeneratorTask'),
    aggregate_task: required_output(outputs, 'GarnetLoadAggregateTask'),
    network_configuration,
    generator_overrides,
    aggregate_override: {
      containerOverrides: [{
        name: 'garnet-load-aggregate',
        environment: environment({
          LOAD_RUN_ID: run_id,
          LOAD_GENERATOR_COUNT: String(generator_count)
        })
      }]
    },
    qualification,
    telemetry,
    run_id,
    started_by: `garnet-${run_id}`.slice(0, 36),
    report_uri:
      `s3://${report_bucket}/${report_key}`,
    wait_timeout_ms:
      (
        actual_start_delay_seconds +
        warmup_seconds +
        duration_seconds +
        1800
      ) * 1000
  }
}

module.exports = {
  load_run_id,
  plan_load_test
}
