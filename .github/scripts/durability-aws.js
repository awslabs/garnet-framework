const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')
const {
  parse_cloudtrail_event,
  writer_identifier
} = require('./durability-evidence.js')

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

const aws_cli = args => {
  const output = execFileSync('aws', [...args, '--output', 'json'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit']
  })
  return JSON.parse(output)
}

const describe_cluster = (plan, aws = aws_cli) => {
  const result = aws([
    'rds',
    'describe-db-clusters',
    '--db-cluster-identifier',
    plan.database_cluster,
    '--region',
    plan.aws_region
  ])
  if (!Array.isArray(result.DBClusters) || result.DBClusters.length !== 1) {
    throw new Error('RDS did not return the exact Garnet cluster')
  }
  return result.DBClusters[0]
}

const wait_for_writer_change = async (
  plan,
  previous_writer,
  {
    aws = aws_cli,
    sleep_fn = sleep,
    now = Date.now,
    deadline_ms
  }
) => {
  while (now() < deadline_ms) {
    const cluster = describe_cluster(plan, aws)
    if (
      cluster.Status === 'available' &&
      writer_identifier(cluster) !== previous_writer
    ) {
      return cluster
    }
    await sleep_fn(plan.poll_interval_ms)
  }
  throw new Error('Aurora writer did not change before the deadline')
}

const find_cloudtrail_failover = async (
  plan,
  failure_injected_at,
  {
    aws = aws_cli,
    sleep_fn = sleep,
    now = Date.now,
    deadline_ms
  }
) => {
  const start_time = new Date(
    Date.parse(failure_injected_at) - 60_000
  ).toISOString()
  while (now() < deadline_ms) {
    const result = aws([
      'cloudtrail',
      'lookup-events',
      '--lookup-attributes',
      'AttributeKey=EventName,AttributeValue=FailoverDBCluster',
      '--start-time',
      start_time,
      '--end-time',
      new Date(now() + 60_000).toISOString(),
      '--max-results',
      '50',
      '--region',
      plan.aws_region
    ])
    for (const event of result.Events || []) {
      try {
        const parsed = parse_cloudtrail_event(event, plan)
        const event_time = Date.parse(parsed.raw.eventTime)
        if (
          Number.isFinite(event_time) &&
          event_time >= Date.parse(failure_injected_at) - 5000 &&
          event_time <= now() + 5000
        ) {
          return event
        }
      } catch {
        // A recent failover for another cluster is not this run's evidence.
      }
    }
    await sleep_fn(plan.poll_interval_ms)
  }
  throw new Error(
    'CloudTrail did not expose the matching FailoverDBCluster event'
  )
}

const write_artifact = (
  plan,
  artifact,
  {
    aws = aws_cli,
    env = process.env,
    log = console.log
  } = {}
) => {
  const body = `${JSON.stringify(artifact, null, 2)}\n`
  const digest = crypto.createHash('sha256').update(body).digest('hex')
  const output_directory =
    env.DURABILITY_EVIDENCE_OUTPUT_DIR ||
    path.join(process.cwd(), 'results', 'aws-evidence')
  const output = path.join(
    output_directory,
    `${plan.run_id}-durability-evidence.json`
  )
  fs.mkdirSync(path.dirname(output), { recursive: true })
  fs.writeFileSync(output, body, { mode: 0o600 })
  fs.chmodSync(output, 0o600)
  const uploaded = aws([
    's3api',
    'put-object',
    '--bucket',
    plan.report_bucket,
    '--key',
    plan.artifact_key,
    '--body',
    output,
    '--content-type',
    'application/json',
    '--region',
    plan.aws_region
  ])
  log(`durability evidence: ${output}`)
  log(
    `immutable durability evidence: ${plan.artifact_uri}` +
    `${uploaded.VersionId ? `?versionId=${uploaded.VersionId}` : ''}`
  )
  log(`durability evidence sha256: ${digest}`)
  return {
    path: output,
    uri: plan.artifact_uri,
    sha256: digest,
    version_id: uploaded.VersionId,
    etag: uploaded.ETag
  }
}

module.exports = {
  aws_cli,
  describe_cluster,
  find_cloudtrail_failover,
  sleep,
  wait_for_writer_change,
  write_artifact
}
