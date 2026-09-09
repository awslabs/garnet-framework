export {}

const {
  handler,
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
      .mockResolvedValueOnce({ status: 200 })

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
      expect.any(Object)
    )
  })

  it("returns the ECS failure contract when validation cannot run", async () => {
    delete process.env.TEST_ORIGIN
    jest.spyOn(console, "error").mockImplementation(() => undefined)
    await expect(handler()).resolves.toEqual({
      hookStatus: "FAILED"
    })
  })
})
