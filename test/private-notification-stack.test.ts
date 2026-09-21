import { App, Stack } from "aws-cdk-lib"
import { Match, Template } from "aws-cdk-lib/assertions"
import { Vpc } from "aws-cdk-lib/aws-ec2"
import {
  AwsIotCoreMqttConnector
} from "../lib/connectors/aws-iot-core-mqtt/aws-iot-core-mqtt-connector"

describe("AWS IoT Core MQTT connector", () => {
  it("publishes through a private API-key protected endpoint", () => {
    const app = new App()
    const parent = new Stack(app, "Parent", {
      env: {
        account: "111111111111",
        region: "eu-west-3"
      }
    })
    const vpc = new Vpc(parent, "Vpc", { maxAzs: 2 })
    const connector = new AwsIotCoreMqttConnector(
      parent,
      "Connector",
      {
        vpc,
        tenant: "factory-a"
      }
    )
    const template = Template.fromStack(connector)

    template.resourceCountIs("AWS::IoT::TopicRule", 0)
    template.resourceCountIs(
      "AWS::KinesisFirehose::DeliveryStream",
      0
    )
    template.resourceCountIs("AWS::ApiGateway::ApiKey", 1)
    template.resourceCountIs("AWS::ApiGateway::UsagePlan", 1)
    template.hasResourceProperties("AWS::ApiGateway::Method", {
      ApiKeyRequired: true
    })
    template.hasResourceProperties("AWS::ApiGateway::RestApi", {
      EndpointConfiguration: Match.objectLike({
        Types: ["PRIVATE"]
      }),
      Policy: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Effect: "Deny",
            Condition: Match.objectLike({
              StringNotEquals: Match.objectLike({
                "aws:SourceVpce": Match.anyValue()
              })
            })
          })
        ])
      })
    })
    expect(JSON.stringify(template.toJSON())).toContain(
      "topic/garnet-framework/tenants/*/subscriptions/*"
    )
    expect(JSON.stringify(template.toJSON())).toContain("iot:Publish")
    expect(JSON.stringify(template.toJSON())).toContain(
      "GARNET_TENANT"
    )
    expect(JSON.stringify(template.toJSON())).toContain("factory-a")
    expect(JSON.stringify(template.toJSON())).not.toContain(
      "AwsIotThing"
    )
  })
})
