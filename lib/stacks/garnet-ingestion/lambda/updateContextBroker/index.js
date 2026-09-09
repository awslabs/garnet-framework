"use strict"

const dnsBroker =
  `http://${process.env.DNS_CONTEXT_BROKER}/ngsi-ld/v1`
const axios = require("axios")
const {
  log_error: logError,
  normalize
} = require("/opt/nodejs/utils.js")

const client = axios.create({
  timeout: 20000,
  httpAgent: new (require("http").Agent)({
    keepAlive: true,
    maxSockets: 50
  })
})

const tenantOf = (message) => {
  if (
    typeof message === "object" &&
    message !== null &&
    Object.prototype.hasOwnProperty.call(message, "entity")
  ) {
    const tenant = message.tenant ?? "default"
    if (
      typeof tenant !== "string" ||
      tenant.trim() === "" ||
      /[\0\r\n]/.test(tenant)
    ) {
      throw new Error("tenant must be a non-empty HTTP header value")
    }
    return {
      tenant: tenant.trim(),
      entity: message.entity
    }
  }
  return {
    tenant: "default",
    entity: message
  }
}

const parseRecord = (record) => {
  const parsed = tenantOf(JSON.parse(record.body))
  const entity = parsed.entity
  if (
    typeof entity !== "object" ||
    entity === null ||
    !entity.id ||
    !entity.type
  ) {
    throw new Error("Invalid entity: id or type is missing")
  }
  const payload = normalize(entity)
  return {
    id: record.messageId,
    tenant: parsed.tenant,
    contentType: payload["@context"]
      ? "application/ld+json"
      : "application/json",
    payload
  }
}

const groupRecords = (records) => {
  const groups = new Map()
  for (const record of records) {
    const key = `${record.tenant}\u0000${record.contentType}`
    const group = groups.get(key)
    if (group === undefined) {
      groups.set(key, {
        tenant: record.tenant,
        contentType: record.contentType,
        records: [record]
      })
    } else {
      group.records.push(record)
    }
  }
  return [...groups.values()]
}

const handler = async (event, context) => {
  const failures = []
  const valid = []

  for (const record of event.Records) {
    try {
      valid.push(parseRecord(record))
    } catch (error) {
      logError(
        record,
        context,
        error instanceof Error ? error.message : String(error),
        error
      )
      failures.push({ itemIdentifier: record.messageId })
    }
  }

  await Promise.all(groupRecords(valid).map(async (group) => {
    const headers = {
      "Content-Type": group.contentType,
      ...(group.tenant === "default"
        ? {}
        : { "NGSILD-Tenant": group.tenant })
    }
    try {
      await client.post(
        `${dnsBroker}/entityOperations/upsert?options=update`,
        group.records.map((record) => record.payload),
        { headers }
      )
    } catch (error) {
      logError(
        event,
        context,
        error instanceof Error ? error.message : String(error),
        error
      )
      for (const record of group.records) {
        failures.push({ itemIdentifier: record.id })
      }
    }
  }))

  return { batchItemFailures: failures }
}

module.exports = {
  groupRecords,
  handler,
  parseRecord,
  tenantOf
}
