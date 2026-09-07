#!/usr/bin/env node

const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')
const { plan_load_test } = require('./load-test-plan.js')

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

const aws_cli = args => {
  const output = execFileSync('aws', [...args, '--output', 'json'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit']
  })
  return JSON.parse(output)
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
    log = console.log
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

  log(`aggregate report: ${plan.report_uri}`)
  if (errors.length > 0) {
    throw new Error(errors.join('\n'))
  }
}

const main = async () => {
  const outputs_path =
    process.env.SMOKE_OUTPUTS_PATH ||
    path.join(process.cwd(), 'cdk-outputs.json')
  const stack_name = process.env.SMOKE_STACK_NAME || 'Garnet'
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
  launch_task,
  main,
  run_plan,
  task_failure,
  wait_for_tasks
}
