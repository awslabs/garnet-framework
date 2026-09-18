#!/usr/bin/env node

const fs = require('fs')
const path = require('path')
const {
  build_durability_artifact,
  writer_identifier
} = require('./durability-evidence.js')
const {
  aws_cli,
  describe_cluster,
  find_cloudtrail_failover,
  sleep,
  wait_for_writer_change,
  write_artifact
} = require('./durability-aws.js')
const {
  cleanup_probes,
  create_probes,
  mutate_probe,
  probe_definitions,
  reconcile_mutations
} = require('./durability-http.js')
const {
  plan_durability_test
} = require('./durability-plan.js')
const {
  load_api_token,
  request
} = require('./smoke-test.js')

const run_durability_test = async (
  plan,
  {
    aws = aws_cli,
    token_loader = load_api_token,
    request_fn,
    sleep_fn = sleep,
    now = Date.now,
    log = console.log,
    env = process.env,
    write_artifact_fn = write_artifact
  } = {}
) => {
  const send = request_fn || ((url, options) =>
    request(url, options, { timeout_ms: plan.request_timeout_ms }))
  const token = token_loader(undefined, { env })
  const probes = probe_definitions(plan)
  const attempts = []
  const mutations = []
  const started_at = new Date(now()).toISOString()
  const deadline_ms = now() + plan.timeout_ms
  let artifact_result

  try {
    await create_probes({ plan, token, probes, send })
    for (const probe of probes.slice(0, plan.pre_fault_mutations)) {
      mutations.push(await mutate_probe({
        plan,
        token,
        probe,
        attempts,
        send,
        now,
        sleep_fn,
        deadline_ms
      }))
    }

    const before_observed_at = new Date(now()).toISOString()
    const before_cluster = describe_cluster(plan, aws)
    const previous_writer = writer_identifier(before_cluster)
    if (before_cluster.Status !== 'available') {
      throw new Error('Aurora cluster is not available before failover')
    }

    const failure_injected_at = new Date(now()).toISOString()
    const fault_response = aws([
      'rds',
      'failover-db-cluster',
      '--db-cluster-identifier',
      plan.database_cluster,
      '--region',
      plan.aws_region
    ])
    const fault_observed_at = new Date(now()).toISOString()
    if (!fault_response.DBCluster) {
      throw new Error('FailoverDBCluster returned no DBCluster response')
    }

    const fault_probe = probes[plan.pre_fault_mutations]
    mutations.push(await mutate_probe({
      plan,
      token,
      probe: fault_probe,
      attempts,
      send,
      now,
      sleep_fn,
      deadline_ms
    }))

    await wait_for_writer_change(plan, previous_writer, {
      aws,
      sleep_fn,
      now,
      deadline_ms
    })

    const recovery_probe = probes[plan.pre_fault_mutations + 1]
    const recovery_mutation = await mutate_probe({
      plan,
      token,
      probe: recovery_probe,
      attempts,
      send,
      now,
      sleep_fn,
      deadline_ms
    })
    mutations.push(recovery_mutation)
    const recovered_at = recovery_mutation.acknowledgedAt

    for (
      const probe of probes.slice(plan.pre_fault_mutations + 2)
    ) {
      mutations.push(await mutate_probe({
        plan,
        token,
        probe,
        attempts,
        send,
        now,
        sleep_fn,
        deadline_ms
      }))
    }

    await reconcile_mutations({
      plan,
      token,
      mutations,
      send,
      now
    })
    const after_cluster = describe_cluster(plan, aws)
    const after_observed_at = new Date(now()).toISOString()
    const cloudtrail_deadline = Math.min(
      deadline_ms,
      now() + plan.cloudtrail_wait_ms
    )
    const cloudtrail_event = await find_cloudtrail_failover(
      plan,
      failure_injected_at,
      {
        aws,
        sleep_fn,
        now,
        deadline_ms: cloudtrail_deadline
      }
    )
    const completed_at = new Date(now()).toISOString()
    const caller_identity = aws(['sts', 'get-caller-identity'])
    const collected_at = new Date(now()).toISOString()
    const artifact = build_durability_artifact({
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
      requested_cluster: fault_response.DBCluster,
      after_cluster,
      before_observed_at,
      fault_observed_at,
      after_observed_at,
      mutations,
      attempts
    })
    artifact_result = write_artifact_fn(plan, artifact, {
      aws,
      env,
      log
    })
  } finally {
    const cleanup_failures = await cleanup_probes({
      plan,
      token,
      probes,
      send
    })
    for (const failure of cleanup_failures) {
      log(`cleanup warning: ${failure}`)
    }
  }
  return artifact_result
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
  const plan = plan_durability_test(outputs)
  console.log(
    `Failing over ${plan.database_cluster} with ` +
    `${plan.mutation_count} reconciled API mutations`
  )
  await run_durability_test(plan)
}

if (require.main === module) {
  main().catch(error => {
    console.error(`Durability qualification failed: ${error.message}`)
    process.exit(1)
  })
}

module.exports = {
  main,
  run_durability_test
}
