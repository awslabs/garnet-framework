"use strict"

const requiredString = (value, field) => {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${field} must be a non-empty string`)
  }
  return value
}

const entityType = (payload) => {
  const entity = payload?.after ?? payload?.before
  const type = entity?.type
  if (typeof type === "string") return type
  if (Array.isArray(type)) {
    return type.find((candidate) => typeof candidate === "string")
  }
  return undefined
}

const toIcebergRow = (event) => {
  if (event?.schemaVersion !== 1) {
    throw new Error("schemaVersion must be 1")
  }
  const committedAt = requiredString(event.committedAt, "committedAt")
  const committedAtMillis = Date.parse(committedAt)
  if (!Number.isFinite(committedAtMillis)) {
    throw new Error("committedAt must be an ISO-8601 timestamp")
  }
  if (event.payload === undefined) {
    throw new Error("payload is required")
  }

  return {
    schema_version: event.schemaVersion,
    event_id: requiredString(event.eventId, "eventId"),
    tenant: requiredString(event.tenant, "tenant"),
    entity_id: requiredString(event.entityId, "entityId"),
    committed_at: committedAtMillis * 1000,
    aggregate_version:
      requiredString(event.aggregateVersion, "aggregateVersion"),
    control_cursor:
      requiredString(event.controlCursor, "controlCursor"),
    operation: requiredString(event.operation, "operation"),
    entity_type: entityType(event.payload),
    payload_json: JSON.stringify(event.payload)
  }
}

const transformRecord = (
  record,
  databaseName = process.env.DESTINATION_DATABASE_NAME,
  tableName = process.env.DESTINATION_TABLE_NAME
) => {
  try {
    const event = JSON.parse(
      Buffer.from(record.data, "base64").toString("utf8")
    )
    const row = toIcebergRow(event)
    return {
      recordId: record.recordId,
      result: "Ok",
      data: Buffer.from(JSON.stringify(row), "utf8").toString("base64"),
      metadata: {
        otfMetadata: {
          destinationDatabaseName:
            requiredString(databaseName, "DESTINATION_DATABASE_NAME"),
          destinationTableName:
            requiredString(tableName, "DESTINATION_TABLE_NAME"),
          operation: "insert"
        }
      }
    }
  } catch (error) {
    console.error(
      "Garnet Lake rejected an Entity event",
      record.recordId,
      error instanceof Error ? error.message : String(error)
    )
    return {
      recordId: record.recordId,
      result: "ProcessingFailed",
      data: record.data
    }
  }
}

const handler = async (event) => ({
  records: event.records.map((record) => transformRecord(record))
})

module.exports = {
  entityType,
  handler,
  toIcebergRow,
  transformRecord
}
