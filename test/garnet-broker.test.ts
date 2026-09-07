import { App, Stack } from "aws-cdk-lib"
import { Template } from "aws-cdk-lib/assertions"
import { SubnetType, Vpc } from "aws-cdk-lib/aws-ec2"
import { CfnDeliveryStream } from "aws-cdk-lib/aws-kinesisfirehose"
import { Secret } from "aws-cdk-lib/aws-secretsmanager"
import { GarnetBroker } from "../lib/stacks/garnet-broker/garnet-broker-stack"

const IMAGE =
  `public.ecr.aws/garnet/broker@sha256:${"a".repeat(64)}`

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

const synth_broker = (): Template => {
  const app = new App()
  const stack = new Stack(app, "TestStack", {
    env: {
      account: "111111111111",
      region: "eu-west-3"
    }
  })
  const vpc = create_vpc(stack)
  const secret = new Secret(stack, "DatabaseSecret", {
    generateSecretString: {
      secretStringTemplate: JSON.stringify({ username: "garnetadmin" }),
      generateStringKey: "password"
    }
  })
  const stream = new CfnDeliveryStream(stack, "DeliveryStream", {
    deliveryStreamName: "garnet-test-stream"
  })
  const broker = new GarnetBroker(stack, "Broker", {
    vpc,
    secret,
    delivery_stream: stream,
    image: IMAGE,
    public_origin: "https://broker.example",
    notification_delivery_allow_origins: "https://callbacks.example",
    context_allow_hosts: "uri.etsi.org"
  })
  return Template.fromStack(broker)
}

describe("Garnet Broker AWS runtime", () => {
  it("uses direct Aurora PostgreSQL without RDS Proxy", () => {
    const template = synth_broker()

    template.resourceCountIs("AWS::RDS::DBCluster", 1)
    template.resourceCountIs("AWS::RDS::DBProxy", 0)
    template.hasResourceProperties("AWS::RDS::DBCluster", {
      Engine: "aurora-postgresql",
      EngineVersion: "16.11",
      DatabaseName: "scorpio"
    })
  })

  it("creates every long-lived role and both one-shot tasks on ARM64", () => {
    const template = synth_broker()
    const task_definitions =
      template.findResources("AWS::ECS::TaskDefinition")

    expect(Object.keys(task_definitions)).toHaveLength(11)
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
      "/garnet-maintenance",
      "/garnet-matcher",
      "/garnet-migrate",
      "/garnet-notification-scheduler",
      "/garnet-relay",
      "/garnet-subscription-reconciler"
    ].sort())
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
      DB_POOL_MAX: "16"
    })
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
  })

  it("gates every service on the one-shot migration resource", () => {
    const template = synth_broker()
    const custom_resources =
      template.findResources("AWS::CloudFormation::CustomResource")
    expect(Object.keys(custom_resources)).toHaveLength(1)
    const [migration_resource_id] = Object.keys(custom_resources)

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
    const secret = new Secret(stack, "Secret")
    const stream = new CfnDeliveryStream(stack, "Stream", {
      deliveryStreamName: "garnet-test-stream"
    })

    expect(() => new GarnetBroker(stack, "Broker", {
      vpc,
      secret,
      delivery_stream: stream,
      image: "public.ecr.aws/garnet/broker:latest",
      public_origin: "",
      notification_delivery_allow_origins: "",
      context_allow_hosts: ""
    })).toThrow(/digest-pinned/)
  })
})
