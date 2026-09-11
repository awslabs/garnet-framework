const LAMBDA_PATH =
  '../lib/stacks/garnet-api/apiauth/lambda/apiAuthJwt/index.js'

type SecretCommand = {
  input: Record<string, string>
  operation: 'get' | 'put'
}

describe('API client token provisioner', () => {
  const original_env = process.env

  beforeEach(() => {
    jest.resetModules()
    process.env = {
      ...original_env,
      SECRET_ARN: 'signing-secret-arn',
      TOKEN_SECRET_ARN: 'client-token-secret-arn',
      JWT_SUB: 'garnet-client',
      JWT_ISS: 'garnet',
      JWT_AUD: 'garnet-api',
      JWT_TENANT: 'factory-a',
      JWT_TTL_SECONDS: '2592000'
    }
    jest.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000)
  })

  afterEach(() => {
    process.env = original_env
    jest.restoreAllMocks()
  })

  const load_handler = (signing_secret: string | null = 'signing-key') => {
    const send = jest.fn(async (command: SecretCommand) => {
      if (command.operation === 'get') {
        return { SecretString: signing_secret }
      }
      return {}
    })
    const sign = jest.fn(() => 'signed-client-token')

    jest.doMock('@aws-sdk/client-secrets-manager', () => ({
      GetSecretValueCommand: class {
        operation = 'get'
        constructor(public input: Record<string, string>) {}
      },
      PutSecretValueCommand: class {
        operation = 'put'
        constructor(public input: Record<string, string>) {}
      },
      SecretsManagerClient: class {
        send = send
      }
    }), { virtual: true })
    jest.doMock('jsonwebtoken', () => ({ sign }), { virtual: true })

    return {
      handler: require(LAMBDA_PATH).handler,
      send,
      sign
    }
  }

  it('writes the token to Secrets Manager and never returns it', async () => {
    const { handler, send, sign } = load_handler()

    const result = await handler({ RequestType: 'Create' })

    expect(sign).toHaveBeenCalledWith({
      sub: 'garnet-client',
      iss: 'garnet',
      aud: 'garnet-api',
      tenant: 'factory-a',
      iat: 1_700_000_000,
      exp: 1_702_592_000
    }, 'signing-key', {
      algorithm: 'HS256'
    })
    expect(send).toHaveBeenCalledTimes(2)
    expect(send.mock.calls[1]![0]).toEqual(expect.objectContaining({
      operation: 'put',
      input: {
        SecretId: 'client-token-secret-arn',
        SecretString: JSON.stringify({
          Authorization: 'signed-client-token'
        })
      }
    }))
    expect(result).toEqual({
      Data: { tokenSecretArn: 'client-token-secret-arn' }
    })
    expect(JSON.stringify(result)).not.toContain('signed-client-token')
  })

  it('does not read or rewrite credentials during stack deletion', async () => {
    const { handler, send, sign } = load_handler()

    await expect(handler({ RequestType: 'Delete' }))
      .resolves.toEqual({})
    expect(send).not.toHaveBeenCalled()
    expect(sign).not.toHaveBeenCalled()
  })

  it('refreshes the stored credential when invoked by its schedule', async () => {
    const { handler, send, sign } = load_handler()

    await handler({
      source: 'aws.events',
      'detail-type': 'Scheduled Event'
    })

    expect(send).toHaveBeenCalledTimes(2)
    expect(sign).toHaveBeenCalledTimes(1)
  })

  it('fails the CloudFormation operation when token provisioning fails', async () => {
    const { handler, send, sign } = load_handler(null)

    await expect(handler({ RequestType: 'Create' }))
      .rejects.toThrow('JWT signing secret has no SecretString')
    expect(send).toHaveBeenCalledTimes(1)
    expect(sign).not.toHaveBeenCalled()
  })

  it('rejects an invalid credential lifetime', async () => {
    process.env.JWT_TTL_SECONDS = 'never'
    const { handler, send, sign } = load_handler()

    await expect(handler({ RequestType: 'Create' }))
      .rejects.toThrow('JWT_TTL_SECONDS must be a positive integer')
    expect(send).toHaveBeenCalledTimes(1)
    expect(sign).not.toHaveBeenCalled()
  })
})
