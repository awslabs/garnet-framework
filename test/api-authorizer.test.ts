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
      JWT_AUD: "garnet-api",
      JWT_MAX_AGE_SECONDS: "2678400"
    }
    jest.spyOn(Date, "now").mockReturnValue(1_700_000_000_000)
  })

  afterEach(() => {
    process.env = original_env
    jest.restoreAllMocks()
  })

  const load_handler = (
    decoded: Record<string, unknown> | Error,
    signing_secret: string | null = "signing-key"
  ) => {
    const send = jest.fn(async () => ({
      SecretString: signing_secret
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
      tenant: "factory-a",
      iat: 1_700_000_000,
      exp: 1_700_003_600
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
        algorithms: ["HS256"],
        maxAge: 2678400
      }
    )
    expect(send).toHaveBeenCalledTimes(1)
  })

  it("rejects otherwise valid tokens without a safe tenant", async () => {
    const { handler } = load_handler({
      sub: "client-a",
      iss: "garnet",
      aud: "garnet-api",
      iat: 1_700_000_000,
      exp: 1_700_003_600
    })

    await expect(handler({
      headers: { authorization: "signed-token" }
    })).resolves.toEqual({ isAuthorized: false })
  })

  it("does not accept credentials from query parameters", async () => {
    const { handler, send, verify } = load_handler({
      tenant: "factory-a",
      sub: "client-a",
      iat: 1_700_000_000,
      exp: 1_700_003_600
    })

    await expect(handler({
      queryStringParameters: { token: "url-token" }
    })).resolves.toEqual({ isAuthorized: false })
    expect(send).not.toHaveBeenCalled()
    expect(verify).not.toHaveBeenCalled()
  })

  it("rejects signed credentials without a finite lifetime", async () => {
    const { handler } = load_handler({
      sub: "client-a",
      iss: "garnet",
      aud: "garnet-api",
      tenant: "factory-a",
      iat: 1_700_000_000
    })

    await expect(handler({
      headers: { authorization: "signed-token" }
    })).resolves.toEqual({ isAuthorized: false })
  })

  it("rejects an empty signing secret without verifying the token", async () => {
    const { handler, verify } = load_handler({
      sub: "client-a",
      tenant: "factory-a",
      iat: 1_700_000_000,
      exp: 1_700_003_600
    }, null)

    await expect(handler({
      headers: { authorization: "signed-token" }
    })).resolves.toEqual({ isAuthorized: false })
    expect(verify).not.toHaveBeenCalled()
  })

  it("refreshes its signing-key cache after one minute", async () => {
    const { handler, send } = load_handler({
      sub: "client-a",
      iss: "garnet",
      aud: "garnet-api",
      tenant: "factory-a",
      iat: 1_700_000_000,
      exp: 1_700_003_600
    })
    const event = {
      headers: { authorization: "signed-token" }
    }

    await handler(event)
    jest.spyOn(Date, "now").mockReturnValue(1_700_000_061_000)
    await handler(event)

    expect(send).toHaveBeenCalledTimes(2)
  })
})
