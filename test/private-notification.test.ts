export {}

const send = jest.fn()
process.env.GARNET_TENANT = "factory-a"

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

const { handler, key, MAX_PAYLOAD_BYTES } = require(
  "../lib/connectors/aws-iot-core-mqtt/lambda"
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
    expect(command.input.payload).toBe(JSON.stringify(notification))
    expect(command.input.qos).toBe(1)
    expect(command.input.retain).toBe(false)
    expect(command.input.messageExpiry).toBe(300)
  })

  it("rejects another tenant without publishing", async () => {
    await expect(handler({
      headers: {
        "NGSILD-Tenant": "factory-b"
      },
      body: JSON.stringify(notification)
    })).resolves.toEqual({
      statusCode: 403,
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        message: "Notification tenant is not authorized"
      })
    })

    expect(send).not.toHaveBeenCalled()
  })

  it.each([
    ["malformed JSON", "{"],
    [
      "empty Subscription id",
      JSON.stringify({
        ...notification,
        subscriptionId: ""
      })
    ],
    [
      "non-object Entity data",
      JSON.stringify({
        ...notification,
        data: ["not-an-entity"]
      })
    ]
  ])("rejects %s", async (_name, body) => {
    await expect(handler({
      headers: {
        "NGSILD-Tenant": "factory-a"
      },
      body
    })).resolves.toMatchObject({
      statusCode: 400
    })
    expect(send).not.toHaveBeenCalled()
  })

  it("rejects payloads above the IoT Core limit", async () => {
    const oversized = JSON.stringify({
      ...notification,
      padding: "x".repeat(MAX_PAYLOAD_BYTES)
    })

    await expect(handler({
      headers: {
        "NGSILD-Tenant": "factory-a"
      },
      body: oversized
    })).resolves.toMatchObject({
      statusCode: 413
    })
    expect(send).not.toHaveBeenCalled()
  })

  it("sanitizes upstream failures", async () => {
    send.mockRejectedValueOnce(new Error("credential detail"))

    await expect(handler({
      headers: {
        "NGSILD-Tenant": "factory-a"
      },
      body: JSON.stringify(notification)
    })).resolves.toEqual({
      statusCode: 502,
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        message: "AWS IoT Core publish failed"
      })
    })

    expect(send).toHaveBeenCalledTimes(1)
  })
})
