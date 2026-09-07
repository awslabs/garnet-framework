const {
  CORE_CONTEXT,
  expect_authorizer_rejection,
  load_api_token,
  request,
  run_entity_round_trip
} = require('../.github/scripts/smoke-test.js')

export {}

type SmokeResponse = {
  status: number
  body: string
}

type SmokeRequestOptions = {
  headers?: Record<string, string>
  method?: string
  body?: string
}

const response = (
  status: number,
  body: unknown = ''
): SmokeResponse => ({
  status,
  body: typeof body === 'string' ? body : JSON.stringify(body)
})

const smoke_entity = (id: string, value: string) => ({
  '@context': CORE_CONTEXT,
  id,
  type: 'SmokeTestProbe',
  status: {
    type: 'Property',
    value
  }
})

const take_response = (replies: SmokeResponse[]): SmokeResponse => {
  const next = replies.shift()
  if (!next) throw new Error('the test issued more requests than expected')
  return next
}

describe('post-deploy smoke test', () => {
  it('loads the API token from Secrets Manager without invoking a shell', () => {
    const exec_file = jest.fn(() =>
      JSON.stringify({ Authorization: 'signed-client-token' })
    )

    expect(load_api_token(
      'arn:aws:secretsmanager:eu-west-3:111111111111:secret:garnet-token',
      { exec_file, env: { AWS_REGION: 'eu-west-3' } }
    )).toBe('signed-client-token')

    expect(exec_file).toHaveBeenCalledWith(
      'aws',
      [
        'secretsmanager',
        'get-secret-value',
        '--secret-id',
        'arn:aws:secretsmanager:eu-west-3:111111111111:secret:garnet-token',
        '--query',
        'SecretString',
        '--output',
        'text'
      ],
      expect.objectContaining({
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe']
      })
    )
  })

  it('rejects malformed API client secrets without echoing their contents', () => {
    const malformed = 'this-is-not-json-and-must-not-be-reported'

    expect(() => load_api_token('secret-arn', {
      exec_file: () => malformed
    })).toThrow('Garnet API client secret is not valid JSON')

    try {
      load_api_token('secret-arn', { exec_file: () => malformed })
    } catch (error) {
      expect(String(error)).not.toContain(malformed)
    }
  })

  it('forwards request bodies to fetch', async () => {
    const fetch_impl = jest.fn().mockResolvedValue(
      new Response(null, { status: 204 })
    )

    await request(
      'https://broker.example/ngsi-ld/v1/entities',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/ld+json' },
        body: '{"id":"urn:ngsi-ld:Probe:1"}'
      },
      { fetch_impl, timeout_ms: 100 }
    )

    expect(fetch_impl).toHaveBeenCalledWith(
      'https://broker.example/ngsi-ld/v1/entities',
      expect.objectContaining({
        method: 'POST',
        body: '{"id":"urn:ngsi-ld:Probe:1"}',
        headers: { 'Content-Type': 'application/ld+json' },
        signal: expect.any(AbortSignal)
      })
    )
  })

  it('verifies a complete local NGSI-LD Entity lifecycle', async () => {
    const id = 'urn:ngsi-ld:SmokeTestProbe:run-1'
    const encoded = encodeURIComponent(id)
    const replies = [
      response(404),
      response(201),
      response(200, smoke_entity(id, 'created')),
      response(204),
      response(200, smoke_entity(id, 'updated')),
      response(204),
      response(404, { status: 404 })
    ]
    const calls: Array<[string, SmokeRequestOptions]> = []
    const request_fn = jest.fn(
      async (url: string, options: SmokeRequestOptions = {}) => {
        calls.push([url, options])
        return take_response(replies)
      }
    )

    await run_entity_round_trip({
      base: 'https://broker.example',
      auth: { Authorization: 'token' },
      entity_id: id,
      request_fn
    })

    expect(calls.map(([url, options]) => ({
      url,
      method: options?.method || 'GET'
    }))).toEqual([
      {
        url:
          `https://broker.example/ngsi-ld/v1/entities/${encoded}?local=true`,
        method: 'DELETE'
      },
      {
        url: 'https://broker.example/ngsi-ld/v1/entities',
        method: 'POST'
      },
      {
        url:
          `https://broker.example/ngsi-ld/v1/entities/${encoded}?local=true`,
        method: 'GET'
      },
      {
        url:
          `https://broker.example/ngsi-ld/v1/entities/${encoded}` +
          '/attrs?local=true',
        method: 'PATCH'
      },
      {
        url:
          `https://broker.example/ngsi-ld/v1/entities/${encoded}?local=true`,
        method: 'GET'
      },
      {
        url:
          `https://broker.example/ngsi-ld/v1/entities/${encoded}?local=true`,
        method: 'DELETE'
      },
      {
        url:
          `https://broker.example/ngsi-ld/v1/entities/${encoded}?local=true`,
        method: 'GET'
      }
    ])

    const create_body = JSON.parse(calls[1]![1].body!)
    const update_body = JSON.parse(calls[3]![1].body!)
    expect(create_body).toEqual(smoke_entity(id, 'created'))
    expect(update_body).toEqual({
      '@context': CORE_CONTEXT,
      status: { type: 'Property', value: 'updated' }
    })
  })

  it('cleans up when an intermediate mutation fails', async () => {
    const id = 'urn:ngsi-ld:SmokeTestProbe:failed-run'
    const replies = [
      response(404),
      response(201),
      response(200, smoke_entity(id, 'created')),
      response(500, { detail: 'database unavailable' }),
      response(204)
    ]
    const request_fn = jest.fn(
      async (_url: string, _options: SmokeRequestOptions = {}) =>
        take_response(replies)
    )

    await expect(run_entity_round_trip({
      base: 'https://broker.example',
      entity_id: id,
      request_fn
    })).rejects.toThrow('update smoke Entity: expected 204, got 500')

    expect(request_fn).toHaveBeenLastCalledWith(
      expect.stringContaining('?local=true'),
      expect.objectContaining({ method: 'DELETE' })
    )
  })

  it('fails when a successful read returns the wrong value', async () => {
    const id = 'urn:ngsi-ld:SmokeTestProbe:wrong-value'
    const replies = [
      response(404),
      response(201),
      response(200, smoke_entity(id, 'not-created')),
      response(204)
    ]

    await expect(run_entity_round_trip({
      base: 'https://broker.example',
      entity_id: id,
      request_fn: async () => take_response(replies)
    })).rejects.toThrow('expected status="created", got "not-created"')
  })

  it('accepts only authorization rejection statuses', () => {
    expect(() => expect_authorizer_rejection(response(401))).not.toThrow()
    expect(() => expect_authorizer_rejection(response(403))).not.toThrow()
    expect(() => expect_authorizer_rejection(response(500)))
      .toThrow('expected 401 or 403')
    expect(() => expect_authorizer_rejection(response(200)))
      .toThrow('expected 401 or 403')
  })
})
