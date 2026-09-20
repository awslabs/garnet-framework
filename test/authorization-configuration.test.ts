import {
  authorization_configuration,
  canonical_json
} from "../lib/stacks/garnet-broker/runtime/authorization-configuration"

describe("canonical authorization configuration", () => {
  it("normalizes object key order without reordering policy arrays", () => {
    expect(canonical_json({
      z: 1,
      nested: { b: 2, a: 1 }
    })).toBe('{"nested":{"a":1,"b":2},"z":1}')

    const left = authorization_configuration({
      policies: [{ b: 2, a: 1 }],
      bindings: [{ principalId: "principal", tenant: "default" }],
      canonical_bindings: [{
        tenant: "default",
        principalId: "principal"
      }],
      identity: { audience: "garnet", issuer: "https://id.example" }
    })
    const right = authorization_configuration({
      policies: [{ a: 1, b: 2 }],
      bindings: [{ tenant: "default", principalId: "principal" }],
      canonical_bindings: [{
        principalId: "principal",
        tenant: "default"
      }],
      identity: { issuer: "https://id.example", audience: "garnet" }
    })

    expect(left.digest).toBe(right.digest)
    expect(left.environment.AUTHORIZATION_POLICIES)
      .toBe(right.environment.AUTHORIZATION_POLICIES)
    expect(left.environment.AUTHORIZATION_BINDINGS)
      .toBe(right.environment.AUTHORIZATION_BINDINGS)
  })

  it("changes the digest when effective authorization changes", () => {
    const configuration = (tenant: string) =>
      authorization_configuration({
        policies: [],
        bindings: [],
        canonical_bindings: [],
        identity: { tenant }
      })

    expect(configuration("a").digest)
      .not.toBe(configuration("b").digest)
  })
})
