#!/usr/bin/env node

const fs = require('fs')
const path = require('path')
const { URL } = require('node:url')

const CONFIG_PATH = path.join(__dirname, '..', '..', 'configuration.ts')
const DIGEST_IMAGE = /^[^@\s]+@sha256:[0-9a-f]{64}$/
const STRATEGIES = new Set(['rolling', 'bluegreen'])
const SCHEMA_COMPATIBILITIES = new Set([
  'unchanged',
  'backward-compatible'
])

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
    !['http:', 'https:'].includes(url.protocol) ||
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

const context_host = (raw, name) => {
  if (
    raw.includes('://') ||
    /[/@*?#]/.test(raw)
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

const comma_separated = (raw, name, normalize) => {
  if (raw === '') return ''
  const values = raw.split(',').map(value => value.trim())
  if (values.some(value => value === '')) {
    throw new Error(`${name} cannot contain an empty value`)
  }
  return [...new Set(values.map(value => normalize(value, name)))].join(',')
}

const replace_setting = (source, pattern, replacement, description) => {
  const matches = source.match(pattern)
  if (!matches) {
    throw new Error(`Could not find ${description} in configuration.ts`)
  }
  if (matches.length !== 1) {
    throw new Error(
      `Found ${matches.length} occurrences of ${description}; expected one`
    )
  }
  return source.replace(pattern, replacement)
}

const boolean_setting = (env, name, fallback) => {
  const raw = optional(env, name).toLowerCase()
  if (raw === '') return fallback
  if (raw === 'true') return true
  if (raw === 'false') return false
  throw new Error(`${name} must be true or false`)
}

const integer_setting = (env, name, fallback, minimum, maximum) => {
  const raw = optional(env, name)
  if (raw === '') return fallback
  if (!/^\d+$/.test(raw)) {
    throw new Error(`${name} must be an integer`)
  }
  const value = Number(raw)
  if (value < minimum || value > maximum) {
    throw new Error(
      `${name} must be between ${minimum} and ${maximum}`
    )
  }
  return value
}

const tenant_setting = (env, name, fallback) => {
  const value = optional(env, name) || fallback
  if (
    value.length > 255 ||
    /[\0\r\n"]/.test(value)
  ) {
    throw new Error(`${name} must be a safe tenant header value`)
  }
  return value
}

const apply_configuration = (source, env) => {
  const broker_image = optional(env, 'GARNET_BROKER_IMAGE')
  if (!DIGEST_IMAGE.test(broker_image)) {
    throw new Error('GARNET_BROKER_IMAGE must be a digest-pinned image')
  }
  const load_image = optional(env, 'GARNET_LOAD_IMAGE')
  if (load_image !== '' && !DIGEST_IMAGE.test(load_image)) {
    throw new Error('GARNET_LOAD_IMAGE must be a digest-pinned image')
  }
  const strategy =
    (optional(env, 'GARNET_DEPLOYMENT_STRATEGY') || 'rolling')
      .toLowerCase()
  if (!STRATEGIES.has(strategy)) {
    throw new Error(
      'GARNET_DEPLOYMENT_STRATEGY must be rolling or bluegreen'
    )
  }
  const schema_compatibility =
    optional(env, 'GARNET_SCHEMA_COMPATIBILITY').toLowerCase()
  if (!SCHEMA_COMPATIBILITIES.has(schema_compatibility)) {
    throw new Error(
      'GARNET_SCHEMA_COMPATIBILITY must be explicitly set to ' +
        'unchanged or backward-compatible; writer-drain migrations ' +
        'require a separate maintenance deployment'
    )
  }
  const eventual_reads = boolean_setting(
    env,
    'GARNET_EVENTUAL_ENTITY_READS',
    false
  )
  const database_deletion_protection = boolean_setting(
    env,
    'GARNET_DATABASE_DELETION_PROTECTION',
    true
  )
  const nat_gateway_count = integer_setting(
    env,
    'GARNET_NAT_GATEWAY_COUNT',
    2,
    1,
    2
  )
  const backup_retention_days = integer_setting(
    env,
    'GARNET_DATABASE_BACKUP_RETENTION_DAYS',
    35,
    1,
    35
  )
  const bootstrap_tenant = tenant_setting(
    env,
    'GARNET_BOOTSTRAP_TENANT',
    'default'
  )
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

  let out = source
  const strings = [
    ['garnet_broker_image', broker_image],
    ['garnet_load_image', load_image],
    ['garnet_broker_public_origin', public_origin],
    [
      'garnet_notification_delivery_allow_origins',
      notification_origins
    ],
    ['garnet_context_allow_hosts', context_hosts],
    ['garnet_bootstrap_tenant', bootstrap_tenant]
  ]
  for (const [name, value] of strings) {
    out = replace_setting(
      out,
      new RegExp(`${name}: "[^"]*"`),
      `${name}: ${JSON.stringify(value)}`,
      name
    )
  }
  out = replace_setting(
    out,
    /garnet_schema_compatibility: "(?:unchanged|backward-compatible)"/,
    `garnet_schema_compatibility: "${schema_compatibility}"`,
    'garnet_schema_compatibility'
  )
  out = replace_setting(
    out,
    /garnet_eventual_entity_reads: (?:true|false)/,
    `garnet_eventual_entity_reads: ${eventual_reads}`,
    'garnet_eventual_entity_reads'
  )
  out = replace_setting(
    out,
    /deployment_strategy: "(?:rolling|bluegreen)"/,
    `deployment_strategy: "${strategy}"`,
    'deployment_strategy'
  )
  out = replace_setting(
    out,
    /nat_gateway_count: [12] as 1 \| 2/,
    `nat_gateway_count: ${nat_gateway_count} as 1 | 2`,
    'nat_gateway_count'
  )
  out = replace_setting(
    out,
    /database_deletion_protection: (?:true|false)/,
    `database_deletion_protection: ${
      database_deletion_protection
    }`,
    'database_deletion_protection'
  )
  out = replace_setting(
    out,
    /database_backup_retention_days: \d+/,
    `database_backup_retention_days: ${backup_retention_days}`,
    'database_backup_retention_days'
  )
  if (env.GARNET_REGION) {
    if (!/^[a-z]{2}(-gov)?-[a-z]+-\d$/.test(env.GARNET_REGION)) {
      throw new Error(
        `GARNET_REGION does not look like an AWS region: ` +
        `'${env.GARNET_REGION}'`
      )
    }
    out = replace_setting(
      out,
      /aws_region: "[^"]*"/,
      `aws_region: "${env.GARNET_REGION}"`,
      'aws_region'
    )
  }
  return {
    source: out,
    broker_image,
    load_image,
    public_origin,
    notification_origins,
    context_hosts,
    eventual_reads,
    bootstrap_tenant,
    nat_gateway_count,
    database_deletion_protection,
    backup_retention_days,
    strategy,
    schema_compatibility
  }
}

const main = () => {
  const source = fs.readFileSync(CONFIG_PATH, 'utf8')
  const result = apply_configuration(source, process.env)
  fs.writeFileSync(CONFIG_PATH, result.source)
  console.log(
    `Configured Garnet: strategy=${result.strategy}` +
    ` schema=${result.schema_compatibility}` +
    ` eventual-reads=${result.eventual_reads}` +
    ` tenant=${result.bootstrap_tenant}` +
    ` nat-gateways=${result.nat_gateway_count}` +
    ` deletion-protection=${result.database_deletion_protection}` +
    ` backup-days=${result.backup_retention_days}` +
    ` public-origin=${result.public_origin === '' ? 'disabled' : 'configured'}` +
    ` notification-origins=${
      result.notification_origins === ''
        ? 0
        : result.notification_origins.split(',').length
    }` +
    ` context-hosts=${
      result.context_hosts === ''
        ? 0
        : result.context_hosts.split(',').length
    }`
  )
}

if (require.main === module) {
  try {
    main()
  } catch (error) {
    console.error(`Configuration failed: ${error.message}`)
    process.exit(1)
  }
}

module.exports = {
  apply_configuration,
  main
}
