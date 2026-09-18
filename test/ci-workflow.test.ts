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
})
