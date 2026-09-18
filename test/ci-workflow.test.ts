import { readFileSync } from "node:fs"
import { join } from "node:path"

const workflow = readFileSync(
  join(process.cwd(), ".github/workflows/ci.yml"),
  "utf8"
)

describe("CI security scan", () => {
  it("uses the open-source scanner through an immutable image", () => {
    const security = workflow.slice(
      workflow.indexOf("  security:"),
      workflow.indexOf("  synth:")
    )
    expect(workflow).not.toContain("gitleaks/gitleaks-action")
    expect(security).toContain("fetch-depth: 0")
    expect(security).toMatch(
      /ghcr[.]io\/gitleaks\/gitleaks@sha256:[0-9a-f]{64}/
    )
    expect(security).toContain(
      "git --redact --verbose --no-banner --platform github ."
    )
  })

  it("supplies the complete authenticated synthesis contract", () => {
    const synth = workflow.slice(
      workflow.indexOf("  synth:"),
      workflow.indexOf("  ci:")
    )
    expect(synth).toContain(
      "GARNET_OIDC_ISSUER: https://identity.example"
    )
    expect(synth).toContain(
      "GARNET_OIDC_AUDIENCES: garnet-api"
    )
    expect(synth).toContain(
      "GARNET_BOOTSTRAP_ADMIN_SUBJECT: ci-admin"
    )
  })
})
