"use strict"

const { setTimeout } = require("node:timers")

const wait = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds))

const probe = async (origin, path, expectedStatus) => {
  const response = await globalThis.fetch(`${origin}${path}`, {
    signal: globalThis.AbortSignal.timeout(5000)
  })
  if (response.status !== expectedStatus) {
    throw new Error(
      `${path} returned ${response.status}; expected ${expectedStatus}`
    )
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
      await probe(origin, "/health", 200)
      await probe(
        origin,
        "/ngsi-ld/v1/entities?limit=1&local=true",
        200
      )
      return
    } catch (error) {
      lastError = error
      if (Date.now() + 1000 >= deadline) break
      await wait(1000)
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
  validate
}
