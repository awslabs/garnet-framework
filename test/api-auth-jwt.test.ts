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
      JWT_AUD: 'garnet-api'
    }
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
      aud: 'garnet-api'
    }, 'signing-key')
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

  it('fails the CloudFormation operation when token provisioning fails', async () => {
    const { handler, send, sign } = load_handler(null)

    await expect(handler({ RequestType: 'Create' }))
      .rejects.toThrow('JWT signing secret has no SecretString')
    expect(send).toHaveBeenCalledTimes(1)
    expect(sign).not.toHaveBeenCalled()
  })
})
