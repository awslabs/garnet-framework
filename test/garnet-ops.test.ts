import { App, Stack } from "aws-cdk-lib"
import { Template } from "aws-cdk-lib/assertions"
import { GarnetOps } from "../lib/stacks/garnet-ops/garnet-ops-stack"

describe("Garnet operations observability", () => {
  it("alarms on Firehose Iceberg freshness and saturation", () => {
    const app = new App()
    const parent = new Stack(app, "Parent", {
      env: {
        account: "111111111111",
        region: "eu-west-3"
      }
    })
    const ops = new GarnetOps(parent, "Ops", {
      broker_cluster_name: "garnet",
      database_cluster_identifier: "garnet-database",
      entity_event_queue_name: "garnet-events.fifo",
      lake_delivery_stream_name: "garnet-lake"
    })
    const template = Template.fromStack(ops)

    template.resourceCountIs("AWS::CloudWatch::Alarm", 4)
    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      AlarmName: "garnet-framework-lake-data-freshness",
      MetricName: "DeliveryToIceberg.DataFreshness",
      Namespace: "AWS/Firehose",
      Dimensions: [{
        Name: "DeliveryStreamName",
        Value: "garnet-lake"
      }],
      Threshold: 300,
      EvaluationPeriods: 2,
      DatapointsToAlarm: 2
    })
    for (const metricName of [
      "DeliveryToIceberg.FailedRowCount",
      "ThrottledRecords",
      "PartitionCountExceeded"
    ]) {
      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: metricName,
        Namespace: "AWS/Firehose",
        Threshold: 0,
        EvaluationPeriods: 1
      })
    }
    const dashboards = Object.values(
      template.findResources("AWS::CloudWatch::Dashboard")
    )
    expect(dashboards).toHaveLength(1)
    const dashboard = JSON.stringify(
      dashboards[0]?.Properties?.DashboardBody
    )
    expect(dashboard).toContain("ActivePartitionsLimit")
    expect(dashboard).toContain("Snapshot materialization saturation")
    expect(dashboard).toContain("garnet-snapshot")
  })
})
