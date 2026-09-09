export {}

const send = jest.fn()

jest.mock("@aws-sdk/client-iot-data-plane", () => ({
  IoTDataPlaneClient: class {
    send(command: unknown) {
      return send(command)
    }
  },
  PublishCommand: class {
    constructor(public readonly input: unknown) {}
  }
}), { virtual: true })

jest.mock(
  "/opt/nodejs/utils.js",
  () => ({
    recursive_concise: () => undefined
  }),
  { virtual: true }
)

const {
  handler,
  key
} = require(
  "../lib/stacks/garnet-privatesub/lambda/garnetSub"
)

const notification = {
  type: "Notification",
  subscriptionId: "urn:ngsi-ld:Subscription:shared-name",
  data: [{
    id: "urn:ngsi-ld:Device:1",
    type: "Device",
    temperature: {
      type: "Property",
      value: 21
    }
  }]
}

describe("private multi-tenant notification routing", () => {
  beforeEach(() => {
    send.mockReset()
    send.mockResolvedValue({})
  })

  it("isolates the IoT topic by full tenant and subscription identity", async () => {
    await expect(handler({
      headers: {
        "NGSILD-Tenant": "factory-a"
      },
      body: JSON.stringify(notification)
    })).resolves.toEqual({ statusCode: 200 })

    const command = send.mock.calls[0][0]
    expect(command.input.topic).toBe(
      `garnet-framework/tenants/${key("factory-a")}/` +
      `subscriptions/${key(notification.subscriptionId)}`
    )
  })

  it("uses a stable default-tenant topic when the header is absent", async () => {
    await handler({
      headers: {},
      body: JSON.stringify(notification)
    })

    expect(send.mock.calls[0][0].input.topic).toContain(
      `/tenants/${key("default")}/`
    )
  })
})
