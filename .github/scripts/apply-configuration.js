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
 *   GARNET_LOAD_IMAGE          digest-pinned image    (optional, garnet only)
 *   GARNET_BROKER_PUBLIC_ORIGIN absolute HTTP(S) origin (optional, garnet only)
 *   GARNET_NOTIFICATION_DELIVERY_ALLOW_ORIGINS comma-separated exact HTTP(S) origins
 *   GARNET_CONTEXT_ALLOW_HOSTS comma-separated URL hosts, with optional ports
 *   GARNET_EVENTUAL_ENTITY_READS true | false          (optional, defaults to false)
 *   GARNET_ARCHITECTURE        concentrated | distributed
 *   GARNET_DEPLOYMENT_STRATEGY rolling | bluegreen   (optional, defaults to rolling)
 *   GARNET_REGION              AWS region            (optional, leaves file value)
 */

const fs = require('fs')
const path = require('path')
const { URL } = require('node:url')

const CONFIG_PATH = path.join(__dirname, '..', '..', 'configuration.ts')

const ARCHITECTURES = { concentrated: 'Concentrated', distributed: 'Distributed' }
const STRATEGIES = { rolling: 'Rolling', bluegreen: 'BlueGreen' }
const ENGINES = { scorpio: 'Scorpio', garnet: 'Garnet' }
const DIGEST_IMAGE = /^[^@\s]+@sha256:[0-9a-f]{64}$/

const optional = (env, name) => (env[name] || '').trim()

const exact_origin = (raw, name) => {
  if (raw === '') return ''
  let url
  try {
    url = new URL(raw)
  } catch {
    throw new Error(`${name} must be an absolute HTTP(S) origin`)
  }
  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    url.username !== '' ||
    url.password !== '' ||
    url.pathname !== '/' ||
    url.search !== '' ||
    url.hash !== '' ||
    url.hostname.includes('*')
  ) {
    throw new Error(
      `${name} accepts only an exact HTTP(S) origin without credentials, ` +
      'wildcards, paths, queries, or fragments'
    )
  }
  return url.origin
}

const comma_separated = (raw, name, normalize) => {
  if (raw === '') return ''
  const values = raw.split(',').map(value => value.trim())
  if (values.some(value => value === '')) {
    throw new Error(`${name} cannot contain an empty value`)
  }
  return [...new Set(values.map(value => normalize(value, name)))].join(',')
}

const context_host = (raw, name) => {
  if (
    raw.includes('://') ||
    raw.includes('/') ||
    raw.includes('?') ||
    raw.includes('#') ||
    raw.includes('@') ||
    raw.includes('*')
  ) {
    throw new Error(`${name} accepts only exact URL hosts with optional ports`)
  }
  let url
  try {
    url = new URL(`https://${raw}`)
  } catch {
    throw new Error(`${name} accepts only exact URL hosts with optional ports`)
  }
  if (url.host === '' || url.pathname !== '/') {
    throw new Error(`${name} accepts only exact URL hosts with optional ports`)
  }
  return url.host
}

const string_literal = value => JSON.stringify(value)

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
  const eventual_reads_key =
    (env.GARNET_EVENTUAL_ENTITY_READS || 'false').toLowerCase()
  const broker_image = optional(env, 'GARNET_BROKER_IMAGE')
  const load_image = optional(env, 'GARNET_LOAD_IMAGE')
  const public_origin = exact_origin(
    optional(env, 'GARNET_BROKER_PUBLIC_ORIGIN'),
    'GARNET_BROKER_PUBLIC_ORIGIN'
  )
  const notification_origins = comma_separated(
    optional(env, 'GARNET_NOTIFICATION_DELIVERY_ALLOW_ORIGINS'),
    'GARNET_NOTIFICATION_DELIVERY_ALLOW_ORIGINS',
    exact_origin
  )
  const context_hosts = comma_separated(
    optional(env, 'GARNET_CONTEXT_ALLOW_HOSTS'),
    'GARNET_CONTEXT_ALLOW_HOSTS',
    context_host
  )

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
  if (eventual_reads_key !== 'true' && eventual_reads_key !== 'false') {
    throw new Error(
      `GARNET_EVENTUAL_ENTITY_READS must be true or false, got '${env.GARNET_EVENTUAL_ENTITY_READS}'`
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
  if (engine == 'Garnet' && !DIGEST_IMAGE.test(broker_image)) {
    throw new Error(
      'GARNET_BROKER_IMAGE must be a digest-pinned image when GARNET_BROKER_ENGINE=garnet'
    )
  }
  if (engine != 'Garnet' && eventual_reads_key == 'true') {
    throw new Error(
      'GARNET_EVENTUAL_ENTITY_READS=true is available only with GARNET_BROKER_ENGINE=garnet'
    )
  }
  if (load_image !== '' && !DIGEST_IMAGE.test(load_image)) {
    throw new Error('GARNET_LOAD_IMAGE must be a digest-pinned image')
  }
  const garnet_only_settings = [
    ['GARNET_BROKER_IMAGE', broker_image],
    ['GARNET_LOAD_IMAGE', load_image],
    ['GARNET_BROKER_PUBLIC_ORIGIN', public_origin],
    [
      'GARNET_NOTIFICATION_DELIVERY_ALLOW_ORIGINS',
      notification_origins
    ],
    ['GARNET_CONTEXT_ALLOW_HOSTS', context_hosts]
  ]
  const configured_garnet_setting = garnet_only_settings.find(
    ([, value]) => value !== ''
  )
  if (engine != 'Garnet' && configured_garnet_setting !== undefined) {
    throw new Error(
      `${configured_garnet_setting[0]} is available only with ` +
      'GARNET_BROKER_ENGINE=garnet'
    )
  }

  let out = source
  out = replace_setting(out, /broker_engine: BROKER_ENGINE\.\w+/g, `broker_engine: BROKER_ENGINE.${engine}`, 'the broker_engine setting')
  out = replace_setting(out, /architecture: ARCHITECTURE\.\w+/g, `architecture: ARCHITECTURE.${architecture}`, 'the architecture setting')
  out = replace_setting(out, /deployment_strategy: DEPLOYMENT_STRATEGY\.\w+/g, `deployment_strategy: DEPLOYMENT_STRATEGY.${strategy}`, 'the deployment_strategy setting')
  out = replace_setting(
    out,
    /garnet_eventual_entity_reads: (?:true|false)/g,
    `garnet_eventual_entity_reads: ${eventual_reads_key}`,
    'the garnet_eventual_entity_reads setting'
  )

  if (engine == 'Garnet') {
    out = replace_setting(
      out,
      /garnet_broker_image: "[^"]*"/g,
      `garnet_broker_image: ${string_literal(broker_image)}`,
      'the garnet_broker_image setting'
    )
    out = replace_setting(
      out,
      /garnet_load_image: "[^"]*"/g,
      `garnet_load_image: ${string_literal(load_image)}`,
      'the garnet_load_image setting'
    )
    out = replace_setting(
      out,
      /garnet_broker_public_origin: "[^"]*"/g,
      `garnet_broker_public_origin: ${string_literal(public_origin)}`,
      'the garnet_broker_public_origin setting'
    )
    out = replace_setting(
      out,
      /garnet_notification_delivery_allow_origins: "[^"]*"/g,
      `garnet_notification_delivery_allow_origins: ${string_literal(notification_origins)}`,
      'the garnet_notification_delivery_allow_origins setting'
    )
    out = replace_setting(
      out,
      /garnet_context_allow_hosts: "[^"]*"/g,
      `garnet_context_allow_hosts: ${string_literal(context_hosts)}`,
      'the garnet_context_allow_hosts setting'
    )
  }

  if (env.GARNET_REGION) {
    if (!/^[a-z]{2}(-gov)?-[a-z]+-\d$/.test(env.GARNET_REGION)) {
      throw new Error(`GARNET_REGION does not look like an AWS region: '${env.GARNET_REGION}'`)
    }
    out = replace_setting(out, /aws_region: "[^"]*"/g, `aws_region: "${env.GARNET_REGION}"`, 'the aws_region setting')
  }

  return {
    source: out,
    architecture,
    strategy,
    engine,
    eventual_reads: eventual_reads_key == 'true',
    broker_image,
    load_image,
    public_origin,
    notification_origins,
    context_hosts
  }
}

const main = () => {
  const source = fs.readFileSync(CONFIG_PATH, 'utf8')
  const result = apply_configuration(source, process.env)
  fs.writeFileSync(CONFIG_PATH, result.source)
  console.log(`Configured Garnet: engine=${result.engine} architecture=${result.architecture} strategy=${result.strategy} eventual-reads=${result.eventual_reads}` +
    (result.engine == 'Garnet'
      ? ` public-origin=${result.public_origin === '' ? 'disabled' : 'configured'}` +
        ` notification-origins=${result.notification_origins === '' ? 0 : result.notification_origins.split(',').length}` +
        ` context-hosts=${result.context_hosts === '' ? 0 : result.context_hosts.split(',').length}`
      : '') +
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
