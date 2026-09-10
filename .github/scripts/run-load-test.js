#!/usr/bin/env node

const fs = require('fs')
const os = require('os')
const path = require('path')
const crypto = require('crypto')
const { execFileSync } = require('child_process')
const { plan_load_test } = require('./load-test-plan.js')
const {
  build_telemetry_artifact
} = require('./telemetry-evidence.js')
const {
  metric_data_queries,
  metric_data_reasons
} = require('./telemetry-metrics.js')

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

const aws_cli = args => {
  const output = execFileSync('aws', [...args, '--output', 'json'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit']
  })
  return JSON.parse(output)
}

const read_report = (telemetry, aws = aws_cli) => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'garnet-load-report-')
  )
  const output = path.join(directory, 'aggregate.json')
  try {
    const source = aws([
      's3api',
      'get-object',
      '--bucket',
      telemetry.report_bucket,
      '--key',
      telemetry.report_key,
      output
    ])
    return {
      report: JSON.parse(fs.readFileSync(output, 'utf8')),
      source: {
        version_id: source.VersionId,
        etag: source.ETag
      }
    }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
}

const metric_window = report => ({
  start_time: new Date(
    Date.parse(report.startedAt) - 60_000
  ).toISOString(),
  end_time: new Date(
    Date.parse(report.completedAt) + 120_000
  ).toISOString()
})

const collect_telemetry_evidence = async (
  plan,
  {
    aws = aws_cli,
    sleep_fn = sleep,
    now = Date.now,
    log = console.log,
    env = process.env
  } = {}
) => {
  const telemetry = plan.telemetry
  if (telemetry === undefined) return undefined
  const loaded_report = read_report(telemetry, aws)
  const report = loaded_report.report
  const described = aws([
    'rds',
    'describe-db-clusters',
    '--db-cluster-identifier',
    telemetry.database_cluster
  ])
  const clusters = described.DBClusters
  if (!Array.isArray(clusters) || clusters.length !== 1) {
    throw new Error('RDS did not return the exact qualification cluster')
  }
  const cluster = clusters[0]
  const queries = metric_data_queries(telemetry, cluster)
  const window = metric_window(report)
  const deadline = now() + telemetry.wait_timeout_ms
  let metric_response
  let reasons = ['telemetry has not been collected']
  while (reasons.length > 0) {
    metric_response = aws([
      'cloudwatch',
      'get-metric-data',
      '--start-time',
      window.start_time,
      '--end-time',
      window.end_time,
      '--scan-by',
      'TimestampAscending',
      '--metric-data-queries',
      JSON.stringify(queries)
    ])
    if (metric_response.NextToken !== undefined) {
      throw new Error(
        'CloudWatch telemetry exceeded one bounded GetMetricData response'
      )
    }
    reasons = metric_data_reasons(metric_response, {
      started_at: report.startedAt,
      completed_at: report.completedAt
    })
    if (reasons.length > 0 && now() >= deadline) {
      throw new Error(
        `CloudWatch telemetry did not converge: ${reasons.join('; ')}`
      )
    }
    if (reasons.length > 0) await sleep_fn(15_000)
  }

  const artifact = build_telemetry_artifact({
    telemetry,
    report,
    report_source: loaded_report.source,
    cluster,
    caller_identity: aws(['sts', 'get-caller-identity']),
    metric_response,
    collected_at: new Date(now()).toISOString()
  })
  const body = `${JSON.stringify(artifact, null, 2)}\n`
  const digest = crypto.createHash('sha256').update(body).digest('hex')
  const output_directory =
    env.LOAD_EVIDENCE_OUTPUT_DIR ||
    path.join(process.cwd(), 'results', 'aws-evidence')
  const output = path.join(
    output_directory,
    `${plan.run_id}-telemetry-evidence.json`
  )
  fs.mkdirSync(path.dirname(output), { recursive: true })
  fs.writeFileSync(output, body, { mode: 0o600 })
  const uploaded = aws([
    's3api',
    'put-object',
    '--bucket',
    telemetry.report_bucket,
    '--key',
    telemetry.artifact_key,
    '--body',
    output,
    '--content-type',
    'application/json'
  ])
  const uri =
    `s3://${telemetry.report_bucket}/${telemetry.artifact_key}`
  log(`telemetry evidence: ${output}`)
  log(
    `immutable telemetry evidence: ${uri}` +
    `${uploaded.VersionId ? `?versionId=${uploaded.VersionId}` : ''}`
  )
  log(`telemetry evidence sha256: ${digest}`)
  return {
    path: output,
    uri,
    sha256: digest,
    version_id: uploaded.VersionId
  }
}

const task_failure = (task, container_name) => {
  const container = task.containers?.find(
    candidate => candidate.name === container_name
  )
  if (task.lastStatus !== 'STOPPED') {
    return `task ${task.taskArn} did not stop`
  }
  if (container?.exitCode !== 0) {
    return (
      `task ${task.taskArn} exited ${container?.exitCode ?? 'without a code'}: ` +
      (container?.reason || task.stoppedReason || 'no reason reported')
    )
  }
  return undefined
}

const launch_task = (
  plan,
  task_definition,
  overrides,
  aws = aws_cli
) => {
  const result = aws([
    'ecs',
    'run-task',
    '--cluster',
    plan.cluster,
    '--task-definition',
    task_definition,
    '--launch-type',
    'FARGATE',
    '--platform-version',
    'LATEST',
    '--network-configuration',
    JSON.stringify(plan.network_configuration),
    '--overrides',
    JSON.stringify(overrides),
    '--started-by',
    plan.started_by
  ])
  if (result.failures?.length) {
    throw new Error(
      `ECS rejected the task: ` +
      result.failures.map(failure =>
        failure.detail || failure.reason || 'unknown failure'
      ).join('; ')
    )
  }
  const arn = result.tasks?.[0]?.taskArn
  if (!arn) throw new Error('ECS RunTask returned no task ARN')
  return arn
}

const wait_for_tasks = async (
  plan,
  task_arns,
  {
    aws = aws_cli,
    sleep_fn = sleep,
    now = Date.now,
    timeout_ms = plan.wait_timeout_ms
  } = {}
) => {
  const deadline = now() + timeout_ms
  while (now() < deadline) {
    const result = aws([
      'ecs',
      'describe-tasks',
      '--cluster',
      plan.cluster,
      '--tasks',
      ...task_arns
    ])
    if (result.failures?.length) {
      throw new Error(
        `ECS could not describe tasks: ` +
        result.failures.map(failure =>
          failure.detail || failure.reason || 'unknown failure'
        ).join('; ')
      )
    }
    const tasks = result.tasks || []
    if (
      tasks.length === task_arns.length &&
      tasks.every(task => task.lastStatus === 'STOPPED')
    ) {
      return tasks
    }
    await sleep_fn(15000)
  }
  throw new Error(
    `load tasks did not stop within ${Math.ceil(timeout_ms / 1000)} seconds`
  )
}

const run_plan = async (
  plan,
  {
    aws = aws_cli,
    sleep_fn = sleep,
    now = Date.now,
    log = console.log,
    collect_telemetry_fn = collect_telemetry_evidence
  } = {}
) => {
  const errors = []
  const generator_arns = []
  for (const [index, overrides] of plan.generator_overrides.entries()) {
    try {
      const arn = launch_task(
        plan,
        plan.generator_task,
        overrides,
        aws
      )
      generator_arns.push(arn)
      log(`started generator ${index}: ${arn}`)
    } catch (error) {
      errors.push(`generator ${index}: ${error.message}`)
    }
  }

  if (generator_arns.length > 0) {
    try {
      const tasks = await wait_for_tasks(plan, generator_arns, {
        aws,
        sleep_fn,
        now
      })
      for (const task of tasks) {
        const failure = task_failure(task, 'garnet-load-generator')
        if (failure !== undefined) errors.push(failure)
      }
    } catch (error) {
      errors.push(error.message)
    }
  }

  try {
    const aggregate_arn = launch_task(
      plan,
      plan.aggregate_task,
      plan.aggregate_override,
      aws
    )
    log(`started aggregate: ${aggregate_arn}`)
    const [aggregate] = await wait_for_tasks(plan, [aggregate_arn], {
      aws,
      sleep_fn,
      now,
      timeout_ms: 1800000
    })
    const failure = task_failure(aggregate, 'garnet-load-aggregate')
    if (failure !== undefined) errors.push(failure)
  } catch (error) {
    errors.push(`aggregate: ${error.message}`)
  }

  if (plan.qualification && errors.length === 0) {
    try {
      await collect_telemetry_fn(plan, {
        aws,
        sleep_fn,
        now,
        log
      })
    } catch (error) {
      errors.push(`telemetry: ${error.message}`)
    }
  }

  log(`aggregate report: ${plan.report_uri}`)
  if (errors.length > 0) {
    throw new Error(errors.join('\n'))
  }
}

const main = async () => {
  const outputs_path =
    process.env.SMOKE_OUTPUTS_PATH ||
    path.join(process.cwd(), 'cdk-outputs.json')
  const stack_name =
    process.env.SMOKE_STACK_NAME || 'GarnetFramework'
  if (!fs.existsSync(outputs_path)) {
    throw new Error(`No ${outputs_path}; deploy the stack first`)
  }
  const all_outputs = JSON.parse(fs.readFileSync(outputs_path, 'utf8'))
  const outputs = all_outputs[stack_name]
  if (!outputs) {
    throw new Error(`Stack '${stack_name}' is missing from ${outputs_path}`)
  }
  await run_plan(plan_load_test(outputs))
}

if (require.main === module) {
  main().catch(error => {
    console.error(`Load test failed: ${error.message}`)
    process.exit(1)
  })
}

module.exports = {
  collect_telemetry_evidence,
  launch_task,
  main,
  metric_window,
  read_report,
  run_plan,
  task_failure,
  wait_for_tasks
}
