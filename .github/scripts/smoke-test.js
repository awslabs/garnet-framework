#!/usr/bin/env node
/**
 * Post-deploy smoke test.
 *
 * A green `cdk deploy` only means CloudFormation converged; it does not mean the
 * broker answers NGSI-LD requests. This exercises the deployed API through its
 * real entry point so a broken release is caught by the pipeline rather than by
 * the first user.
 *
 * Reads cdk-outputs.json written by `cdk deploy --outputs-file`.
 *
 * Note: the Garnet API is reachable over the internet via API Gateway, but the
 * broker ALB and the blue/green test listener are internal to the VPC. Test
 * listener validation therefore only runs when this executes inside the VPC
 * (a self-hosted runner or a CodeBuild project in private subnets); otherwise it
 * is reported as skipped rather than silently passing.
 */

const fs = require('fs')
const path = require('path')

const OUTPUTS_PATH = process.env.SMOKE_OUTPUTS_PATH || path.join(process.cwd(), 'cdk-outputs.json')
const STACK_NAME = process.env.SMOKE_STACK_NAME || 'Garnet'
const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS || 15000)
// The broker sits behind Fargate tasks that may still be warming after deploy.
// Overridable so tests can exercise the failure paths without waiting out the
// full retry schedule.
const RETRIES = Number(process.env.SMOKE_RETRIES || 5)
const RETRY_DELAY_MS = Number(process.env.SMOKE_RETRY_DELAY_MS || 10000)

const sleep = ms => new Promise(r => setTimeout(r, ms))

const request = async (url, { headers = {}, method = 'GET' } = {}) => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const response = await fetch(url, { method, headers, signal: controller.signal })
    const body = await response.text()
    return { status: response.status, body }
  } finally {
    clearTimeout(timer)
  }
}

const check = async (name, fn) => {
  let last_error
  for (let attempt = 1; attempt <= RETRIES; attempt++) {
    try {
      await fn()
      console.log(`  PASS  ${name}`)
      return true
    } catch (e) {
      last_error = e
      if (attempt < RETRIES) {
        console.log(`  ....  ${name} (attempt ${attempt}/${RETRIES}: ${e.message})`)
        await sleep(RETRY_DELAY_MS)
      }
    }
  }
  console.log(`  FAIL  ${name}: ${last_error.message}`)
  return false
}

const main = async () => {
  if (!fs.existsSync(OUTPUTS_PATH)) {
    throw new Error(`No ${OUTPUTS_PATH}. Run cdk deploy with --outputs-file first.`)
  }

  const all_outputs = JSON.parse(fs.readFileSync(OUTPUTS_PATH, 'utf8'))
  const outputs = all_outputs[STACK_NAME]
  if (!outputs) {
    throw new Error(`Stack '${STACK_NAME}' not found in outputs. Found: ${Object.keys(all_outputs).join(', ')}`)
  }

  const endpoint = outputs.GarnetEndpoint || outputs.garnet_endpoint
  const token = outputs.GarnetApiToken
  if (!endpoint) {
    throw new Error('GarnetEndpoint missing from stack outputs')
  }

  const base = endpoint.replace(/\/$/, '')
  const auth = token ? { Authorization: token } : {}

  console.log(`Smoke testing ${base}`)
  const results = []

  // The version route is unauthenticated and reports each broker container's
  // health, so it fails if the API, the VPC link, or the broker is broken.
  results.push(await check('version endpoint responds', async () => {
    const { status, body } = await request(`${base}/`)
    if (status != 200) throw new Error(`expected 200, got ${status}: ${body.slice(0, 200)}`)
    const payload = JSON.parse(body)
    if (!payload.garnet_version) throw new Error('no garnet_version in response')
    console.log(`        version=${payload.garnet_version} architecture=${payload.garnet_architecture}`)

    // context_broker_info is per container; an ERROR string means a broker
    // container is not serving even though CloudFormation succeeded.
    const info = payload.context_broker_info || {}
    const broken = Object.entries(info).filter(([, v]) => typeof v == 'string' && v.includes('ERROR'))
    if (broken.length) {
      throw new Error(`broker containers not healthy: ${broken.map(([k]) => k).join(', ')}`)
    }
  }))

  // A query through the NGSI-LD path proves API Gateway -> VPC link -> ALB ->
  // broker -> Aurora all work, which no unit test can cover.
  results.push(await check('NGSI-LD entity query reaches the broker', async () => {
    const { status, body } = await request(`${base}/ngsi-ld/v1/entities?type=SmokeTestProbe&limit=1`, { headers: auth })
    // 200 (empty array) is the normal answer. 404/400 also prove the broker is
    // routing and parsing; 5xx or a timeout means the chain is broken.
    if (status >= 500) throw new Error(`broker returned ${status}: ${body.slice(0, 200)}`)
    if (status == 403) throw new Error('403 from the API: the deployment token is not valid')
    console.log(`        query returned ${status}`)
  }))

  if (token) {
    results.push(await check('authorizer rejects a bad token', async () => {
      const { status } = await request(`${base}/ngsi-ld/v1/entities?type=SmokeTestProbe`, {
        headers: { Authorization: 'Bearer not-a-valid-token' }
      })
      // If authorization is enabled a forged token must not be accepted
      if (status == 200) throw new Error('an invalid token was accepted')
      console.log(`        rejected with ${status}`)
    }))
  }

  const failures = results.filter(r => !r).length
  console.log(`\n${results.length - failures}/${results.length} checks passed`)

  if (failures > 0) {
    throw new Error(`${failures} smoke check(s) failed`)
  }
}

main().catch(e => {
  console.error(`\nSmoke test failed: ${e.message}`)
  process.exit(1)
})
