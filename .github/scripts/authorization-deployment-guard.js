#!/usr/bin/env node

"use strict"

const fs = require("node:fs")
const { spawnSync } = require("node:child_process")

const DIGEST = /^sha256:[0-9a-f]{64}$/
const OUTPUT_KEY = "GarnetAuthorizationConfigurationDigest"

const candidate_digest = (template) => {
  const value = template?.Outputs?.[OUTPUT_KEY]?.Value
  if (typeof value !== "string" || !DIGEST.test(value)) {
    throw new Error(
      `${OUTPUT_KEY} is missing or is not a canonical sha256 digest`
    )
  }
  return value
}

const deployed_digest = (stack) => {
  const outputs = stack?.Outputs
  if (!Array.isArray(outputs)) return undefined
  const output = outputs.find((entry) =>
    entry?.OutputKey === OUTPUT_KEY
  )
  return typeof output?.OutputValue === "string"
    ? output.OutputValue
    : undefined
}

const assert_ordinary_deployment = (candidate, stack) => {
  if (!DIGEST.test(candidate)) {
    throw new Error("Candidate authorization digest is invalid")
  }
  if (stack === undefined) return

  const deployed = deployed_digest(stack)
  if (deployed === undefined) {
    throw new Error(
      "Existing Garnet stack has no authorization configuration digest; " +
      "ordinary rolling/blue-green deployment is blocked. Perform the " +
      "documented explicit authorization cutover."
    )
  }
  if (deployed !== candidate) {
    throw new Error(
      "Authorization configuration digest changed; ordinary " +
      "rolling/blue-green deployment is blocked. Drain every authorization " +
      "executor and perform the documented explicit cutover."
    )
  }
}

const describe_stack = (stack_name, region) => {
  const result = spawnSync("aws", [
    "cloudformation",
    "describe-stacks",
    "--stack-name",
    stack_name,
    "--region",
    region,
    "--output",
    "json"
  ], {
    encoding: "utf8"
  })
  if (result.status === 0) {
    const document = JSON.parse(result.stdout)
    const stack = document?.Stacks?.[0]
    if (stack === undefined) {
      throw new Error("CloudFormation returned no deployed Garnet stack")
    }
    return stack
  }
  if (/does not exist/i.test(result.stderr || "")) {
    return undefined
  }
  throw new Error(
    "Unable to read the deployed Garnet authorization digest from " +
    "CloudFormation"
  )
}

const main = (argv = process.argv.slice(2), env = process.env) => {
  const [template_path, stack_name] = argv
  if (!template_path || !stack_name) {
    throw new Error(
      "usage: authorization-deployment-guard.js <template> <stack-name>"
    )
  }
  const region = (env.AWS_REGION || "").trim()
  if (region === "") throw new Error("AWS_REGION is required")

  const template = JSON.parse(fs.readFileSync(template_path, "utf8"))
  const candidate = candidate_digest(template)
  const stack = describe_stack(stack_name, region)
  assert_ordinary_deployment(candidate, stack)
  process.stdout.write(
    stack === undefined
      ? "Authorization guard: initial stack creation accepted\n"
      : "Authorization guard: deployed and candidate digests match\n"
  )
}

if (require.main === module) {
  try {
    main()
  } catch (error) {
    process.stderr.write(
      (error instanceof Error ? error.message : String(error)) + "\n"
    )
    process.exitCode = 1
  }
}

module.exports = {
  assert_ordinary_deployment,
  candidate_digest,
  deployed_digest,
  main
}
