import { App, NestedStack } from "aws-cdk-lib"
import { Match, Template } from "aws-cdk-lib/assertions"

const CONFIG_PATH = require.resolve("../configuration")

describe("Garnet load deployment outputs", () => {
  afterEach(() => jest.resetModules())

  it("exports everything needed to launch on-demand load tasks", () => {
    jest.resetModules()
    const actual = jest.requireActual<any>("../configuration")
    jest.doMock(CONFIG_PATH, () => ({
      Parameters: {
        ...actual.Parameters,
        broker_engine: "garnet",
        architecture: "distributed",
        deployment_strategy: "rolling",
        garnet_broker_image:
          `public.ecr.aws/garnet/broker@sha256:${"a".repeat(64)}`,
        garnet_load_image:
          `public.ecr.aws/garnet/load@sha256:${"b".repeat(64)}`,
        garnet_broker_public_origin: "https://broker.example",
        garnet_eventual_entity_reads: true,
        garnet_eventual_entity_read_route: "aurora-reader"
      }
    }))

    const {
      GarnetFrameworkStack
    } = require("../lib/garnet-framework-stack")
    const app = new App()
    const stack = new GarnetFrameworkStack(
      app,
      "GarnetFramework",
      {
        env: {
          account: "111111111111",
          region: "eu-west-3"
        }
      }
    )
    const template = Template.fromStack(stack)
    const broker = stack.node.findChild("GarnetBroker") as NestedStack
    const broker_template = Template.fromStack(broker)

    broker_template.hasResourceProperties(
      "AWS::ApplicationAutoScaling::ScalingPolicy",
      {
        PolicyType: "TargetTrackingScaling",
        TargetTrackingScalingPolicyConfiguration:
          Match.objectLike({
            PredefinedMetricSpecification: {
              PredefinedMetricType:
                "ALBRequestCountPerTarget",
              ResourceLabel: Match.anyValue()
            },
            TargetValue: 15000
          })
      }
    )
    const scalable_targets = Object.values(
      broker_template.findResources(
        "AWS::ApplicationAutoScaling::ScalableTarget"
      )
    ) as any[]
    expect(
      scalable_targets.find(
        (resource) =>
          resource.Properties.MaxCapacity === 64
      )?.Properties.MinCapacity
    ).toBe(2)
    broker_template.hasResourceProperties(
      "AWS::EC2::SecurityGroupIngress",
      {
        Description:
          "Load generators to the production API listener",
        FromPort: 80,
        IpProtocol: "tcp",
        ToPort: 80,
        SourceSecurityGroupId: Match.anyValue()
      }
    )
    const iam_policies = Object.values(
      broker_template.findResources("AWS::IAM::Policy")
    ) as any[]
    const generator_policy = iam_policies.find((policy) =>
      policy.Properties.PolicyDocument.Statement.some((statement: any) => {
        const actions = Array.isArray(statement.Action)
          ? statement.Action
          : [statement.Action]
        return actions.includes("s3:PutObject") &&
          !actions.some((action: string) =>
            action.startsWith("s3:DeleteObject")
          )
      })
    )
    expect(generator_policy).toBeDefined()
    const generator_actions =
      generator_policy.Properties.PolicyDocument.Statement.flatMap(
        (statement: any) =>
          Array.isArray(statement.Action)
            ? statement.Action
            : [statement.Action]
      )
    expect(generator_actions).toContain("s3:GetObject")
    expect(generator_actions).not.toContain("s3:GetObject*")
    expect(generator_actions).not.toContain("s3:List*")
    expect(JSON.stringify(generator_policy)).toContain("/garnet-load/*")

    for (const output of [
      "GarnetLoadCluster",
      "GarnetLoadCapacityProvider",
      "GarnetLoadGeneratorTask",
      "GarnetLoadAggregateTask",
      "GarnetLoadSecurityGroup",
      "GarnetLoadSubnets",
      "GarnetLoadReportBucket",
      "GarnetLoadBrokerUrl",
      "GarnetAwsRegion",
      "GarnetAwsAccount",
      "GarnetBrokerImage",
      "GarnetAuthorizationConfigurationDigest",
      "GarnetBrokerCluster",
      "GarnetDatabaseCluster",
      "GarnetDatabaseTopology",
      "GarnetApiId",
      "GarnetApiStage",
      "GarnetLakeDeliveryStream"
    ]) {
      template.hasOutput(output, {})
    }
    template.hasOutput("GarnetDatabaseTopology", {
      Value: "writer-reader"
    })
    template.hasOutput("GarnetAuthorizationConfigurationDigest", {
      Value: Match.stringLikeRegexp("^sha256:[0-9a-f]{64}$")
    })
    expect(template.toJSON().Outputs).not.toHaveProperty("GarnetApiToken")
  })
})
