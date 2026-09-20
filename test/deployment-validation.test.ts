export {}

jest.mock("/opt/nodejs/broker-auth.js", () => ({
  create_broker_headers: () => async () => ({
    Authorization: "SigV4-STS proof"
  })
}), { virtual: true })

const {
  handler,
  requireEntityCollection,
  timeoutWithin,
  validate
} = require(
  "../lib/stacks/garnet-broker/runtime/lambda/deployment-validation"
)

describe("Garnet API deployment validation", () => {
  const originalFetch = global.fetch
  const originalOrigin = process.env.TEST_ORIGIN

  afterEach(() => {
    global.fetch = originalFetch
    if (originalOrigin === undefined) {
      delete process.env.TEST_ORIGIN
    } else {
      process.env.TEST_ORIGIN = originalOrigin
    }
    jest.restoreAllMocks()
  })

  it("checks health and a local-only NGSI-LD database read", async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce({ status: 200 })
      .mockResolvedValueOnce({
        status: 200,
        json: async () => []
      })

    await expect(
      validate("http://internal:8080", 100)
    ).resolves.toBeUndefined()
    expect(global.fetch).toHaveBeenNthCalledWith(
      1,
      "http://internal:8080/health",
      expect.any(Object)
    )
    expect(global.fetch).toHaveBeenNthCalledWith(
      2,
      "http://internal:8080" +
        "/ngsi-ld/v1/entities?limit=1&local=true",
      expect.objectContaining({
        headers: {
          Accept: "application/ld+json",
          Authorization: "SigV4-STS proof"
        }
      })
    )
  })

  it("rejects a successful status with a malformed Entity collection", async () => {
    await expect(requireEntityCollection({
      json: async () => ({ id: "not-an-array" })
    }, "/ngsi-ld/v1/entities")).rejects.toThrow(
      /did not return an Entity array/
    )
    await expect(requireEntityCollection({
      json: async () => {
        throw new Error("invalid JSON")
      }
    }, "/ngsi-ld/v1/entities")).rejects.toThrow(
      /did not return JSON: invalid JSON/
    )
  })

  it("bounds every network probe by the remaining lifecycle deadline", () => {
    const now = jest.spyOn(Date, "now")
      .mockReturnValue(10_000)

    expect(timeoutWithin(12_500)).toBe(2_500)
    expect(timeoutWithin(20_000)).toBe(5_000)
    expect(() => timeoutWithin(10_000))
      .toThrow(/deadline exceeded/)
    now.mockRestore()
  })

  it("returns the ECS failure contract when validation cannot run", async () => {
    delete process.env.TEST_ORIGIN
    jest.spyOn(console, "error").mockImplementation(() => undefined)
    await expect(handler()).resolves.toEqual({
      hookStatus: "FAILED"
    })
  })

  it("returns the native ECS success contract after semantic validation", async () => {
    process.env.TEST_ORIGIN = "http://internal:8080"
    global.fetch = jest.fn()
      .mockResolvedValueOnce({ status: 200 })
      .mockResolvedValueOnce({
        status: 200,
        json: async () => []
      })

    await expect(handler()).resolves.toEqual({
      hookStatus: "SUCCEEDED"
    })
  })
})
