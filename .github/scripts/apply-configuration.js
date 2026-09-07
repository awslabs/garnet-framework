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
 *   GARNET_BROKER_ENGINE       scorpio | garnet       (optional, defaults to scorpio)
 *   GARNET_BROKER_IMAGE        digest-pinned image    (required for garnet)
 *   GARNET_ARCHITECTURE        concentrated | distributed
 *   GARNET_DEPLOYMENT_STRATEGY rolling | bluegreen   (optional, defaults to rolling)
 *   GARNET_REGION              AWS region            (optional, leaves file value)
 */

const fs = require('fs')
const path = require('path')

const CONFIG_PATH = path.join(__dirname, '..', '..', 'configuration.ts')

const ARCHITECTURES = { concentrated: 'Concentrated', distributed: 'Distributed' }
const STRATEGIES = { rolling: 'Rolling', bluegreen: 'BlueGreen' }
const ENGINES = { scorpio: 'Scorpio', garnet: 'Garnet' }
const DIGEST_IMAGE = /^[^@\s]+@sha256:[0-9a-f]{64}$/

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
  const engine_key = (env.GARNET_BROKER_ENGINE || 'scorpio').toLowerCase()
  const architecture_key = (env.GARNET_ARCHITECTURE || '').toLowerCase()
  const strategy_key = (env.GARNET_DEPLOYMENT_STRATEGY || 'rolling').toLowerCase()

  const engine = ENGINES[engine_key]
  if (!engine) {
    throw new Error(
      `GARNET_BROKER_ENGINE must be one of ${Object.keys(ENGINES).join(', ')}, got '${env.GARNET_BROKER_ENGINE}'`
    )
  }

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
  if (engine == 'Garnet' && architecture != 'Distributed') {
    throw new Error(
      'GARNET_BROKER_ENGINE=garnet requires GARNET_ARCHITECTURE=distributed. ' +
      'Garnet scales API, routing, event, delivery and maintenance roles independently.'
    )
  }
  if (engine == 'Garnet' && strategy != 'Rolling') {
    throw new Error(
      'GARNET_BROKER_ENGINE=garnet currently requires GARNET_DEPLOYMENT_STRATEGY=rolling. ' +
      'The migration gate must complete before any service shifts to the new image.'
    )
  }
  if (engine == 'Garnet' && !DIGEST_IMAGE.test(env.GARNET_BROKER_IMAGE || '')) {
    throw new Error(
      'GARNET_BROKER_IMAGE must be a digest-pinned image when GARNET_BROKER_ENGINE=garnet'
    )
  }

  let out = source
  out = replace_setting(out, /broker_engine: BROKER_ENGINE\.\w+/g, `broker_engine: BROKER_ENGINE.${engine}`, 'the broker_engine setting')
  out = replace_setting(out, /architecture: ARCHITECTURE\.\w+/g, `architecture: ARCHITECTURE.${architecture}`, 'the architecture setting')
  out = replace_setting(out, /deployment_strategy: DEPLOYMENT_STRATEGY\.\w+/g, `deployment_strategy: DEPLOYMENT_STRATEGY.${strategy}`, 'the deployment_strategy setting')

  if (engine == 'Garnet') {
    out = replace_setting(
      out,
      /garnet_broker_image: "[^"]*"/g,
      `garnet_broker_image: "${env.GARNET_BROKER_IMAGE}"`,
      'the garnet_broker_image setting'
    )
  }

  if (env.GARNET_REGION) {
    if (!/^[a-z]{2}(-gov)?-[a-z]+-\d$/.test(env.GARNET_REGION)) {
      throw new Error(`GARNET_REGION does not look like an AWS region: '${env.GARNET_REGION}'`)
    }
    out = replace_setting(out, /aws_region: "[^"]*"/g, `aws_region: "${env.GARNET_REGION}"`, 'the aws_region setting')
  }

  return { source: out, architecture, strategy, engine }
}

const main = () => {
  const source = fs.readFileSync(CONFIG_PATH, 'utf8')
  const result = apply_configuration(source, process.env)
  fs.writeFileSync(CONFIG_PATH, result.source)
  console.log(`Configured Garnet: engine=${result.engine} architecture=${result.architecture} strategy=${result.strategy}` +
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
