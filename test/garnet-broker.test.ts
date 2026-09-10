import { App, Stack } from "aws-cdk-lib"
import { Match, Template } from "aws-cdk-lib/assertions"
import { SubnetType, Vpc } from "aws-cdk-lib/aws-ec2"
import { CfnDeliveryStream } from "aws-cdk-lib/aws-kinesisfirehose"
import { GarnetBroker } from "../lib/stacks/garnet-broker/garnet-broker-stack"

const IMAGE =
  `public.ecr.aws/garnet/broker@sha256:${"a".repeat(64)}`
const LOAD_IMAGE =
  `public.ecr.aws/garnet/load@sha256:${"b".repeat(64)}`

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
  eventual_entity_reads = true
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
    image: IMAGE,
    load_image: LOAD_IMAGE,
    public_origin: "https://broker.example",
    notification_delivery_allow_origins: "https://callbacks.example",
    private_notification_origin:
      "https://private.example.execute-api.eu-west-3.amazonaws.com",
    context_allow_hosts: "uri.etsi.org",
    eventual_entity_reads
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
      EngineVersion: "16.11",
      DatabaseName: "garnet",
      DBClusterIdentifier: "garnet-framework-broker-aurora",
      BackupRetentionPeriod: 35,
      DeletionProtection: true,
      ServerlessV2ScalingConfiguration: {
        MinCapacity: 2,
        MaxCapacity: 256
      }
    })
    template.hasResourceProperties("AWS::RDS::DBClusterParameterGroup", {
      Parameters: {
        "rds.force_ssl": "1"
      }
    })
  })

  it("creates every long-lived role and on-demand task on ARM64", () => {
    const template = synth_broker()
    const task_definitions =
      template.findResources("AWS::ECS::TaskDefinition")

    expect(Object.keys(task_definitions)).toHaveLength(13)
    template.resourceCountIs("AWS::ECS::Service", 9)
    const entry_points: string[] = []
    for (const resource of Object.values(task_definitions) as any[]) {
      expect(resource.Properties.RuntimePlatform).toEqual({
        CpuArchitecture: "ARM64",
        OperatingSystemFamily: "LINUX"
      })
      entry_points.push(
        resource.Properties.ContainerDefinitions[0].EntryPoint[0]
      )
    }
    expect(entry_points.sort()).toEqual([
      "/garnet-broker",
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
      "/garnet-relay",
      "/garnet-subscription-reconciler"
    ].sort())
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
    expect(secrets).toEqual(expect.arrayContaining([
      "LOAD_DATABASE_USER",
      "LOAD_DATABASE_PASSWORD",
      "LOAD_HEADERS_JSON"
    ]))
    expect(JSON.stringify(generator.Properties.ContainerDefinitions[0]))
      .toContain("garnet-framework/secret/api-client")

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
    template.resourceCountIs("AWS::ECS::Service", 9)
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
      FEDERATION_DEFAULT_LOCAL: "true",
      FEDERATION_ROUTER_URL: "http://federation:8080",
      ENTITY_EVENT_TRANSPORT: "sqs-watermark",
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

    const snapshot = (Object.values(task_definitions) as any[])
      .find((resource) =>
        resource.Properties.ContainerDefinitions[0].Name ===
          "garnet-snapshot"
      )
    const snapshot_environment = Object.fromEntries(
      snapshot.Properties.ContainerDefinitions[0].Environment
        .map((entry: any) => [entry.Name, entry.Value])
    )
    expect(snapshot_environment).not.toHaveProperty("READ_DBHOST")

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

  it("treats ALB request scaling as requests per target per minute", () => {
    const template = synth_broker()

    template.hasResourceProperties(
      "AWS::ApplicationAutoScaling::ScalingPolicy",
      {
        PolicyType: "TargetTrackingScaling",
        TargetTrackingScalingPolicyConfiguration: {
          PredefinedMetricSpecification: {
            PredefinedMetricType:
              "ALBRequestCountPerTarget"
          },
          ScaleInCooldown: 180,
          ScaleOutCooldown: 30,
          TargetValue: 15000
        }
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

  it("uses one deterministic high-throughput FIFO matcher queue", () => {
    const template = synth_broker()

    template.hasResourceProperties("AWS::SQS::Queue", {
      FifoQueue: true,
      DeduplicationScope: "messageGroup",
      FifoThroughputLimit: "perMessageGroupId",
      VisibilityTimeout: 60,
      ReceiveMessageWaitTimeSeconds: 20
    })
    const rendered = JSON.stringify(template.toJSON())
    expect(rendered).not.toContain('"sqs:*"')
    expect(rendered).not.toContain('"sns:*"')
    expect(rendered).not.toContain("AWS::SNS::Topic")
    template.hasResourceProperties(
      "AWS::CloudWatch::Alarm",
      {
        DatapointsToAlarm: 2,
        EvaluationPeriods: 2,
        Metrics: Match.arrayWith([
          Match.objectLike({
            Expression: "visible / running",
            ReturnData: true
          }),
          Match.objectLike({
            MetricStat: {
              Metric: {
                MetricName: "ApproximateNumberOfMessagesVisible",
                Namespace: "AWS/SQS"
              },
              Stat: "Sum"
            },
            ReturnData: false
          }),
          Match.objectLike({
            MetricStat: {
              Metric: {
                MetricName: "RunningTaskCount",
                Namespace: "ECS/ContainerInsights"
              },
              Stat: "Average"
            },
            ReturnData: false
          })
        ])
      }
    )
    template.hasResourceProperties(
      "AWS::ApplicationAutoScaling::ScalingPolicy",
      {
        PolicyType: "StepScaling",
        StepScalingPolicyConfiguration: Match.objectLike({
          AdjustmentType: "ChangeInCapacity",
          Cooldown: 60,
          StepAdjustments: Match.arrayWith([
            Match.objectLike({
              ScalingAdjustment: 4
            })
          ])
        })
      }
    )
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

    const services = template.findResources("AWS::ECS::Service")
    for (const service of Object.values(services) as any[]) {
      expect(service.DependsOn).toEqual(
        expect.arrayContaining([migration_resource_id])
      )
      expect(
        service.Properties.DeploymentConfiguration
          .DeploymentCircuitBreaker
      ).toEqual({ Enable: true, Rollback: true })
    }
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
      eventual_entity_reads: false
    })).toThrow(/digest-pinned/)
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
      eventual_entity_reads: false
    })).toThrow(/load image must be immutable and digest-pinned/)
  })
})
