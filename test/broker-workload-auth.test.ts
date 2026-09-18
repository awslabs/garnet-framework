jest.mock(
  '@aws-crypto/sha256-js',
  () => ({ Sha256: class {} }),
  { virtual: true }
)
jest.mock(
  '@aws-sdk/credential-provider-node',
  () => ({ defaultProvider: () => async () => ({}) }),
  { virtual: true }
)
jest.mock(
  '@smithy/protocol-http',
  () => ({
    HttpRequest: class {
      constructor(input: Record<string, unknown>) {
        Object.assign(this, input)
      }
    }
  }),
  { virtual: true }
)
jest.mock(
  '@smithy/signature-v4',
  () => ({ SignatureV4: class {} }),
  { virtual: true }
)

const {
  create_broker_authorization,
  create_broker_headers
} = require('../lib/layers/nodejs/broker-auth.js')

const ENV = {
  AWS_REGION: 'us-east-1',
  GARNET_SIGV4_SERVER_ID: 'garnet:111111111111:us-east-1',
  GARNET_STS_ENDPOINT: 'https://sts.us-east-1.amazonaws.com',
  GARNET_TENANT: 'factory-a'
}

describe('Broker workload authentication', () => {
  it('coalesces a burst and signs the deployment-bound STS proof', async () => {
    let now = 1_000
    const presign = jest.fn(async (request: any) => ({
      ...request,
      query: {
        ...request.query,
        'X-Amz-Signature': 'signed'
      }
    }))
    const authorization = create_broker_authorization(ENV, {
      signer: { presign },
      now: () => now
    })

    const burst = await Promise.all(
      Array.from({ length: 20 }, () => authorization())
    )
    expect(new Set(burst).size).toBe(1)
    expect(burst[0]).toMatch(/^SigV4-STS /)
    expect(presign).toHaveBeenCalledTimes(1)
    expect(presign.mock.calls[0][0].headers).toMatchObject({
      'x-garnet-server-id':
        'garnet:111111111111:us-east-1'
    })

    now += 49_000
    await authorization()
    expect(presign).toHaveBeenCalledTimes(2)
  })

  it('adds the exact tenant and rejects another tenant', async () => {
    const headers = create_broker_headers(ENV, {
      authorization: async () => 'SigV4-STS proof'
    })
    await expect(headers({
      content_type: 'application/json'
    })).resolves.toEqual({
      Authorization: 'SigV4-STS proof',
      'Content-Type': 'application/json',
      'NGSILD-Tenant': 'factory-a'
    })
    await expect(headers({ tenant: 'factory-b' }))
      .rejects.toThrow('not bound')
  })
})
