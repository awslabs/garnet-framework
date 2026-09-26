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
      lake_delivery_stream_name: "garnet-lake"
    })
    const template = Template.fromStack(ops)

    template.resourceCountIs("AWS::CloudWatch::Alarm", 9)
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
    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      AlarmName: "garnet-framework-matcher-oldest-pending",
      MetricName: "EntityEventOldestPendingAgeMs",
      Namespace: "Garnet/Broker",
      Threshold: 60000,
      EvaluationPeriods: 3,
      DatapointsToAlarm: 2
    })
    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      AlarmName: "garnet-framework-matcher-worker-quorum",
      ComparisonOperator: "LessThanThreshold",
      MetricName: "EntityEventMatcherWorkers",
      Namespace: "Garnet/Broker",
      Threshold: 1,
      TreatMissingData: "breaching"
    })
    for (const metricName of [
      "EntityEventHealthSampleErrors",
      "EntityEventOpenQuarantines",
      "EntityEventOpenQuarantineLimitReached"
    ]) {
      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: metricName,
        Namespace: "Garnet/Broker",
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
    expect(dashboard).toContain("Direct Entity-event matcher backlog")
    expect(dashboard).toContain("EntityEventPendingPartitions")
    expect(dashboard).toContain("garnet-snapshot")
  })
})
