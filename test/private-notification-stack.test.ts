import { App, Stack } from "aws-cdk-lib"
import { Match, Template } from "aws-cdk-lib/assertions"
import { Vpc } from "aws-cdk-lib/aws-ec2"
import { Bucket } from "aws-cdk-lib/aws-s3"
import { GarnetPrivateSub } from "../lib/stacks/garnet-privatesub/private-notification-stack"

describe("private notification infrastructure", () => {
  it("routes and archives notifications by tenant key", () => {
    const app = new App()
    const parent = new Stack(app, "Parent", {
      env: {
        account: "111111111111",
        region: "eu-west-3"
      }
    })
    const vpc = new Vpc(parent, "Vpc", { maxAzs: 2 })
    const bucket = new Bucket(parent, "Bucket")
    const notifications = new GarnetPrivateSub(
      parent,
      "Notifications",
      {
        vpc,
        bucket_name: bucket.bucketName
      }
    )
    const template = Template.fromStack(notifications)

    template.hasResourceProperties("AWS::IoT::TopicRule", {
      RuleName: "garnet_framework_subscriptions",
      TopicRulePayload: Match.objectLike({
        Sql:
          "SELECT *, topic(3) AS garnetTenant " +
          "FROM 'garnet-framework/tenants/+/subscriptions/+'"
      })
    })
    template.hasResourceProperties(
      "AWS::KinesisFirehose::DeliveryStream",
      {
        DeliveryStreamName: "garnet-framework-subscriptions",
        ExtendedS3DestinationConfiguration: Match.objectLike({
          Prefix:
            "tenant=!{partitionKeyFromQuery:tenant}/" +
            "type=!{partitionKeyFromQuery:type}/" +
            "dt=!{timestamp:yyyy}-!{timestamp:MM}-" +
            "!{timestamp:dd}-!{timestamp:HH}/",
          ProcessingConfiguration: Match.objectLike({
            Processors: Match.arrayWith([
              Match.objectLike({
                Parameters: Match.arrayWith([
                  Match.objectLike({
                    ParameterName: "MetadataExtractionQuery",
                    ParameterValue:
                      "{tenant:.garnetTenant,type:.type}"
                  })
                ])
              })
            ])
          })
        })
      }
    )
    expect(JSON.stringify(template.toJSON())).toContain(
      "topic/garnet-framework/tenants/*/subscriptions/*"
    )
  })
})
