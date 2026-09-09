"use strict"

const { createHash } = require("crypto")
const {
  IoTDataPlaneClient,
  PublishCommand
} = require("@aws-sdk/client-iot-data-plane")
const {
  recursive_concise: recursiveConcise
} = require("/opt/nodejs/utils.js")

const iot = new IoTDataPlaneClient({
  region: process.env.AWSIOTREGION
})

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
  return tenant
}

const key = (value) =>
  createHash("sha256").update(value, "utf8").digest("hex")

const notificationTopic = (tenant, subscriptionId) =>
  `garnet-framework/tenants/${key(tenant)}/subscriptions/` +
  key(subscriptionId)

const conciseNotification = (payload) => {
  for (const entity of payload.data) {
    for (const [attribute, value] of Object.entries(entity)) {
      if (["type", "id", "@context"].includes(attribute)) continue
      if (typeof value === "object" && !Array.isArray(value)) {
        recursiveConcise(attribute, value)
      } else {
        entity[attribute] = { value }
      }
    }
  }
}

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
  try {
    if (!event.body) {
      return response(400, "Notification body is required")
    }
    const payload = JSON.parse(event.body)
    if (
      payload?.type !== "Notification" ||
      typeof payload.subscriptionId !== "string" ||
      !Array.isArray(payload.data)
    ) {
      return response(400, "A valid NGSI-LD Notification is required")
    }
    const tenant = safeTenant(event)
    conciseNotification(payload)
    await iot.send(new PublishCommand({
      topic: notificationTopic(tenant, payload.subscriptionId),
      payload: JSON.stringify(payload)
    }))
    return response(200)
  } catch (error) {
    console.error(error)
    return response(
      500,
      error instanceof Error ? error.message : String(error)
    )
  }
}

module.exports = {
  handler,
  key,
  notificationTopic,
  safeTenant
}
