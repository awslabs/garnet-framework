import { App, Stack } from "aws-cdk-lib"
import { Match, Template } from "aws-cdk-lib/assertions"
import { SubnetType, Vpc } from "aws-cdk-lib/aws-ec2"
import { CfnDeliveryStream } from "aws-cdk-lib/aws-kinesisfirehose"
import { deployment_params } from "../architecture"
import { GarnetBroker } from "../lib/stacks/garnet-broker/garnet-broker-stack"

const IMAGE =
  `public.ecr.aws/garnet/broker@sha256:${"a".repeat(64)}`
const LOAD_IMAGE =
  `public.ecr.aws/garnet/load@sha256:${"b".repeat(64)}`
const AUTHORIZATION = {
  oidc_issuer: "https://identity.example",
  oidc_audiences: "garnet-api",
  oidc_tenant_claim: "garnet_tenants",
  bootstrap_admin_subject: "admin-1",
  bootstrap_tenant: "default",
  authorization_policies: "[]",
  authorization_bindings: "[]"
}
const AUTHORIZATION_EXECUTORS = new Set([
  "/garnet-broker",
  "/garnet-matcher",
  "/garnet-notification-scheduler",
  "/garnet-delivery",
  "/garnet-subscription-reconciler"
])
const AUTHORIZATION_ENVIRONMENT = [
  "AUTH_MODE",
  "AUTHORIZATION_MODE",
  "AUTHORIZATION_POLICIES",
  "AUTHORIZATION_BINDINGS",
  "AUTHORIZATION_CONFIGURATION_DIGEST"
]

const create_vpc = (stack: Stack): Vpc =>
  new Vpc(stack, "Vpc", {
    maxAzs: 2,
    natGateways: 1,
    subnetConfiguration: [
      {
        name: "Public",
        subnetType: SubnetType.PUBLIC
      },
      {
        name: "Application",
        subnetType: SubnetType.PRIVATE_WITH_EGRESS
      },
      {
        name: "Database",
        subnetType: SubnetType.PRIVATE_ISOLATED
      }
    ]
  })

const synth_broker = (
  eventual_entity_reads = true,
  image = IMAGE
): Template => {
  const app = new App()
  const stack = new Stack(app, "TestStack", {
    env: {
      account: "111111111111",
      region: "eu-west-3"
    }
  })
  const vpc = create_vpc(stack)
  const stream = new CfnDeliveryStream(stack, "DeliveryStream", {
    deliveryStreamName: "garnet-test-stream"
  })
  const broker = new GarnetBroker(stack, "Broker", {
    vpc,
    delivery_stream: stream,
    image,
    load_image: LOAD_IMAGE,
    public_origin: "https://broker.example",
    notification_delivery_allow_origins: "https://callbacks.example",
    private_notification_origin:
      "https://private.example.execute-api.eu-west-3.amazonaws.com",
    context_allow_hosts: "uri.etsi.org",
    ...AUTHORIZATION,
    eventual_entity_reads,
    temporal_history_retention_days: 365,
    temporal_history_retention_max_gib: 500,
    temporal_history_retention_max_partitions: 12
  })
  return Template.fromStack(broker)
}

describe("Garnet Broker AWS runtime", () => {
  it("uses direct Aurora PostgreSQL without RDS Proxy", () => {
    const template = synth_broker()

    template.resourceCountIs("AWS::RDS::DBCluster", 1)
    template.resourceCountIs("AWS::RDS::DBInstance", 2)
    template.resourceCountIs("AWS::RDS::DBProxy", 0)
    template.hasResourceProperties("AWS::RDS::DBCluster", {
      Engine: "aurora-postgresql",
      EngineVersion: "18.4",
      DatabaseName: "garnet",
      DBClusterIdentifier: "garnet-framework-broker-aurora",
      BackupRetentionPeriod: 35,
      DeletionProtection: true,
      StorageType: "aurora",
      ServerlessV2ScalingConfiguration: {
        MinCapacity: 2,
        MaxCapacity: 128
      }
    })
    template.hasResourceProperties("AWS::RDS::DBClusterParameterGroup", {
      Parameters: {
        "rds.force_ssl": "1"
      }
    })
  })

  it("can remove the warm reader for a disposable writer-only deployment", () => {
    const original = deployment_params.database_reader_enabled
    deployment_params.database_reader_enabled = false
    try {
      const template = synth_broker(false)
      template.resourceCountIs("AWS::RDS::DBInstance", 1)
      expect(JSON.stringify(template.toJSON()))
        .not.toContain("AuroraReplicaLagMaximum")
    } finally {
      deployment_params.database_reader_enabled = original
    }
  })

  it("creates every long-lived role and task on Graviton ECS capacity", () => {
    const template = synth_broker()
    const task_definitions =
      template.findResources("AWS::ECS::TaskDefinition")

    const host_security_groups = template.findResources(
      "AWS::EC2::SecurityGroup",
      {
        Properties: {
          GroupDescription:
            "Egress-only security group for Garnet ECS hosts"
        }
      }
    )
    expect(Object.keys(host_security_groups)).toHaveLength(1)
    const host_security_group_id =
      Object.keys(host_security_groups)[0]
    const launch_templates = template.findResources(
      "AWS::EC2::LaunchTemplate"
    )
    expect(Object.values(launch_templates)).toHaveLength(2)
    for (const launch_template of Object.values(launch_templates) as any[]) {
      expect(
        launch_template.Properties.LaunchTemplateData.SecurityGroupIds
      ).toEqual([{
        "Fn::GetAtt": [host_security_group_id, "GroupId"]
      }])
    }

    expect(Object.keys(task_definitions)).toHaveLength(12)
    template.resourceCountIs("AWS::ECS::Service", 8)
    template.resourceCountIs("AWS::AutoScaling::AutoScalingGroup", 2)
    const entry_points: string[] = []
    for (const resource of Object.values(task_definitions) as any[]) {
      expect(resource.Properties.RequiresCompatibilities).toEqual(["EC2"])
      expect(resource.Properties.RuntimePlatform).toBeUndefined()
      const container = resource.Properties.ContainerDefinitions[0]
      const entry_point = container.EntryPoint[0]
      entry_points.push(entry_point)
      if (!entry_point.startsWith("/garnet-load")) {
        const environment = Object.fromEntries(
          (container.Environment ?? [])
            .map((entry: any) => [entry.Name, entry.Value])
        )
        expect(environment.AUTH_MODE).toBe(
          AUTHORIZATION_EXECUTORS.has(entry_point)
            ? "oidc+sigv4"
            : "none"
        )
      }
    }
    expect(entry_points.sort()).toEqual([
      "/garnet-broker",
      "/garnet-delivery",
      "/garnet-event-sink",
      "/garnet-federation",
      "/garnet-load",
      "/garnet-load-aggregate",
      "/garnet-maintenance",
      "/garnet-matcher",
      "/garnet-migrate",
      "/garnet-notification-scheduler",
      "/garnet-snapshot",
      "/garnet-subscription-reconciler"
    ].sort())
  })

  it("pins one byte-identical authorization bundle to every executor", () => {
    const template = synth_broker()
    const task_definitions =
      template.findResources("AWS::ECS::TaskDefinition")
    const environments = new Map<string, Record<string, unknown>>()

    for (const resource of Object.values(task_definitions) as any[]) {
      const container = resource.Properties.ContainerDefinitions[0]
      const entry_point = container.EntryPoint[0]
      if (!AUTHORIZATION_EXECUTORS.has(entry_point)) continue
      environments.set(entry_point, Object.fromEntries(
        container.Environment.map(
          (entry: any) => [entry.Name, entry.Value]
        )
      ))
    }

    expect(environments.size).toBe(AUTHORIZATION_EXECUTORS.size)
    const api = environments.get("/garnet-broker")!
    const expected = Object.fromEntries(
      AUTHORIZATION_ENVIRONMENT.map((name) => [name, api[name]])
    )
    for (const environment of environments.values()) {
      expect(Object.fromEntries(
        AUTHORIZATION_ENVIRONMENT.map(
          (name) => [name, environment[name]]
        )
      )).toEqual(expected)
    }
    expect(expected).toMatchObject({
      AUTH_MODE: "oidc+sigv4",
      AUTHORIZATION_MODE: "policy",
      AUTHORIZATION_POLICIES: "[]",
      AUTHORIZATION_CONFIGURATION_DIGEST:
        expect.stringMatching(/^sha256:[0-9a-f]{64}$/)
    })
    const bindings = JSON.stringify(
      expected.AUTHORIZATION_BINDINGS
    )
    expect(bindings).toContain(
      "garnet-framework-api-deployment-validation-role"
    )
    expect(bindings).toContain("managed-policy/TenantReadOnly")
  })

  it("keeps worker floors on demand and uses Spot only for scale-out", () => {
    const template = synth_broker()
    const services = Object.values(
      template.findResources("AWS::ECS::Service")
    ) as any[]
    const spot_services = services.filter(
      (service) =>
        service.Properties.CapacityProviderStrategy?.length === 2
    )

    expect(spot_services).toHaveLength(6)
    for (const service of spot_services) {
      expect(service.Properties.DesiredCount).toBe(1)
      expect(service.Properties.CapacityProviderStrategy[0])
        .toMatchObject({ Base: 1, Weight: 1 })
      expect(service.Properties.CapacityProviderStrategy[1])
        .toMatchObject({ Weight: 4 })
      expect(service.Properties.AvailabilityZoneRebalancing)
        .toBe("ENABLED")
    }
    for (const service of services) {
      expect(service.Properties.AvailabilityZoneRebalancing)
        .toBe("ENABLED")
    }
    const api = services.find(
      (service) => service.Properties.ServiceName === "garnet-api"
    )
    const federation = services.find(
      (service) => service.Properties.ServiceName ===
        "garnet-federation"
    )
    expect(api.Properties.CapacityProviderStrategy).toHaveLength(1)
    expect(federation.Properties.CapacityProviderStrategy).toHaveLength(1)
  })

  it("bounds Aurora Temporal history through scheduled maintenance", () => {
    const template = synth_broker()
    const task_definitions =
      template.findResources("AWS::ECS::TaskDefinition")
    const maintenance = (Object.values(task_definitions) as any[])
      .find((resource) =>
        resource.Properties.ContainerDefinitions[0].EntryPoint[0] ===
          "/garnet-maintenance"
      )
    const environment = Object.fromEntries(
      maintenance.Properties.ContainerDefinitions[0].Environment
        .map((entry: any) => [entry.Name, entry.Value])
    )

    expect(environment).toMatchObject({
      TEMPORAL_HISTORY_RETENTION_DAYS: "365",
      TEMPORAL_HISTORY_RETENTION_MAX_GIB: "500",
      TEMPORAL_HISTORY_RETENTION_MAX_PARTITIONS: "12"
    })
    template.hasResourceProperties("AWS::Events::Rule", {
      ScheduleExpression: "cron(0 3 * * ? *)",
      State: "ENABLED"
    })
  })

  it("provisions idle load tasks with private durable evidence", () => {
    const template = synth_broker()
    const task_definitions =
      template.findResources("AWS::ECS::TaskDefinition")
    const generator = (Object.values(task_definitions) as any[])
      .find((resource) =>
        resource.Properties.ContainerDefinitions[0].Name ===
          "garnet-load-generator"
      )
    const aggregate = (Object.values(task_definitions) as any[])
      .find((resource) =>
        resource.Properties.ContainerDefinitions[0].Name ===
          "garnet-load-aggregate"
      )

    expect(generator.Properties).toMatchObject({
      Cpu: "4096",
      Memory: "8192"
    })
    expect(aggregate.Properties).toMatchObject({
      Cpu: "1024",
      Memory: "2048"
    })
    const environment = Object.fromEntries(
      generator.Properties.ContainerDefinitions[0].Environment
        .map((entry: any) => [entry.Name, entry.Value])
    )
    expect(environment).toMatchObject({
      LOAD_DATABASE_NAME: "garnet",
      LOAD_DATABASE_SSL_MODE: "require",
      LOAD_ENVIRONMENT: "aws-ecs-internal",
      LOAD_GENERATOR_VCPUS: "4",
      GARNET_IMAGE: IMAGE
    })
    expect(environment).not.toHaveProperty("LOAD_HEADERS_JSON")
    expect(environment.LOAD_URL).toHaveProperty("Fn::Join")
    const secrets =
      generator.Properties.ContainerDefinitions[0].Secrets
        .map((entry: any) => entry.Name)
    expect(secrets.sort()).toEqual([
      "LOAD_DATABASE_USER",
      "LOAD_DATABASE_PASSWORD"
    ].sort())
    expect(environment).toMatchObject({
      LOAD_BROKER_AUTH_MODE: "sigv4",
      LOAD_TENANT: "default"
    })
    expect(environment.LOAD_BROKER_SIGV4_SERVER_ID)
      .toHaveProperty("Fn::Join")
    expect(environment.LOAD_STS_ENDPOINT)
      .toHaveProperty("Fn::Join")

    template.resourceCountIs("AWS::S3::Bucket", 1)
    template.hasResourceProperties("AWS::S3::Bucket", {
      BucketEncryption: {
        ServerSideEncryptionConfiguration: [{
          ServerSideEncryptionByDefault: {
            SSEAlgorithm: "AES256"
          }
        }]
      },
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true
      },
      VersioningConfiguration: {
        Status: "Enabled"
      },
      ObjectLockEnabled: true,
      ObjectLockConfiguration: {
        ObjectLockEnabled: "Enabled",
        Rule: {
          DefaultRetention: {
            Mode: "COMPLIANCE",
            Days: 90
          }
        }
      }
    })
    template.resourceCountIs("AWS::ECS::Service", 8)
  })

  it("keeps local traffic local and externalizes every scalable background role", () => {
    const template = synth_broker()
    const task_definitions =
      template.findResources("AWS::ECS::TaskDefinition")
    const api = (Object.values(task_definitions) as any[])
      .find((resource) =>
        resource.Properties.ContainerDefinitions[0].Name === "garnet-api"
      )
    const environment = Object.fromEntries(
      api.Properties.ContainerDefinitions[0].Environment
        .map((entry: any) => [entry.Name, entry.Value])
    )

    expect(environment).toMatchObject({
      AUTH_MODE: "oidc+sigv4",
      AUTHORIZATION_MODE: "policy",
      AUTH_OIDC_ISSUERS: "https://identity.example",
      AUTH_OIDC_AUDIENCES: "garnet-api",
      AUTH_OIDC_TENANT_CLAIM: "garnet_tenants",
      FEDERATION_DEFAULT_LOCAL: "true",
      FEDERATION_ROUTER_URL: "http://federation:8080",
      ENTITY_EVENT_TRANSPORT: "postgres",
      ENTITY_EVENT_MATCHER_MODE: "external",
      NOTIFICATION_DELIVERY_MODE: "external",
      PERIODIC_NOTIFICATION_MODE: "external",
      DISTRIBUTED_SUBSCRIPTION_RECONCILIATION_MODE: "external",
      SNAPSHOT_WORKERS: "0",
      BROKER_WORKERS: "2",
      DB_POOL_MAX_REQUIRED: "true",
      DBSSL: "require",
      DB_POOL_MAX: "16",
      READ_CONSISTENCY: "eventual",
      READ_DB_POOL_MAX: "8"
    })
    expect(environment.READ_DBHOST).toHaveProperty("Fn::GetAtt")
    const authorization_bindings =
      JSON.stringify(environment.AUTHORIZATION_BINDINGS)
    const sigv4_grants =
      JSON.stringify(environment.AUTH_SIGV4_TENANT_GRANTS)
    for (const role of [
      "garnet-framework-ingestion-update-broker-role",
      "garnet-framework-iot-thing-lifecycle-role",
      "garnet-framework-iot-presence-role",
      "garnet-framework-iot-group-membership-role",
      "garnet-framework-iot-group-lifecycle-role"
    ]) {
      expect(authorization_bindings).toContain(role)
      expect(sigv4_grants).toContain(role)
    }
    expect(authorization_bindings).toContain(
      "managed-policy/TenantEntityEditor"
    )
    expect(authorization_bindings).toContain(
      "garnet-framework-api-deployment-validation-role"
    )

    const snapshot = (Object.values(task_definitions) as any[])
      .find((resource) =>
        resource.Properties.ContainerDefinitions[0].Name ===
          "garnet-snapshot"
      )
    const snapshot_environment = Object.fromEntries(
      snapshot.Properties.ContainerDefinitions[0].Environment
        .map((entry: any) => [entry.Name, entry.Value])
    )
    expect(snapshot_environment).toMatchObject({
      FEDERATION_DEFAULT_LOCAL: "true",
      SNAPSHOT_QUERY_MAX_ATTEMPTS: "4",
      SNAPSHOT_QUERY_RETRY_BASE_MS: "250",
      SNAPSHOT_QUERY_RETRY_MAX_MS: "5000",
      SNAPSHOT_QUERY_TIMEOUT_MS: "30000",
      SNAPSHOT_BROKER_AUTH_MODE: "sigv4",
      SNAPSHOT_WORKERS: "2",
      WORKER_METRICS: "emf",
      WORKER_METRICS_NAMESPACE: "Garnet/Broker",
      WORKER_METRICS_SERVICE: "garnet-snapshot",
      WORKER_METRICS_INTERVAL_MS: "60000"
    })
    expect(snapshot_environment.SNAPSHOT_BROKER_URL)
      .toHaveProperty("Fn::Join")
    expect(snapshot_environment).not.toHaveProperty("READ_DBHOST")
    expect(snapshot_environment).not.toHaveProperty("BROKER_WORKERS")
    expect(snapshot_environment).not.toHaveProperty("PORT")
    expect(snapshot_environment).not.toHaveProperty(
      "FEDERATION_ROUTER_TOKEN"
    )
    const snapshot_secrets =
      snapshot.Properties.ContainerDefinitions[0].Secrets
        .map((entry: any) => entry.Name)
    expect(snapshot_secrets.sort()).toEqual([
      "DBPASS",
      "DBUSER"
    ])
    expect(
      snapshot.Properties.ContainerDefinitions[0].PortMappings
    ).toBeUndefined()

    const delivery = (Object.values(task_definitions) as any[])
      .find((resource) =>
        resource.Properties.ContainerDefinitions[0].Name ===
          "garnet-delivery"
      )
    const delivery_environment = Object.fromEntries(
      delivery.Properties.ContainerDefinitions[0].Environment
        .map((entry: any) => [entry.Name, entry.Value])
    )
    expect(delivery_environment).toMatchObject({
      NOTIFICATION_DELIVERY_ALLOW_ORIGINS:
        "https://callbacks.example," +
        "https://private.example.execute-api.eu-west-3.amazonaws.com",
      WORKER_METRICS: "emf",
      WORKER_METRICS_NAMESPACE: "Garnet/Broker",
      WORKER_METRICS_SERVICE: "garnet-delivery",
      WORKER_METRICS_INTERVAL_MS: "60000"
    })

    const matcher = (Object.values(task_definitions) as any[])
      .find((resource) =>
        resource.Properties.ContainerDefinitions[0].Name ===
          "garnet-matcher"
      )
    const matcher_environment = Object.fromEntries(
      matcher.Properties.ContainerDefinitions[0].Environment
        .map((entry: any) => [entry.Name, entry.Value])
    )
    expect(matcher_environment).toMatchObject({
      ENTITY_EVENT_TRANSPORT: "postgres",
      ENTITY_EVENT_POSTGRES_CLAIM_BATCH: "64",
      ENTITY_EVENT_POSTGRES_LEASE_MS: "60000",
      ENTITY_EVENT_POSTGRES_HEARTBEAT_MS: "5000",
      ENTITY_EVENT_POSTGRES_WORKER_STALE_MS: "15000",
      ENTITY_EVENT_POSTGRES_IDLE_MAX_MS: "500",
      ENTITY_EVENT_POSTGRES_MAX_ATTEMPTS: "20",
      ENTITY_EVENT_SINKS: "garnet-lake",
      WORKER_METRICS: "emf",
      WORKER_METRICS_NAMESPACE: "Garnet/Broker",
      WORKER_METRICS_SERVICE: "garnet-matcher",
      WORKER_METRICS_INTERVAL_MS: "60000"
    })
  })

  it("scales delivery from bounded worker saturation rather than CPU alone", () => {
    const template = synth_broker()

    template.hasResourceProperties(
      "AWS::ApplicationAutoScaling::ScalingPolicy",
      {
        PolicyType: "TargetTrackingScaling",
        TargetTrackingScalingPolicyConfiguration: {
          CustomizedMetricSpecification: {
            Dimensions: [{
              Name: "Service",
              Value: "garnet-delivery"
            }],
            MetricName: "WorkerUtilizationMax",
            Namespace: "Garnet/Broker",
            Statistic: "Average"
          },
          ScaleInCooldown: 180,
          ScaleOutCooldown: 30,
          TargetValue: 70
        }
      }
    )
  })

  it("scales snapshot materialization from occupied worker slots", () => {
    const template = synth_broker()

    template.hasResourceProperties(
      "AWS::ApplicationAutoScaling::ScalingPolicy",
      {
        PolicyType: "TargetTrackingScaling",
        TargetTrackingScalingPolicyConfiguration: {
          CustomizedMetricSpecification: {
            Dimensions: [{
              Name: "Service",
              Value: "garnet-snapshot"
            }],
            MetricName: "WorkerUtilizationMax",
            Namespace: "Garnet/Broker",
            Statistic: "Average"
          },
          ScaleInCooldown: 180,
          ScaleOutCooldown: 30,
          TargetValue: 70
        }
      }
    )
  })

  it("scales the API on requests per active target per minute", () => {
    const template = synth_broker()

    template.hasResourceProperties(
      "AWS::ApplicationAutoScaling::ScalingPolicy",
      {
        PolicyType: "TargetTrackingScaling",
        TargetTrackingScalingPolicyConfiguration: Match.objectLike({
          CustomizedMetricSpecification: Match.objectLike({
            Metrics: Match.arrayWith([
              Match.objectLike({
                Expression:
                  "FILL(production_requests_per_target, 0) + " +
                  "FILL(alternate_requests_per_target, 0)"
              }),
              Match.objectLike({
                MetricStat: {
                  Metric: Match.objectLike({
                    MetricName: "RequestCountPerTarget",
                    Namespace: "AWS/ApplicationELB"
                  }),
                  Stat: "Sum"
                },
                ReturnData: false
              })
            ])
          }),
          ScaleInCooldown: 180,
          ScaleOutCooldown: 30,
          TargetValue: 60000
        })
      }
    )
    const scalableTargets = Object.values(
      template.findResources(
        "AWS::ApplicationAutoScaling::ScalableTarget"
      )
    ) as any[]
    const apiTarget = scalableTargets.find((resource) =>
      resource.Properties.MaxCapacity === 64
    )
    expect(apiTarget).toBeDefined()
    expect(apiTarget.Properties).toMatchObject({
      MinCapacity: 2,
      MaxCapacity: 64
    })
  })

  it("keeps eventual Entity reads opt-in", () => {
    const template = synth_broker(false)
    const task_definitions =
      template.findResources("AWS::ECS::TaskDefinition")
    const api = (Object.values(task_definitions) as any[])
      .find((resource) =>
        resource.Properties.ContainerDefinitions[0].Name === "garnet-api"
      )
    const environment = Object.fromEntries(
      api.Properties.ContainerDefinitions[0].Environment
        .map((entry: any) => [entry.Name, entry.Value])
    )

    expect(environment).not.toHaveProperty("READ_DBHOST")
    expect(environment).not.toHaveProperty("READ_CONSISTENCY")
    expect(environment).not.toHaveProperty("READ_DB_POOL_MAX")
  })

  it("scales direct matchers by independent PostgreSQL partitions", () => {
    const template = synth_broker()

    template.resourceCountIs("AWS::SQS::Queue", 0)
    const rendered = JSON.stringify(template.toJSON())
    expect(rendered).not.toContain('"sqs:*"')
    expect(rendered).not.toContain('"sns:*"')
    expect(rendered).not.toContain("AWS::SNS::Topic")
    template.hasResourceProperties(
      "AWS::ApplicationAutoScaling::ScalingPolicy",
      {
        PolicyType: "TargetTrackingScaling",
        TargetTrackingScalingPolicyConfiguration: {
          CustomizedMetricSpecification: {
            Metrics: Match.arrayWith([
              Match.objectLike({
                Expression:
                  "IF(workers > 0, pending / workers, pending)",
                ReturnData: true
              }),
              Match.objectLike({
                MetricStat: {
                  Metric: Match.objectLike({
                    MetricName: "EntityEventPendingPartitions",
                    Namespace: "Garnet/Broker"
                  }),
                  Stat: "Average"
                },
                ReturnData: false
              }),
              Match.objectLike({
                MetricStat: {
                  Metric: Match.objectLike({
                    MetricName: "EntityEventMatcherWorkers",
                    Namespace: "Garnet/Broker"
                  }),
                  Stat: "Average"
                },
                ReturnData: false
              })
            ])
          },
          ScaleInCooldown: 180,
          ScaleOutCooldown: 30,
          TargetValue: 4
        }
      }
    )
    const scalable_targets = Object.values(
      template.findResources(
        "AWS::ApplicationAutoScaling::ScalableTarget"
      )
    ) as any[]
    expect(
      scalable_targets.some((resource) =>
        resource.Properties.MinCapacity === 1 &&
        resource.Properties.MaxCapacity === 16
      )
    ).toBe(true)
  })

  it("uses one TLS single-shard Valkey group for replica-safe federation state", () => {
    const template = synth_broker()

    template.resourceCountIs(
      "AWS::ElastiCache::ReplicationGroup",
      1
    )
    template.resourceCountIs("AWS::ElastiCache::ServerlessCache", 0)
    template.hasResourceProperties(
      "AWS::ElastiCache::ReplicationGroup",
      {
        ReplicationGroupId: "garnet-framework-federation-state",
        Engine: "valkey",
        EngineVersion: "8.2",
        CacheNodeType: "cache.t4g.small",
        ClusterMode: "disabled",
        NumCacheClusters: 2,
        AutomaticFailoverEnabled: true,
        MultiAZEnabled: true,
        AtRestEncryptionEnabled: true,
        TransitEncryptionEnabled: true,
        TransitEncryptionMode: "required",
        SnapshotRetentionLimit: 0
      }
    )
    template.hasResourceProperties(
      "AWS::EC2::SecurityGroupIngress",
      {
        Description: "Garnet federation cache and cooldown state",
        FromPort: 6379,
        IpProtocol: "tcp",
        ToPort: 6379
      }
    )

    const task_definitions =
      template.findResources("AWS::ECS::TaskDefinition")
    const api = (Object.values(task_definitions) as any[])
      .find((resource) =>
        resource.Properties.ContainerDefinitions[0].Name === "garnet-api"
      )
    const container = api.Properties.ContainerDefinitions[0]
    const environment = Object.fromEntries(
      container.Environment.map(
        (entry: any) => [entry.Name, entry.Value]
      )
    )
    expect(environment).toMatchObject({
      FEDERATION_STATE_PORT: "6379",
      FEDERATION_STATE_TLS: "true",
      FEDERATION_STATE_PREFIX: "garnet:federation:v1"
    })
    expect(environment.FEDERATION_STATE_HOST).toHaveProperty("Fn::GetAtt")
    expect(
      container.Secrets.some(
        (secret: any) =>
          secret.Name === "FEDERATION_STATE_PASSWORD"
      )
    ).toBe(true)
    expect(JSON.stringify(template.toJSON()))
      .toContain("resolve:secretsmanager")
  })

  it("gates every service on the one-shot migration resource", () => {
    const template = synth_broker()
    const custom_resources =
      template.findResources("AWS::CloudFormation::CustomResource")
    expect(Object.keys(custom_resources)).toHaveLength(1)
    const [migration_resource_id] = Object.keys(custom_resources)
    expect(
      custom_resources[migration_resource_id!].Properties
    ).toMatchObject({
      SchemaCompatibility: "unchanged"
    })
    const [writer_resource_id] = Object.keys(
      template.findResources("AWS::RDS::DBInstance")
    ).filter((logical_id) =>
      logical_id.toLowerCase().includes("writer")
    )
    expect(writer_resource_id).toBeDefined()
    expect(custom_resources[migration_resource_id!].DependsOn)
      .toEqual(expect.arrayContaining([writer_resource_id]))

    const services = template.findResources("AWS::ECS::Service")
    for (const service of Object.values(services) as any[]) {
      expect(service.DependsOn).toEqual(
        expect.arrayContaining([migration_resource_id])
      )
      const deployment =
        service.Properties.DeploymentConfiguration
      if (service.Properties.ServiceName === "garnet-api") {
        expect(deployment.Strategy).toBe("BLUE_GREEN")
        expect(deployment.DeploymentCircuitBreaker).toBeUndefined()
      } else {
        expect(deployment.DeploymentCircuitBreaker)
          .toEqual({ Enable: true, Rollback: true })
      }
    }

    const functions = Object.values(
      template.findResources("AWS::Lambda::Function")
    ) as any[]
    const completion_handler = functions.find((resource) => {
      const variables =
        resource.Properties.Environment?.Variables ?? {}
      return (
        variables.CLUSTER_ARN !== undefined &&
        variables.TASK_DEFINITION_ARN === undefined &&
        variables.CONTAINER_NAME === "MigrationContainer"
      )
    })
    expect(completion_handler).toBeDefined()
  })

  it("health-checks the public API through the production path", () => {
    const template = synth_broker()

    template.hasResourceProperties(
      "AWS::ElasticLoadBalancingV2::Listener",
      {
        Port: 80,
        Protocol: "HTTP",
        DefaultActions: [{
          Type: "fixed-response"
        }]
      }
    )
    template.hasResourceProperties(
      "AWS::ElasticLoadBalancingV2::ListenerRule",
      {
        Actions: [{
          Type: "forward",
          TargetGroupArn: Match.anyValue()
        }],
        Conditions: [{
          Field: "path-pattern",
          PathPatternConfig: {
            Values: ["/*"]
          }
        }]
      }
    )
    template.hasResourceProperties(
      "AWS::ElasticLoadBalancingV2::TargetGroup",
      {
        HealthCheckPath: "/health",
        HealthCheckPort: "8080",
        Matcher: {
          HttpCode: "200"
        },
        Port: 8080,
        Protocol: "HTTP"
      }
    )
  })

  it("rejects mutable or unpinned images", () => {
    const app = new App()
    const stack = new Stack(app, "InvalidImageStack")
    const vpc = create_vpc(stack)
    const stream = new CfnDeliveryStream(stack, "Stream", {
      deliveryStreamName: "garnet-test-stream"
    })

    expect(() => new GarnetBroker(stack, "Broker", {
      vpc,
      delivery_stream: stream,
      image: "public.ecr.aws/garnet/broker:latest",
      load_image: "",
      public_origin: "",
      notification_delivery_allow_origins: "",
      private_notification_origin:
        "https://private.example.execute-api.eu-west-3.amazonaws.com",
      context_allow_hosts: "",
      ...AUTHORIZATION,
      eventual_entity_reads: false,
      temporal_history_retention_days: 365,
      temporal_history_retention_max_gib: 500,
      temporal_history_retention_max_partitions: 12
    })).toThrow(/digest-pinned/)
  })

  it("grants task execution roles least-privilege private ECR pull access", () => {
    const private_image =
      `111111111111.dkr.ecr.us-east-1.amazonaws.com/garnet-broker@sha256:${
        "c".repeat(64)
      }`
    const template = synth_broker(false, private_image)
    const rendered = JSON.stringify(template.toJSON())

    expect(rendered).toContain(private_image)
    expect(rendered).toContain(
      "arn:aws:ecr:us-east-1:111111111111:repository/garnet-broker"
    )
    expect(rendered).toContain("ecr:GetAuthorizationToken")
    expect(rendered).toContain("ecr:BatchGetImage")
    expect(rendered).toContain("ecr:GetDownloadUrlForLayer")
  })

  it("rejects a mutable load image without affecting normal deployments", () => {
    const app = new App()
    const stack = new Stack(app, "InvalidLoadImageStack")
    const vpc = create_vpc(stack)
    const stream = new CfnDeliveryStream(stack, "Stream", {
      deliveryStreamName: "garnet-test-stream"
    })

    expect(() => new GarnetBroker(stack, "Broker", {
      vpc,
      delivery_stream: stream,
      image: IMAGE,
      load_image: "public.ecr.aws/garnet/load:latest",
      public_origin: "",
      notification_delivery_allow_origins: "",
      private_notification_origin:
        "https://private.example.execute-api.eu-west-3.amazonaws.com",
      context_allow_hosts: "",
      ...AUTHORIZATION,
      eventual_entity_reads: false,
      temporal_history_retention_days: 365,
      temporal_history_retention_max_gib: 500,
      temporal_history_retention_max_partitions: 12
    })).toThrow(/load image must be immutable and digest-pinned/)
  })
})
