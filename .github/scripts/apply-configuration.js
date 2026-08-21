#!/usr/bin/env node
/**
 * Applies pipeline configuration to configuration.ts before synth.
 *
 * Garnet is configured by editing a TypeScript file rather than by environment
 * variables or CDK context, so the pipeline has to rewrite that file. Doing it in
 * a script instead of inline YAML means it can be unit tested and it fails loudly
 * on an unexpected value rather than silently deploying the default.
 *
 * Env:
 *   GARNET_ARCHITECTURE        concentrated | distributed
 *   GARNET_DEPLOYMENT_STRATEGY rolling | bluegreen   (optional, defaults to rolling)
 *   GARNET_REGION              AWS region            (optional, leaves file value)
 */

const fs = require('fs')
const path = require('path')

const CONFIG_PATH = path.join(__dirname, '..', '..', 'configuration.ts')

const ARCHITECTURES = { concentrated: 'Concentrated', distributed: 'Distributed' }
const STRATEGIES = { rolling: 'Rolling', bluegreen: 'BlueGreen' }

/**
 * Replaces exactly one assignment and verifies it changed, so a rename in
 * configuration.ts surfaces as a failed deploy rather than a wrong one.
 */
const replace_setting = (source, pattern, replacement, description) => {
  const matches = source.match(pattern)
  if (!matches) {
    throw new Error(
      `Could not find ${description} in configuration.ts. ` +
      `The pipeline rewrites this file before synth, so the pattern must be kept in step with it.`
    )
  }
  if (matches.length > 1) {
    throw new Error(`Found ${matches.length} occurrences of ${description}; expected exactly one.`)
  }
  return source.replace(pattern, replacement)
}

const apply_configuration = (source, env) => {
  const architecture_key = (env.GARNET_ARCHITECTURE || '').toLowerCase()
  const strategy_key = (env.GARNET_DEPLOYMENT_STRATEGY || 'rolling').toLowerCase()

  const architecture = ARCHITECTURES[architecture_key]
  if (!architecture) {
    throw new Error(
      `GARNET_ARCHITECTURE must be one of ${Object.keys(ARCHITECTURES).join(', ')}, got '${env.GARNET_ARCHITECTURE}'`
    )
  }

  const strategy = STRATEGIES[strategy_key]
  if (!strategy) {
    throw new Error(
      `GARNET_DEPLOYMENT_STRATEGY must be one of ${Object.keys(STRATEGIES).join(', ')}, got '${env.GARNET_DEPLOYMENT_STRATEGY}'`
    )
  }

  // Blue/green cannot shift the distributed architecture atomically. The construct
  // throws on this too, but failing here keeps the error in the deploy log where
  // whoever set the variable will actually read it.
  if (strategy == 'BlueGreen' && architecture == 'Distributed') {
    throw new Error(
      'GARNET_DEPLOYMENT_STRATEGY=bluegreen is not supported with the distributed architecture. ' +
      'Each broker service there is registered in multiple target groups, which native ECS ' +
      'blue/green cannot shift atomically. Use rolling. See DEPLOYMENT.md.'
    )
  }

  let out = source
  out = replace_setting(out, /architecture: ARCHITECTURE\.\w+/g, `architecture: ARCHITECTURE.${architecture}`, 'the architecture setting')
  out = replace_setting(out, /deployment_strategy: DEPLOYMENT_STRATEGY\.\w+/g, `deployment_strategy: DEPLOYMENT_STRATEGY.${strategy}`, 'the deployment_strategy setting')

  if (env.GARNET_REGION) {
    if (!/^[a-z]{2}(-gov)?-[a-z]+-\d$/.test(env.GARNET_REGION)) {
      throw new Error(`GARNET_REGION does not look like an AWS region: '${env.GARNET_REGION}'`)
    }
    out = replace_setting(out, /aws_region: "[^"]*"/g, `aws_region: "${env.GARNET_REGION}"`, 'the aws_region setting')
  }

  return { source: out, architecture, strategy }
}

const main = () => {
  const source = fs.readFileSync(CONFIG_PATH, 'utf8')
  const result = apply_configuration(source, process.env)
  fs.writeFileSync(CONFIG_PATH, result.source)
  console.log(`Configured Garnet: architecture=${result.architecture} strategy=${result.strategy}` +
    (process.env.GARNET_REGION ? ` region=${process.env.GARNET_REGION}` : ''))
}

if (require.main === module) {
  try {
    main()
  } catch (e) {
    console.error(`Configuration failed: ${e.message}`)
    process.exit(1)
  }
}

module.exports = { apply_configuration }
