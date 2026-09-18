import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const workflow = readFileSync(
  resolve(__dirname, "../.github/workflows/cd.yml"),
  "utf8"
)

const job = (name: string, next?: string): string => {
  const start = workflow.indexOf(`  ${name}:`)
  const end = next === undefined
    ? workflow.length
    : workflow.indexOf(`  ${next}:`, start + 1)
  if (start < 0 || end < 0) {
    throw new Error(`CD workflow job ${name} is missing`)
  }
  return workflow.slice(start, end)
}

describe("CD deployment concurrency", () => {
  it("lets experimental deploy dev but reserves promotion for main", () => {
    expect(workflow).toContain("branches: [main, experimental]")
    expect(job("deploy-dev", "deploy-stage")).toContain(
      "if: github.event_name == 'push'"
    )
    expect(job("deploy-stage", "deploy-prod")).toContain(
      "if: github.ref_name == 'main'"
    )
  })

  it("binds every deployment to its environment account", () => {
    expect(
      workflow.match(
        /aws-account-id: \$\{\{ vars\.AWS_ACCOUNT_ID \}\}/g
      )
    ).toHaveLength(4)
  })

  it.each([
    ["deploy-dev", "deploy-stage", "garnet-deploy-dev"],
    ["deploy-stage", "deploy-prod", "garnet-deploy-stage"],
    ["deploy-prod", "deploy-manual", "garnet-deploy-prod"]
  ])("serializes the %s environment", (name, next, group) => {
    expect(job(name, next)).toContain(`group: ${group}`)
    expect(job(name, next)).toContain("cancel-in-progress: false")
  })

  it("shares the selected environment group with manual deployments", () => {
    const manual = job("deploy-manual")
    expect(manual).toContain(
      "group: garnet-deploy-${{ github.event.inputs.environment }}"
    )
    expect(manual).toContain("cancel-in-progress: false")
  })
})
