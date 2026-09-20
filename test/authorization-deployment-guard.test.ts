export {}

const {
  assert_ordinary_deployment,
  candidate_digest,
  deployed_digest
} = require(
  "../.github/scripts/authorization-deployment-guard.js"
)

const DIGEST_A = `sha256:${"a".repeat(64)}`
const DIGEST_B = `sha256:${"b".repeat(64)}`

const stack = (digest?: string) => ({
  Outputs: digest === undefined
    ? []
    : [{
        OutputKey: "GarnetAuthorizationConfigurationDigest",
        OutputValue: digest
      }]
})

describe("authorization deployment guard", () => {
  it("reads the candidate and deployed stack output", () => {
    expect(candidate_digest({
      Outputs: {
        GarnetAuthorizationConfigurationDigest: {
          Value: DIGEST_A
        }
      }
    })).toBe(DIGEST_A)
    expect(deployed_digest(stack(DIGEST_A))).toBe(DIGEST_A)
  })

  it("permits initial creation and an unchanged deployment", () => {
    expect(() =>
      assert_ordinary_deployment(DIGEST_A, undefined)
    ).not.toThrow()
    expect(() =>
      assert_ordinary_deployment(DIGEST_A, stack(DIGEST_A))
    ).not.toThrow()
  })

  it("fails closed for a legacy or changed deployed stack", () => {
    expect(() =>
      assert_ordinary_deployment(DIGEST_A, stack())
    ).toThrow(/no authorization configuration digest/)
    expect(() =>
      assert_ordinary_deployment(DIGEST_A, stack(DIGEST_B))
    ).toThrow(/explicit cutover/)
  })
})
