"use strict"

const { createHash } = require("crypto")
const {
  IoTDataPlaneClient,
  PublishCommand
} = require("@aws-sdk/client-iot-data-plane")

const iot = new IoTDataPlaneClient({
  region: process.env.AWSIOTREGION
})
const configuredTenant = process.env.GARNET_TENANT
const MAX_PAYLOAD_BYTES = 128 * 1024

const header = (event, name) => {
  const expected = name.toLowerCase()
  for (const [key, value] of Object.entries(event.headers ?? {})) {
    if (key.toLowerCase() === expected) return value
  }
  return undefined
}

const safeTenant = (event) => {
  const tenant = (header(event, "NGSILD-Tenant") ?? "default").trim()
  if (tenant === "" || /[\0\r\n]/.test(tenant)) {
    throw new Error("NGSILD-Tenant is not a valid header value")
  }
  if (!configuredTenant || tenant !== configuredTenant) {
    throw new Error("NGSILD-Tenant is not authorized for this connector")
  }
  return tenant
}

const key = (value) =>
  createHash("sha256").update(value, "utf8").digest("hex")

const notificationTopic = (tenant, subscriptionId) =>
  `garnet-framework/tenants/${key(tenant)}/subscriptions/` +
  key(subscriptionId)

const response = (statusCode, message) => ({
  statusCode,
  ...(message === undefined
    ? {}
    : {
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ message })
      })
})

const handler = async (event) => {
  if (!event.body) {
    return response(400, "Notification body is required")
  }
  if (Buffer.byteLength(event.body, "utf8") > MAX_PAYLOAD_BYTES) {
    return response(413, "Notification exceeds the MQTT payload limit")
  }

  let payload
  try {
    payload = JSON.parse(event.body)
    if (
      payload?.type !== "Notification" ||
      typeof payload.subscriptionId !== "string" ||
      payload.subscriptionId.trim() === "" ||
      !Array.isArray(payload.data) ||
      payload.data.some(
        (entity) =>
          typeof entity !== "object" ||
          entity === null ||
          Array.isArray(entity)
      )
    ) {
      return response(400, "A valid NGSI-LD Notification is required")
    }
  } catch {
    return response(400, "A valid NGSI-LD Notification is required")
  }

  let tenant
  try {
    tenant = safeTenant(event)
  } catch {
    return response(403, "Notification tenant is not authorized")
  }

  try {
    await iot.send(new PublishCommand({
      topic: notificationTopic(tenant, payload.subscriptionId),
      payload: event.body,
      qos: 1,
      retain: false,
      messageExpiry: 300
    }))
    return response(200)
  } catch (error) {
    console.error(error)
    return response(502, "AWS IoT Core publish failed")
  }
}

module.exports = {
  handler,
  key,
  MAX_PAYLOAD_BYTES,
  notificationTopic,
  safeTenant
}
