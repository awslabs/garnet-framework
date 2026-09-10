const {
  CORE_CONTEXT,
  expect_status
} = require('./smoke-test.js')

const probe_definitions = plan =>
  Array.from({ length: plan.mutation_count }, (_, index) => {
    const ordinal = String(index + 1).padStart(4, '0')
    return {
      mutation_id: `${plan.run_id}-mutation-${ordinal}`,
      entity_id:
        `urn:ngsi-ld:DurabilityProbe:${plan.run_id}:${ordinal}`,
      expected_value: `${plan.run_id}-value-${ordinal}`
    }
  })

const request_headers = (plan, token) => ({
  Authorization: token
})

const write_headers = (plan, token) => ({
  ...request_headers(plan, token),
  Accept: 'application/ld+json',
  'Content-Type': 'application/ld+json'
})

const entity_url = (plan, entity_id) =>
  `${plan.endpoint}/ngsi-ld/v1/entities/${encodeURIComponent(entity_id)}`

const entity_body = (probe, value) => JSON.stringify({
  '@context': CORE_CONTEXT,
  id: probe.entity_id,
  type: 'DurabilityProbe',
  status: {
    type: 'Property',
    value
  }
})

const attribute_body = value => JSON.stringify({
  '@context': CORE_CONTEXT,
  status: {
    type: 'Property',
    value
  }
})

const create_probes = async ({
  plan,
  token,
  probes,
  send
}) => {
  for (const probe of probes) {
    const item = entity_url(plan, probe.entity_id)
    expect_status(
      await send(`${item}?local=true`, {
        method: 'DELETE',
        headers: request_headers(plan, token)
      }),
      [204, 404],
      `clear durability probe ${probe.entity_id}`
    )
    expect_status(
      await send(`${plan.endpoint}/ngsi-ld/v1/entities?local=true`, {
        method: 'POST',
        headers: write_headers(plan, token),
        body: entity_body(probe, 'prepared')
      }),
      201,
      `create durability probe ${probe.entity_id}`
    )
  }
}

const retryable_status = status => status === 429 || status >= 500

const mutate_probe = async ({
  plan,
  token,
  probe,
  attempts,
  send,
  now,
  sleep_fn,
  deadline_ms
}) => {
  let attempt_number = 0
  while (now() < deadline_ms) {
    attempt_number += 1
    const started_at = new Date(now()).toISOString()
    let response
    try {
      response = await send(
        `${entity_url(plan, probe.entity_id)}/attrs?local=true`,
        {
          method: 'PATCH',
          headers: write_headers(plan, token),
          body: attribute_body(probe.expected_value)
        }
      )
    } catch {
      const completed_at = new Date(now()).toISOString()
      attempts.push({
        attemptId: `${probe.mutation_id}-attempt-${attempt_number}`,
        mutationId: probe.mutation_id,
        startedAt: started_at,
        completedAt: completed_at,
        outcome: 'ambiguous'
      })
      await sleep_fn(plan.retry_delay_ms)
      continue
    }
    const completed_at = new Date(now()).toISOString()
    if (response.status === 204) {
      attempts.push({
        attemptId: `${probe.mutation_id}-attempt-${attempt_number}`,
        mutationId: probe.mutation_id,
        startedAt: started_at,
        completedAt: completed_at,
        outcome: 'acknowledged',
        status: 204
      })
      return {
        mutationId: probe.mutation_id,
        entityId: probe.entity_id,
        expectedValue: probe.expected_value,
        observedValue: '',
        attemptCount: attempt_number,
        acknowledgedAt: completed_at,
        verifiedAt: ''
      }
    }
    attempts.push({
      attemptId: `${probe.mutation_id}-attempt-${attempt_number}`,
      mutationId: probe.mutation_id,
      startedAt: started_at,
      completedAt: completed_at,
      outcome: 'rejected',
      status: response.status
    })
    if (!retryable_status(response.status)) {
      throw new Error(
        `mutate ${probe.entity_id}: received non-retryable HTTP ` +
        `${response.status}`
      )
    }
    await sleep_fn(plan.retry_delay_ms)
  }
  throw new Error(`mutation deadline exceeded for ${probe.entity_id}`)
}

const parse_entity_value = (response, entity_id) => {
  expect_status(response, 200, `reconcile ${entity_id}`)
  let entity
  try {
    entity = JSON.parse(response.body)
  } catch {
    throw new Error(`reconcile ${entity_id}: response is not JSON`)
  }
  const returned_id = entity.id || entity['@id']
  if (returned_id !== entity_id) {
    throw new Error(
      `reconcile ${entity_id}: returned ${JSON.stringify(returned_id)}`
    )
  }
  const status = entity.status ||
    entity['https://uri.etsi.org/ngsi-ld/status']
  if (!status || typeof status.value !== 'string') {
    throw new Error(`reconcile ${entity_id}: status value is missing`)
  }
  return status.value
}

const reconcile_mutations = async ({
  plan,
  token,
  mutations,
  send,
  now
}) => {
  for (const mutation of mutations) {
    const response = await send(
      `${entity_url(plan, mutation.entityId)}?local=true`,
      {
        headers: {
          ...request_headers(plan, token),
          Accept: 'application/ld+json'
        }
      }
    )
    mutation.observedValue = parse_entity_value(
      response,
      mutation.entityId
    )
    mutation.verifiedAt = new Date(now()).toISOString()
    if (mutation.observedValue !== mutation.expectedValue) {
      throw new Error(
        `reconcile ${mutation.entityId}: expected ` +
        `${JSON.stringify(mutation.expectedValue)}, got ` +
        `${JSON.stringify(mutation.observedValue)}`
      )
    }
  }
}

const cleanup_probes = async ({
  plan,
  token,
  probes,
  send
}) => {
  const failures = []
  for (const probe of probes) {
    try {
      expect_status(
        await send(`${entity_url(plan, probe.entity_id)}?local=true`, {
          method: 'DELETE',
          headers: request_headers(plan, token)
        }),
        [204, 404],
        `delete durability probe ${probe.entity_id}`
      )
    } catch (error) {
      failures.push(`${probe.entity_id}: ${error.message}`)
    }
  }
  return failures
}

module.exports = {
  cleanup_probes,
  create_probes,
  mutate_probe,
  probe_definitions,
  reconcile_mutations
}
