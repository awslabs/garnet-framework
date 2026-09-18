import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const action = readFileSync(
  resolve(__dirname, "../.github/actions/deploy/action.yml"),
  "utf8"
)

describe("deployment action", () => {
  it("fails closed against the environment's exact AWS account", () => {
    expect(action).toMatch(
      /aws-account-id:[\s\S]*?required: true/
    )
    expect(action).toContain(
      "uses: aws-actions/configure-aws-credentials@v6.2.1"
    )
    expect(action).toContain(
      "allowed-account-ids: ${{ inputs.aws-account-id }}"
    )
    expect(action).toContain(
      '[[ ! "$EXPECTED_AWS_ACCOUNT_ID" =~ ^[0-9]{12}$ ]]'
    )
  })

  it("defaults production deployments to blue/green", () => {
    expect(action).toMatch(
      /deployment-strategy:[\s\S]*?default: bluegreen/
    )
  })

  it("uses cost-aware production database and worker defaults", () => {
    expect(action).toMatch(
      /database-reader-enabled:[\s\S]*?default: 'true'/
    )
    expect(action).toMatch(
      /aurora-min-acu:[\s\S]*?default: '2'/
    )
    expect(action).toMatch(
      /aurora-max-acu:[\s\S]*?default: '128'/
    )
    expect(action).toMatch(
      /aurora-storage:[\s\S]*?default: standard/
    )
    expect(action).toMatch(
      /worker-spot-scale-out:[\s\S]*?default: 'true'/
    )
    expect(action).toMatch(
      /ecs-instance-type:[\s\S]*?default: auto/
    )
    expect(action).toContain("c9g.2xlarge c8g.2xlarge c7g.2xlarge c6g.2xlarge")
    for (const setting of [
      "GARNET_DATABASE_READER_ENABLED",
      "GARNET_AURORA_MIN_ACU",
      "GARNET_AURORA_MAX_ACU",
      "GARNET_AURORA_STORAGE",
      "GARNET_WORKER_SPOT_SCALE_OUT"
    ]) {
      expect(action).toContain(`${setting}:`)
    }
  })

  it("keeps production Temporal history bounded by default", () => {
    expect(action).toMatch(
      /temporal-history-retention-days:[\s\S]*?default: '365'/
    )
    expect(action).toMatch(
      /temporal-history-retention-max-gib:[\s\S]*?default: '500'/
    )
    expect(action).toMatch(
      /temporal-history-retention-max-partitions:[\s\S]*?default: '12'/
    )
    expect(action).toContain(
      "GARNET_TEMPORAL_HISTORY_RETENTION_DAYS: " +
      "${{ inputs.temporal-history-retention-days }}"
    )
    expect(action).toContain(
      "GARNET_TEMPORAL_HISTORY_RETENTION_MAX_GIB: " +
      "${{ inputs.temporal-history-retention-max-gib }}"
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
