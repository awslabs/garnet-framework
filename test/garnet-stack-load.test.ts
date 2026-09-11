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
        garnet_broker_public_origin: "https://broker.example"
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
            TargetValue: 60000
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
    ).toBe(3)

    for (const output of [
      "GarnetApiTokenSecretArn",
      "GarnetLoadCluster",
      "GarnetLoadGeneratorTask",
      "GarnetLoadAggregateTask",
      "GarnetLoadSecurityGroup",
      "GarnetLoadSubnets",
      "GarnetLoadReportBucket",
      "GarnetLoadBrokerUrl",
      "GarnetAwsRegion",
      "GarnetAwsAccount",
      "GarnetBrokerImage",
      "GarnetBrokerCluster",
      "GarnetDatabaseCluster",
      "GarnetEntityEventQueueName",
      "GarnetApiId",
      "GarnetApiStage",
      "GarnetLakeDeliveryStream"
    ]) {
      template.hasOutput(output, {})
    }
    expect(template.toJSON().Outputs).not.toHaveProperty("GarnetApiToken")
  })
})
