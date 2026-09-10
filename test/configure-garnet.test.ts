import * as fs from "fs"
import * as path from "path"

const { apply_configuration } = require(
  "../.github/scripts/configure-garnet.js"
)
const source = fs.readFileSync(
  path.join(__dirname, "..", "configuration.ts"),
  "utf8"
)
const image =
  `public.ecr.aws/garnet/broker@sha256:${"a".repeat(64)}`
const deploymentEnvironment = (
  overrides: Record<string, string> = {}
): Record<string, string> => ({
  GARNET_BROKER_IMAGE: image,
  GARNET_SCHEMA_COMPATIBILITY: "unchanged",
  ...overrides
})

describe("Garnet-only deployment configuration", () => {
  it("configures immutable images, networking, reads and blue/green", () => {
    const load =
      `public.ecr.aws/garnet/load@sha256:${"b".repeat(64)}`
    const result = apply_configuration(source, deploymentEnvironment({
      GARNET_SCHEMA_COMPATIBILITY: "backward-compatible",
      GARNET_LOAD_IMAGE: load,
      GARNET_BROKER_PUBLIC_ORIGIN: " HTTPS://Broker.Example:443 ",
      GARNET_NOTIFICATION_DELIVERY_ALLOW_ORIGINS:
        "https://hooks.example,http://private.example:8080",
      GARNET_CONTEXT_ALLOW_HOSTS:
        "URI.ETSI.ORG,contexts.example:8443,uri.etsi.org",
      GARNET_EVENTUAL_ENTITY_READS: "true",
      GARNET_BOOTSTRAP_TENANT: "factory-a",
      GARNET_NAT_GATEWAY_COUNT: "1",
      GARNET_DATABASE_DELETION_PROTECTION: "false",
      GARNET_DATABASE_BACKUP_RETENTION_DAYS: "7",
      GARNET_DEPLOYMENT_STRATEGY: "bluegreen",
      GARNET_REGION: "eu-west-3"
    }))

    expect(result).toMatchObject({
      broker_image: image,
      load_image: load,
      public_origin: "https://broker.example",
      notification_origins:
        "https://hooks.example,http://private.example:8080",
      context_hosts: "uri.etsi.org,contexts.example:8443",
      eventual_reads: true,
      bootstrap_tenant: "factory-a",
      nat_gateway_count: 1,
      database_deletion_protection: false,
      backup_retention_days: 7,
      strategy: "bluegreen",
      schema_compatibility: "backward-compatible"
    })
    expect(result.source).toContain(`garnet_broker_image: "${image}"`)
    expect(result.source).toContain('deployment_strategy: "bluegreen"')
    expect(result.source).toContain(
      'garnet_schema_compatibility: "backward-compatible"'
    )
    expect(result.source).toContain(
      "garnet_eventual_entity_reads: true"
    )
    expect(result.source).toContain('aws_region: "eu-west-3"')
    expect(result.source).toContain(
      'garnet_bootstrap_tenant: "factory-a"'
    )
    expect(result.source).toContain(
      "nat_gateway_count: 1 as 1 | 2"
    )
    expect(result.source).toContain(
      "database_deletion_protection: false"
    )
    expect(result.source).toContain(
      "database_backup_retention_days: 7"
    )
    expect(result.source).not.toContain("BROKER_ENGINE")
  })

  it("clears optional settings and defaults to rolling consistency", () => {
    const configured = source
      .replace(
        'garnet_load_image: ""',
        `garnet_load_image: "public.ecr.aws/garnet/load@sha256:${
          "b".repeat(64)
        }"`
      )
      .replace(
        'garnet_broker_public_origin: ""',
        'garnet_broker_public_origin: "https://old.example"'
      )
    const result = apply_configuration(
      configured,
      deploymentEnvironment()
    )

    expect(result.strategy).toBe("rolling")
    expect(result.schema_compatibility).toBe("unchanged")
    expect(result.eventual_reads).toBe(false)
    expect(result.bootstrap_tenant).toBe("default")
    expect(result.nat_gateway_count).toBe(2)
    expect(result.database_deletion_protection).toBe(true)
    expect(result.backup_retention_days).toBe(35)
    expect(result.source).toContain('garnet_load_image: ""')
    expect(result.source).toContain(
      'garnet_broker_public_origin: ""'
    )
  })

  it("rejects mutable images and malformed environment controls", () => {
    expect(() => apply_configuration(source, {
      ...deploymentEnvironment(),
      GARNET_BROKER_IMAGE: "public.ecr.aws/garnet/broker:latest"
    })).toThrow(/digest-pinned/)

    for (const value of ["canary", "other"]) {
      expect(() => apply_configuration(source, deploymentEnvironment({
        GARNET_DEPLOYMENT_STRATEGY: value
      }))).toThrow(/rolling or bluegreen/)
    }
    expect(() => apply_configuration(source, deploymentEnvironment({
      GARNET_EVENTUAL_ENTITY_READS: "sometimes"
    }))).toThrow(/true or false/)
    expect(() => apply_configuration(source, deploymentEnvironment({
      GARNET_BROKER_PUBLIC_ORIGIN: "https://broker.example/path"
    }))).toThrow(/exact HTTP/)
    expect(() => apply_configuration(source, deploymentEnvironment({
      GARNET_CONTEXT_ALLOW_HOSTS: "*.example"
    }))).toThrow(/exact URL hosts/)
    expect(() => apply_configuration(source, deploymentEnvironment({
      GARNET_NAT_GATEWAY_COUNT: "3"
    }))).toThrow(/between 1 and 2/)
    expect(() => apply_configuration(source, deploymentEnvironment({
      GARNET_DATABASE_BACKUP_RETENTION_DAYS: "0"
    }))).toThrow(/between 1 and 35/)
    expect(() => apply_configuration(source, deploymentEnvironment({
      GARNET_BOOTSTRAP_TENANT: "unsafe\nvalue"
    }))).toThrow(/safe tenant/)
    expect(() => apply_configuration(source, deploymentEnvironment({
      GARNET_SCHEMA_COMPATIBILITY: "writer-drain"
    }))).toThrow(/maintenance deployment/)
    expect(() => apply_configuration(source, {
      GARNET_BROKER_IMAGE: image
    })).toThrow(/explicitly set/)
  })

  it("fails loudly when the configuration contract changes", () => {
    const renamed = source.replace(
      "garnet_broker_image:",
      "broker_image:"
    )
    expect(() => apply_configuration(
      renamed,
      deploymentEnvironment()
    )).toThrow(/Could not find garnet_broker_image/)
  })
})
