#!/usr/bin/env node
/**
 * Post-deploy smoke test.
 *
 * A green `cdk deploy` only means CloudFormation converged. This verifies the
 * deployed entry point, authorization, broker and Aurora with a real NGSI-LD
 * create/read/update/delete transaction.
 */

const fs = require('fs')
const path = require('path')
const { randomUUID } = require('crypto')
const { execFileSync } = require('child_process')

const CORE_CONTEXT =
  'https://uri.etsi.org/ngsi-ld/v1/ngsi-ld-core-context-v1.9.jsonld'
const EXPANDED_STATUS = 'https://uri.etsi.org/ngsi-ld/status'

const excerpt = body => body.replace(/\s+/g, ' ').slice(0, 240)

const load_api_token = (
  secret_arn,
  {
    env = process.env,
    exec_file = execFileSync
  } = {}
) => {
  const secret_string = String(exec_file(
    'aws',
    [
      'secretsmanager',
      'get-secret-value',
      '--secret-id',
      secret_arn,
      '--query',
      'SecretString',
      '--output',
      'text'
    ],
    {
      encoding: 'utf8',
      env,
      stdio: ['ignore', 'pipe', 'pipe']
    }
  )).trim()

  let secret
  try {
    secret = JSON.parse(secret_string)
  } catch {
    throw new Error('Garnet API client secret is not valid JSON')
  }
  if (
    !secret ||
    typeof secret.Authorization !== 'string' ||
    secret.Authorization.length === 0
  ) {
    throw new Error(
      'Garnet API client secret has no non-empty Authorization value'
    )
  }
  return secret.Authorization
}

const request = async (
  url,
  { headers = {}, method = 'GET', body } = {},
  {
    fetch_impl = fetch,
    timeout_ms = 15000
  } = {}
) => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout_ms)
  try {
    const response = await fetch_impl(url, {
      method,
      headers,
      ...(body === undefined ? {} : { body }),
      signal: controller.signal
    })
    return {
      status: response.status,
      body: await response.text()
    }
  } finally {
    clearTimeout(timer)
  }
}

const expect_status = ({ status, body }, expected, operation) => {
  const accepted = Array.isArray(expected) ? expected : [expected]
  if (!accepted.includes(status)) {
    throw new Error(
      `${operation}: expected ${accepted.join(' or ')}, got ${status}: ` +
      excerpt(body)
    )
  }
}

const parse_json = (body, operation) => {
  try {
    return JSON.parse(body)
  } catch {
    throw new Error(`${operation}: response is not JSON: ${excerpt(body)}`)
  }
}

const expect_entity_value = (response, entity_id, expected_value) => {
  expect_status(response, 200, `retrieve ${entity_id}`)
  const entity = parse_json(response.body, `retrieve ${entity_id}`)
  const returned_id = entity.id || entity['@id']
  if (returned_id !== entity_id) {
    throw new Error(
      `retrieve ${entity_id}: returned Entity id ${JSON.stringify(returned_id)}`
    )
  }

  const status = entity.status || entity[EXPANDED_STATUS]
  if (!status || status.value !== expected_value) {
    throw new Error(
      `retrieve ${entity_id}: expected status=${JSON.stringify(expected_value)}, ` +
      `got ${JSON.stringify(status && status.value)}`
    )
  }
}

const run_entity_round_trip = async ({
  base,
  auth = {},
  entity_id,
  request_fn = request
}) => {
  const item =
    `${base}/ngsi-ld/v1/entities/${encodeURIComponent(entity_id)}`
  const read_headers = {
    ...auth,
    Accept: 'application/ld+json'
  }
  const write_headers = {
    ...read_headers,
    'Content-Type': 'application/ld+json'
  }
  const entity = value => JSON.stringify({
    '@context': CORE_CONTEXT,
    id: entity_id,
    type: 'SmokeTestProbe',
    status: {
      type: 'Property',
      value
    }
  })
  const attributes = value => JSON.stringify({
    '@context': CORE_CONTEXT,
    status: {
      type: 'Property',
      value
    }
  })

  expect_status(
    await request_fn(`${item}?local=true`, {
      method: 'DELETE',
      headers: auth
    }),
    [204, 404],
    'remove an earlier smoke Entity'
  )

  let operation_error
  let deleted = false
  try {
    expect_status(
      await request_fn(`${base}/ngsi-ld/v1/entities`, {
        method: 'POST',
        headers: write_headers,
        body: entity('created')
      }),
      201,
      'create smoke Entity'
    )

    expect_entity_value(
      await request_fn(`${item}?local=true`, { headers: read_headers }),
      entity_id,
      'created'
    )

    expect_status(
      await request_fn(`${item}/attrs?local=true`, {
        method: 'PATCH',
        headers: write_headers,
        body: attributes('updated')
      }),
      204,
      'update smoke Entity'
    )

    expect_entity_value(
      await request_fn(`${item}?local=true`, { headers: read_headers }),
      entity_id,
      'updated'
    )

    expect_status(
      await request_fn(`${item}?local=true`, {
        method: 'DELETE',
        headers: auth
      }),
      204,
      'delete smoke Entity'
    )
    deleted = true

    expect_status(
      await request_fn(`${item}?local=true`, { headers: read_headers }),
      404,
      'verify smoke Entity deletion'
    )
  } catch (error) {
    operation_error = error
  }

  if (!deleted) {
    try {
      expect_status(
        await request_fn(`${item}?local=true`, {
          method: 'DELETE',
          headers: auth
        }),
        [204, 404],
        'clean up smoke Entity'
      )
    } catch (cleanup_error) {
      if (!operation_error) operation_error = cleanup_error
    }
  }

  if (operation_error) throw operation_error
}

const expect_authorizer_rejection = ({ status, body }) => {
  if (status !== 401 && status !== 403) {
    throw new Error(
      `expected 401 or 403 for an invalid token, got ${status}: ${excerpt(body)}`
    )
  }
}

const check = async (
  name,
  fn,
  {
    retries = 5,
    retry_delay_ms = 10000,
    sleep_fn = ms => new Promise(resolve => setTimeout(resolve, ms)),
    log = console.log
  } = {}
) => {
  let last_error
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await fn()
      log(`  PASS  ${name}`)
      return true
    } catch (error) {
      last_error = error
      if (attempt < retries) {
        log(
          `  ....  ${name} ` +
          `(attempt ${attempt}/${retries}: ${error.message})`
        )
        await sleep_fn(retry_delay_ms)
      }
    }
  }
  log(`  FAIL  ${name}: ${last_error.message}`)
  return false
}

const main = async ({
  env = process.env,
  cwd = process.cwd(),
  request_fn,
  token_loader = load_api_token
} = {}) => {
  const outputs_path =
    env.SMOKE_OUTPUTS_PATH || path.join(cwd, 'cdk-outputs.json')
  const stack_name = env.SMOKE_STACK_NAME || 'GarnetFramework'
  const timeout_ms = Number(env.SMOKE_TIMEOUT_MS || 15000)
  const retries = Number(env.SMOKE_RETRIES || 5)
  const retry_delay_ms = Number(env.SMOKE_RETRY_DELAY_MS || 10000)
  const send = request_fn || ((url, options) =>
    request(url, options, { timeout_ms }))

  if (!fs.existsSync(outputs_path)) {
    throw new Error(
      `No ${outputs_path}. Run cdk deploy with --outputs-file first.`
    )
  }

  const all_outputs = JSON.parse(fs.readFileSync(outputs_path, 'utf8'))
  const outputs = all_outputs[stack_name]
  if (!outputs) {
    throw new Error(
      `Stack '${stack_name}' not found in outputs. Found: ` +
      Object.keys(all_outputs).join(', ')
    )
  }

  const endpoint = outputs.GarnetEndpoint || outputs.garnet_endpoint
  const token_secret_arn = outputs.GarnetApiTokenSecretArn
  if (!endpoint) throw new Error('GarnetEndpoint missing from stack outputs')
  if (!token_secret_arn) {
    throw new Error(
      'GarnetApiTokenSecretArn missing from stack outputs'
    )
  }
  const token = token_loader(token_secret_arn, { env })

  const base = endpoint.replace(/\/$/, '')
  const auth = { Authorization: token }
  const run_id =
    (env.SMOKE_RUN_ID || `${Date.now()}-${randomUUID()}`)
      .replace(/[^A-Za-z0-9._~-]/g, '-')
  const entity_id = `urn:ngsi-ld:SmokeTestProbe:${run_id}`
  const check_options = { retries, retry_delay_ms }

  console.log(`Smoke testing ${base}`)
  const results = []

  results.push(await check('version endpoint responds', async () => {
    const response = await send(`${base}/`)
    expect_status(response, 200, 'retrieve broker version')
    const payload = parse_json(response.body, 'retrieve broker version')
    if (!payload.garnet_version) {
      throw new Error('retrieve broker version: no garnet_version in response')
    }
    console.log(
      `        version=${payload.garnet_version} ` +
      `architecture=${payload.garnet_architecture}`
    )

    const info = payload.context_broker_info || {}
    const broken = Object.entries(info)
      .filter(([, value]) =>
        typeof value === 'string' && value.includes('ERROR'))
    if (broken.length) {
      throw new Error(
        `broker containers not healthy: ` +
        broken.map(([name]) => name).join(', ')
      )
    }
  }, check_options))

  results.push(await check(
    'NGSI-LD Entity CRUD round trip succeeds',
    () => run_entity_round_trip({
      base,
      auth,
      entity_id,
      request_fn: send
    }),
    check_options
  ))

  results.push(await check('authorizer rejects a bad token', async () => {
    expect_authorizer_rejection(
      await send(
        `${base}/ngsi-ld/v1/entities?type=SmokeTestProbe&local=true`,
        { headers: { Authorization: 'not-a-valid-token' } }
      )
    )
  }, check_options))

  const failures = results.filter(result => !result).length
  console.log(`\n${results.length - failures}/${results.length} checks passed`)
  if (failures > 0) {
    throw new Error(`${failures} smoke check(s) failed`)
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(`\nSmoke test failed: ${error.message}`)
    process.exit(1)
  })
}

module.exports = {
  CORE_CONTEXT,
  check,
  expect_authorizer_rejection,
  expect_entity_value,
  expect_status,
  load_api_token,
  main,
  request,
  run_entity_round_trip
}
