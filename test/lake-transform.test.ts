import { brotliCompressSync, constants } from "node:zlib"

const {
  decodeEntityEvent,
  toIcebergRow,
  transformRecord
} = require(
  "../lib/stacks/garnet-lake/stream/lambda/transform"
)

const envelope = {
  schemaVersion: 1,
  eventId: "018f68bd-7fd0-7000-8000-000000000001",
  tenant: "acme",
  entityId: "urn:ngsi-ld:Device:1",
  committedAt: "2026-09-08T12:34:56.789Z",
  aggregateVersion: "42",
  controlCursor: "7",
  operation: "update",
  payload: {
    schemaVersion: 1,
    before: null,
    after: {
      id: "urn:ngsi-ld:Device:1",
      type: ["https://example.org/Device"]
    },
    changed: ["temperature"],
    occurredAt: "2026-09-08T12:34:56.789Z"
  }
}

const compactWire = (event: typeof envelope, version = 1) => {
  const compact = Buffer.from(JSON.stringify([
    event.eventId,
    event.tenant,
    event.entityId,
    event.committedAt,
    event.aggregateVersion,
    event.controlCursor,
    event.operation,
    event.payload
  ]), "utf8")
  const compressed = brotliCompressSync(compact, {
    params: {
      [constants.BROTLI_PARAM_QUALITY]: 5,
      [constants.BROTLI_PARAM_SIZE_HINT]: compact.length
    }
  })
  return Buffer.concat([
    Buffer.from([0x47, 0x4c, 0x42, version]),
    compressed
  ]).toString("base64")
}

describe("Garnet Lake Entity-event transform", () => {
  it("maps a broker envelope to the stable Iceberg row", () => {
    expect(toIcebergRow(envelope)).toEqual({
      schema_version: 1,
      event_id: "018f68bd-7fd0-7000-8000-000000000001",
      tenant: "acme",
      entity_id: "urn:ngsi-ld:Device:1",
      committed_at: Date.parse(envelope.committedAt) * 1000,
      aggregate_version: "42",
      control_cursor: "7",
      operation: "update",
      entity_type: "https://example.org/Device",
      payload_json: JSON.stringify(envelope.payload)
    })
  })

  it("routes each valid record to the one Iceberg event table", () => {
    const record = transformRecord({
      recordId: "record-1",
      data: Buffer.from(JSON.stringify(envelope)).toString("base64")
    }, "garnet_framework", "entity_events")

    expect(record).toMatchObject({
      recordId: "record-1",
      result: "Ok",
      metadata: {
        otfMetadata: {
          destinationDatabaseName: "garnet_framework",
          destinationTableName: "entity_events",
          operation: "insert"
        }
      }
    })
    expect(JSON.parse(
      Buffer.from(record.data, "base64").toString("utf8")
    )).toMatchObject({
      tenant: "acme",
      entity_type: "https://example.org/Device"
    })
  })

  it("decodes compact Brotli v1 records into the stable envelope", () => {
    expect(decodeEntityEvent(compactWire(envelope))).toEqual(envelope)
    const record = transformRecord({
      recordId: "record-compact",
      data: compactWire(envelope)
    }, "garnet_framework", "entity_events")

    expect(record.result).toBe("Ok")
    expect(JSON.parse(
      Buffer.from(record.data, "base64").toString("utf8")
    )).toMatchObject({
      event_id: envelope.eventId,
      tenant: envelope.tenant
    })
  })

  it("rejects unknown or malformed compact wire records", () => {
    for (const data of [
      compactWire(envelope, 2),
      Buffer.from([0x47, 0x4c, 0x42, 0x01, 0xff]).toString("base64")
    ]) {
      expect(transformRecord({
        recordId: "record-compact-bad",
        data
      }, "garnet_framework", "entity_events")).toEqual({
        recordId: "record-compact-bad",
        result: "ProcessingFailed",
        data
      })
    }
  })

  it("fails malformed records instead of silently dropping them", () => {
    const record = transformRecord({
      recordId: "record-bad",
      data: Buffer.from(JSON.stringify({
        ...envelope,
        tenant: ""
      })).toString("base64")
    }, "garnet_framework", "entity_events")

    expect(record).toEqual({
      recordId: "record-bad",
      result: "ProcessingFailed",
      data: expect.any(String)
    })
  })
})
