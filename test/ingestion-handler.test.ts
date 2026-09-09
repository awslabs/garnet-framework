/**
 * Tests for the ingestion Lambda that upserts entities into the context broker.
 *
 * The handler reports partial batch failures back to SQS, so the contract that
 * matters is exactly which messageIds come back in batchItemFailures: anything
 * wrongly omitted is data silently dropped, anything wrongly included is a
 * duplicate upsert.
 */

const handler_path = '../lib/stacks/garnet-ingestion/lambda/updateContextBroker/index'

// The handler resolves the shared layer from its Lambda mount path
jest.mock(
  '/opt/nodejs/utils.js',
  () => ({
    log_error: () => undefined,
    normalize: (entity: any) => entity
  }),
  { virtual: true }
)

// axios ships in the Lambda layer, not in the root project, so it is virtual here too
const post = jest.fn()
jest.mock('axios', () => ({
  create: () => ({ post })
}), { virtual: true })

const record = (id: string, body: unknown) => ({
  messageId: id,
  body: JSON.stringify(body)
})

const entity = (id: string) => ({ id, type: 'Device', temp: { value: 1 } })

const load_handler = () => require(handler_path).handler

describe('ingestion updateContextBroker handler', () => {
  beforeEach(() => {
    jest.resetModules()
    post.mockReset()
    post.mockResolvedValue({ data: 'ok' })
  })

  it('upserts a valid batch and reports no failures', async () => {
    const event = {
      Records: [
        record('m1', entity('urn:ngsi-ld:Device:1')),
        record('m2', entity('urn:ngsi-ld:Device:2'))
      ]
    }

    const result = await load_handler()(event, {})

    expect(result).toEqual({ batchItemFailures: [] })
    expect(post).toHaveBeenCalledTimes(1)
    const [, payload] = post.mock.calls[0]
    expect(payload).toHaveLength(2)
  })

  it('splits entities by @context into separate upsert calls', async () => {
    const event = {
      Records: [
        record('m1', entity('urn:ngsi-ld:Device:1')),
        record('m2', { ...entity('urn:ngsi-ld:Device:2'), '@context': 'https://example.com/ctx.jsonld' })
      ]
    }

    const result = await load_handler()(event, {})

    expect(result).toEqual({ batchItemFailures: [] })
    expect(post).toHaveBeenCalledTimes(2)

    const content_types = post.mock.calls.map((c: any) => c[2].headers['Content-Type']).sort()
    expect(content_types).toEqual(['application/json', 'application/ld+json'])
  })

  it('keeps tenant batches isolated and forwards NGSILD-Tenant', async () => {
    const event = {
      Records: [
        record('default', entity('urn:ngsi-ld:Device:1')),
        record('tenant', {
          tenant: 'factory-a',
          entity: entity('urn:ngsi-ld:Device:2')
        })
      ]
    }

    const result = await load_handler()(event, {})

    expect(result).toEqual({ batchItemFailures: [] })
    expect(post).toHaveBeenCalledTimes(2)
    const headers = post.mock.calls.map((call: any) => call[2].headers)
    expect(headers).toEqual(expect.arrayContaining([
      { 'Content-Type': 'application/json' },
      {
        'Content-Type': 'application/json',
        'NGSILD-Tenant': 'factory-a'
      }
    ]))
  })

  it('rejects tenant values that could inject an HTTP header', async () => {
    const result = await load_handler()({
      Records: [record('bad-tenant', {
        tenant: 'factory-a\r\nx-unsafe: yes',
        entity: entity('urn:ngsi-ld:Device:1')
      })]
    }, {})

    expect(result).toEqual({
      batchItemFailures: [{ itemIdentifier: 'bad-tenant' }]
    })
    expect(post).not.toHaveBeenCalled()
  })

  it('fails only the malformed record and still upserts the valid one', async () => {
    const event = {
      Records: [
        record('bad', { type: 'Device' }), // no id
        record('good', entity('urn:ngsi-ld:Device:2'))
      ]
    }

    const result = await load_handler()(event, {})

    expect(result.batchItemFailures).toEqual([{ itemIdentifier: 'bad' }])
    const [, payload] = post.mock.calls[0]
    expect(payload).toHaveLength(1)
    expect(payload[0].id).toBe('urn:ngsi-ld:Device:2')
  })

  it('reports unparseable message bodies as failures', async () => {
    const event = { Records: [{ messageId: 'junk', body: 'not json' }] }

    const result = await load_handler()(event, {})

    expect(result.batchItemFailures).toEqual([{ itemIdentifier: 'junk' }])
    expect(post).not.toHaveBeenCalled()
  })

  it('reports every record in a sub-batch when the broker call fails', async () => {
    post.mockRejectedValue(new Error('broker unreachable'))
    const event = {
      Records: [
        record('m1', entity('urn:ngsi-ld:Device:1')),
        record('m2', entity('urn:ngsi-ld:Device:2'))
      ]
    }

    const result = await load_handler()(event, {})

    expect(result.batchItemFailures).toEqual([
      { itemIdentifier: 'm1' },
      { itemIdentifier: 'm2' }
    ])
  })

  it('does not fail valid records when only the other sub-batch is rejected', async () => {
    // Fail the ld+json call (entities carrying @context), succeed the plain one
    post.mockImplementation((_url: string, _body: unknown, config: any) =>
      config.headers['Content-Type'] == 'application/ld+json'
        ? Promise.reject(new Error('broker rejected context'))
        : Promise.resolve({ data: 'ok' })
    )

    const event = {
      Records: [
        record('plain', entity('urn:ngsi-ld:Device:1')),
        record('ctx', { ...entity('urn:ngsi-ld:Device:2'), '@context': 'https://example.com/ctx.jsonld' })
      ]
    }

    const result = await load_handler()(event, {})

    expect(result.batchItemFailures).toEqual([{ itemIdentifier: 'ctx' }])
  })

  it('makes no broker call for an empty batch', async () => {
    const result = await load_handler()({ Records: [] }, {})

    expect(result).toEqual({ batchItemFailures: [] })
    expect(post).not.toHaveBeenCalled()
  })
})
