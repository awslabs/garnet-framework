import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const action = readFileSync(
  resolve(__dirname, "../.github/actions/deploy/action.yml"),
  "utf8"
)

describe("deployment action", () => {
  it("defaults production deployments to blue/green", () => {
    expect(action).toMatch(
      /deployment-strategy:[\s\S]*?default: bluegreen/
    )
  })

  it("diffs and deploys one environment-specific cloud assembly", () => {
    const synth = action.indexOf("run: npx cdk synth --quiet")
    const diff = action.indexOf(
      "run: npx cdk diff --app cdk.out --method change-set"
    )
    const deploy = action.indexOf("npx cdk deploy --app cdk.out")

    expect(synth).toBeGreaterThan(-1)
    expect(diff).toBeGreaterThan(synth)
    expect(deploy).toBeGreaterThan(diff)
  })

  it("does not hide diff failures", () => {
    expect(action).not.toMatch(/cdk diff[^\n]*\|\| true/)
    expect(action).not.toContain("cdk diff --fail")
  })
})
