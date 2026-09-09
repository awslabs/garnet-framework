const LAMBDA_PATH =
  "../lib/stacks/garnet-api/apiauth/lambda/apiAuthorizer/index.js"

export {}

describe("tenant-scoped API authorizer", () => {
  const original_env = process.env

  beforeEach(() => {
    jest.resetModules()
    process.env = {
      ...original_env,
      SECRET_ARN: "signing-secret-arn",
      JWT_ISS: "garnet",
      JWT_AUD: "garnet-api"
    }
  })

  afterEach(() => {
    process.env = original_env
    jest.restoreAllMocks()
  })

  const load_handler = (
    decoded: Record<string, unknown> | Error
  ) => {
    const send = jest.fn(async () => ({
      SecretString: "signing-key"
    }))
    const verify = jest.fn(() => {
      if (decoded instanceof Error) throw decoded
      return decoded
    })

    jest.doMock("@aws-sdk/client-secrets-manager", () => ({
      GetSecretValueCommand: class {
        constructor(public input: Record<string, string>) {}
      },
      SecretsManagerClient: class {
        send = send
      }
    }), { virtual: true })
    jest.doMock("jsonwebtoken", () => ({ verify }), {
      virtual: true
    })

    return {
      handler: require(LAMBDA_PATH).handler,
      send,
      verify
    }
  }

  it("binds authorization context to the verified tenant claim", async () => {
    const { handler, send, verify } = load_handler({
      sub: "client-a",
      iss: "garnet",
      aud: "garnet-api",
      tenant: "factory-a"
    })

    await expect(handler({
      headers: {
        authorization: "Bearer signed-token",
        "ngsild-tenant": "spoofed-tenant"
      }
    })).resolves.toEqual({
      isAuthorized: true,
      context: {
        sub: "client-a",
        iss: "garnet",
        aud: "garnet-api",
        tenant: "factory-a"
      }
    })
    expect(verify).toHaveBeenCalledWith(
      "signed-token",
      "signing-key",
      {
        issuer: "garnet",
        audience: "garnet-api",
        algorithms: ["HS256"]
      }
    )
    expect(send).toHaveBeenCalledTimes(1)
  })

  it("rejects otherwise valid tokens without a safe tenant", async () => {
    const { handler } = load_handler({
      sub: "client-a",
      iss: "garnet",
      aud: "garnet-api"
    })

    await expect(handler({
      headers: { authorization: "signed-token" }
    })).resolves.toEqual({ isAuthorized: false })
  })

  it("does not accept credentials from query parameters", async () => {
    const { handler, send, verify } = load_handler({
      tenant: "factory-a"
    })

    await expect(handler({
      queryStringParameters: { token: "url-token" }
    })).resolves.toEqual({ isAuthorized: false })
    expect(send).not.toHaveBeenCalled()
    expect(verify).not.toHaveBeenCalled()
  })
})
