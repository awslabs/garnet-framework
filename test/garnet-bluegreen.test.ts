import { App, Stack } from "aws-cdk-lib"
import { Match, Template } from "aws-cdk-lib/assertions"
import { SubnetType, Vpc } from "aws-cdk-lib/aws-ec2"
import { CfnDeliveryStream } from "aws-cdk-lib/aws-kinesisfirehose"

const CONFIG_PATH = require.resolve("../configuration")
const IMAGE =
  `public.ecr.aws/garnet/broker@sha256:${"a".repeat(64)}`

const synth_bluegreen = (): Template => {
  jest.resetModules()
  const actual = jest.requireActual<any>("../configuration")
  jest.doMock(CONFIG_PATH, () => ({
    Parameters: {
      ...actual.Parameters,
      deployment_strategy: "bluegreen"
    }
  }))
  const { GarnetBroker } = require(
    "../lib/stacks/garnet-broker/garnet-broker-stack"
  )
  const app = new App()
  const stack = new Stack(app, "BlueGreenStack", {
    env: {
      account: "111111111111",
      region: "eu-west-3"
    }
  })
  const vpc = new Vpc(stack, "Vpc", {
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
  const stream = new CfnDeliveryStream(stack, "Stream", {
    deliveryStreamName: "garnet-test-stream"
  })
  const broker = new GarnetBroker(stack, "Broker", {
    vpc,
    delivery_stream: stream,
    image: IMAGE,
    load_image: "",
    public_origin: "https://broker.example",
    notification_delivery_allow_origins: "",
    private_notification_origin:
      "https://private.example.execute-api.eu-west-3.amazonaws.com",
    context_allow_hosts: "",
    eventual_entity_reads: false
  })
  return Template.fromStack(broker)
}

describe("Garnet API blue/green deployment", () => {
  afterEach(() => jest.resetModules())

  it("keeps workers rolling and gives the API a test traffic path", () => {
    const template = synth_bluegreen()
    const services = template.findResources("AWS::ECS::Service")
    expect(Object.keys(services)).toHaveLength(8)

    const bluegreen = Object.values(services).filter(
      (service: any) =>
        service.Properties.DeploymentConfiguration.Strategy ===
          "BLUE_GREEN"
    ) as any[]
    expect(bluegreen).toHaveLength(1)
    expect(bluegreen[0].Properties.ServiceName).toBe("garnet-api")
    expect(
      bluegreen[0].Properties.DeploymentConfiguration
    ).toMatchObject({
      Strategy: "BLUE_GREEN",
      BakeTimeInMinutes: 10,
      MinimumHealthyPercent: 100,
      MaximumPercent: 200
    })
    expect(
      bluegreen[0].Properties.DeploymentConfiguration
        .Alarms
    ).toMatchObject({
      Enable: true,
      Rollback: true
    })
    expect(
      bluegreen[0].Properties.DeploymentConfiguration
        .Alarms.AlarmNames
    ).toHaveLength(2)

    for (const service of Object.values(services) as any[]) {
      const circuitBreaker =
        service.Properties.DeploymentConfiguration
          .DeploymentCircuitBreaker
      if (service.Properties.ServiceName === "garnet-api") {
        expect(circuitBreaker).toBeUndefined()
      } else {
        expect(circuitBreaker).toEqual({
          Enable: true,
          Rollback: true
        })
      }
    }

    const listeners = Object.values(
      template.findResources(
        "AWS::ElasticLoadBalancingV2::Listener"
      )
    ).map((listener: any) => listener.Properties.Port)
    expect(listeners.sort()).toEqual([80, 8080])
    template.resourceCountIs(
      "AWS::ElasticLoadBalancingV2::TargetGroup",
      2
    )
    template.hasResourceProperties("AWS::ECS::Service", {
      ServiceName: "garnet-api",
      DeploymentConfiguration: Match.objectLike({
        Alarms: {
          Enable: true,
          Rollback: true
        },
        LifecycleHooks: Match.arrayWith([
          Match.objectLike({
            LifecycleStages: ["POST_TEST_TRAFFIC_SHIFT"]
          })
        ])
      }),
      LoadBalancers: Match.arrayWith([
        Match.objectLike({
          AdvancedConfiguration: Match.objectLike({
            AlternateTargetGroupArn: Match.anyValue(),
            ProductionListenerRule: Match.anyValue(),
            TestListenerRule: Match.anyValue()
          })
        })
      ])
    })
    template.hasResourceProperties("AWS::Lambda::Function", {
      FunctionName:
        "garnet-framework-api-deployment-validation",
      Architectures: ["arm64"],
      Runtime: "nodejs24.x",
      Environment: {
        Variables: {
          TEST_ORIGIN: Match.anyValue()
        }
      }
    })
    template.hasResourceProperties("AWS::EC2::SecurityGroupIngress", {
      Description:
        "Blue/green validation Lambda to the test listener",
      FromPort: 8080,
      IpProtocol: "tcp",
      ToPort: 8080
    })
    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      AlarmName:
        "garnet-framework-api-deployment-target-5xx-rate",
      Threshold: 2,
      EvaluationPeriods: 2,
      DatapointsToAlarm: 2,
      TreatMissingData: "notBreaching"
    })
    template.hasResourceProperties(
      "AWS::ApplicationAutoScaling::ScalingPolicy",
      {
        PolicyType: "TargetTrackingScaling",
        TargetTrackingScalingPolicyConfiguration:
          Match.objectLike({
            CustomizedMetricSpecification: {
              Metrics: Match.arrayWith([
                Match.objectLike({
                  Expression:
                    "production_requests_per_target + " +
                    "alternate_requests_per_target"
                }),
                Match.objectLike({
                  MetricStat: Match.objectLike({
                    Metric: Match.objectLike({
                      MetricName: "RequestCountPerTarget",
                      Namespace: "AWS/ApplicationELB"
                    }),
                    Stat: "Sum"
                  })
                })
              ])
            },
            ScaleInCooldown: 180,
            ScaleOutCooldown: 30,
            TargetValue: 60000
          })
      }
    )
    const bluegreen_policy = Object.values(
      template.findResources(
        "AWS::ApplicationAutoScaling::ScalingPolicy"
      )
    ).find(
      (policy: any) =>
        policy.Properties.TargetTrackingScalingPolicyConfiguration
          ?.TargetValue === 60000
    ) as any
    const metrics =
      bluegreen_policy.Properties
        .TargetTrackingScalingPolicyConfiguration
        .CustomizedMetricSpecification.Metrics
    expect(
      metrics.filter(
        (metric: any) =>
          metric.MetricStat?.Metric.MetricName ===
          "RequestCountPerTarget"
      )
    ).toHaveLength(2)
    expect(
      metrics.some(
        (metric: any) =>
          metric.MetricStat?.Metric.MetricName ===
          "RunningTaskCount"
      )
    ).toBe(false)
    const scaling_policies = Object.values(
      template.findResources(
        "AWS::ApplicationAutoScaling::ScalingPolicy"
      )
    ) as any[]
    expect(scaling_policies).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          Properties: expect.objectContaining({
            TargetTrackingScalingPolicyConfiguration:
              expect.objectContaining({
                PredefinedMetricSpecification:
                  expect.objectContaining({
                    PredefinedMetricType:
                      "ALBRequestCountPerTarget"
                  })
              })
          })
        })
      ])
    )
  })
})
