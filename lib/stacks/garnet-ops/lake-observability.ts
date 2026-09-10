import { Duration } from "aws-cdk-lib"
import {
  Alarm,
  ComparisonOperator,
  GraphWidget,
  Metric,
  TreatMissingData
} from "aws-cdk-lib/aws-cloudwatch"
import { Construct } from "constructs"
import { garnet_resource_name } from "../../../constants"

export interface GarnetLakeObservabilityProps {
  delivery_stream_name: string
}

const period = Duration.minutes(1)

export class GarnetLakeObservability extends Construct {
  public readonly delivery_widget: GraphWidget
  public readonly partition_widget: GraphWidget

  constructor(
    scope: Construct,
    id: string,
    props: GarnetLakeObservabilityProps
  ) {
    super(scope, id)

    const metric = (
      metricName: string,
      statistic: string
    ): Metric => new Metric({
      namespace: "AWS/Firehose",
      metricName,
      dimensionsMap: {
        DeliveryStreamName: props.delivery_stream_name
      },
      statistic,
      period
    })

    const freshness = metric(
      "DeliveryToIceberg.DataFreshness",
      "Maximum"
    )
    const failed_rows = metric(
      "DeliveryToIceberg.FailedRowCount",
      "Sum"
    )
    const throttled_records = metric("ThrottledRecords", "Sum")
    const partition_exceeded = metric(
      "PartitionCountExceeded",
      "Maximum"
    )

    new Alarm(this, "DataFreshnessAlarm", {
      alarmName:
        garnet_resource_name("lake-data-freshness"),
      alarmDescription:
        "Oldest Firehose record has waited over five minutes",
      metric: freshness,
      threshold: 300,
      comparisonOperator:
        ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: 2,
      datapointsToAlarm: 2,
      treatMissingData: TreatMissingData.NOT_BREACHING
    })
    new Alarm(this, "FailedRowsAlarm", {
      alarmName: garnet_resource_name("lake-failed-rows"),
      alarmDescription:
        "Firehose sent at least one failed Iceberg row to backup",
      metric: failed_rows,
      threshold: 0,
      comparisonOperator:
        ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: 1,
      treatMissingData: TreatMissingData.NOT_BREACHING
    })
    new Alarm(this, "ThrottledRecordsAlarm", {
      alarmName:
        garnet_resource_name("lake-throttled-records"),
      alarmDescription:
        "Firehose throttled at least one incoming record",
      metric: throttled_records,
      threshold: 0,
      comparisonOperator:
        ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: 1,
      treatMissingData: TreatMissingData.NOT_BREACHING
    })
    new Alarm(this, "PartitionLimitAlarm", {
      alarmName:
        garnet_resource_name("lake-partition-limit"),
      alarmDescription:
        "Firehose exceeded its active partition limit",
      metric: partition_exceeded,
      threshold: 0,
      comparisonOperator:
        ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: 1,
      treatMissingData: TreatMissingData.NOT_BREACHING
    })

    this.delivery_widget = new GraphWidget({
      title: "Iceberg delivery",
      width: 12,
      left: [
        metric("DeliveryToIceberg.SuccessfulRowCount", "Sum"),
        failed_rows,
        throttled_records
      ],
      right: [freshness]
    })
    this.partition_widget = new GraphWidget({
      title: "Iceberg active partitions",
      width: 12,
      left: [
        metric("PartitionCount", "Maximum"),
        metric("ActivePartitionsLimit", "Maximum")
      ],
      right: [partition_exceeded]
    })
  }
}
