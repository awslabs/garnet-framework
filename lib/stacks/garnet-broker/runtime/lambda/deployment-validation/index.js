"use strict"

const { setTimeout } = require("node:timers")
const {
  create_broker_headers: createBrokerHeaders
} = require("/opt/nodejs/broker-auth.js")
const brokerHeaders = createBrokerHeaders()

const wait = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds))

const probe = async (
  origin,
  path,
  expectedStatus,
  timeoutMilliseconds,
  headers
) => {
  const response = await globalThis.fetch(`${origin}${path}`, {
    ...(headers === undefined ? {} : { headers }),
    signal: globalThis.AbortSignal.timeout(timeoutMilliseconds)
  })
  if (response.status !== expectedStatus) {
    throw new Error(
      `${path} returned ${response.status}; expected ${expectedStatus}`
    )
  }
  return response
}

const timeoutWithin = (deadline, maximum = 5000) => {
  const remaining = deadline - Date.now()
  if (remaining <= 0) {
    throw new Error("deployment validation deadline exceeded")
  }
  return Math.max(1, Math.min(maximum, remaining))
}

const requireEntityCollection = async (response, path) => {
  let body
  try {
    body = await response.json()
  } catch (error) {
    throw new Error(
      `${path} did not return JSON: ` +
        (error instanceof Error ? error.message : String(error))
    )
  }
  if (!Array.isArray(body)) {
    throw new Error(`${path} did not return an Entity array`)
  }
}

const validate = async (
  origin = process.env.TEST_ORIGIN,
  deadlineMilliseconds = 25000
) => {
  if (typeof origin !== "string" || origin.trim() === "") {
    throw new Error("TEST_ORIGIN is required")
  }
  const deadline = Date.now() + deadlineMilliseconds
  let lastError
  do {
    try {
      await probe(
        origin,
        "/health",
        200,
        timeoutWithin(deadline)
      )
      const path =
        "/ngsi-ld/v1/entities?limit=1&local=true"
      const authentication = await brokerHeaders()
      const entities = await probe(
        origin,
        path,
        200,
        timeoutWithin(deadline),
        {
          ...authentication,
          Accept: "application/ld+json"
        }
      )
      await requireEntityCollection(entities, path)
      return
    } catch (error) {
      lastError = error
      const remaining = deadline - Date.now()
      if (remaining <= 0) break
      await wait(Math.min(1000, remaining))
    }
  } while (Date.now() < deadline)
  throw lastError
}

const handler = async () => {
  try {
    await validate()
    return { hookStatus: "SUCCEEDED" }
  } catch (error) {
    console.error(
      "Garnet API deployment validation failed",
      error instanceof Error ? error.message : String(error)
    )
    return { hookStatus: "FAILED" }
  }
}

module.exports = {
  handler,
  probe,
  requireEntityCollection,
  timeoutWithin,
  validate
}
