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

const period = Duration.minutes(1)

const matcher_metric = (
    metric_name: string,
    statistic: string
): Metric => new Metric({
    namespace: "Garnet/Broker",
    metricName: metric_name,
    dimensionsMap: {
        Service: "garnet-matcher"
    },
    statistic,
    period
})

export class GarnetMatcherObservability extends Construct {
    public readonly backlog_widget: GraphWidget
    public readonly outcomes_widget: GraphWidget

    constructor(scope: Construct, id: string) {
        super(scope, id)

        const oldest_pending = matcher_metric(
            "EntityEventOldestPendingAgeMs",
            "Maximum"
        )
        const matcher_workers = matcher_metric(
            "EntityEventMatcherWorkers",
            "Minimum"
        )
        const health_errors = matcher_metric(
            "EntityEventHealthSampleErrors",
            "Sum"
        )
        const open_quarantines = matcher_metric(
            "EntityEventOpenQuarantines",
            "Maximum"
        )
        const quarantine_limit = matcher_metric(
            "EntityEventOpenQuarantineLimitReached",
            "Maximum"
        )

        new Alarm(this, "BacklogAgeAlarm", {
            alarmName:
                garnet_resource_name("matcher-oldest-pending"),
            alarmDescription:
                "The oldest ready Entity event has waited over one minute",
            metric: oldest_pending,
            threshold: 60_000,
            comparisonOperator:
                ComparisonOperator.GREATER_THAN_THRESHOLD,
            evaluationPeriods: 3,
            datapointsToAlarm: 2,
            treatMissingData: TreatMissingData.NOT_BREACHING
        })
        new Alarm(this, "WorkerQuorumAlarm", {
            alarmName:
                garnet_resource_name("matcher-worker-quorum"),
            alarmDescription:
                "No live matcher can process committed Entity events",
            metric: matcher_workers,
            threshold: 1,
            comparisonOperator:
                ComparisonOperator.LESS_THAN_THRESHOLD,
            evaluationPeriods: 3,
            datapointsToAlarm: 2,
            treatMissingData: TreatMissingData.BREACHING
        })
        new Alarm(this, "HealthSampleAlarm", {
            alarmName:
                garnet_resource_name("matcher-health-sample"),
            alarmDescription:
                "At least one matcher could not sample database health",
            metric: health_errors,
            threshold: 0,
            comparisonOperator:
                ComparisonOperator.GREATER_THAN_THRESHOLD,
            evaluationPeriods: 1,
            treatMissingData: TreatMissingData.BREACHING
        })
        new Alarm(this, "OpenQuarantineAlarm", {
            alarmName:
                garnet_resource_name("matcher-open-quarantine"),
            alarmDescription:
                "An Entity event requires operator quarantine review",
            metric: open_quarantines,
            threshold: 0,
            comparisonOperator:
                ComparisonOperator.GREATER_THAN_THRESHOLD,
            evaluationPeriods: 1,
            treatMissingData: TreatMissingData.NOT_BREACHING
        })
        new Alarm(this, "QuarantineLimitAlarm", {
            alarmName:
                garnet_resource_name("matcher-quarantine-limit"),
            alarmDescription:
                "The bounded quarantine sample reached its 1,000-row limit",
            metric: quarantine_limit,
            threshold: 0,
            comparisonOperator:
                ComparisonOperator.GREATER_THAN_THRESHOLD,
            evaluationPeriods: 1,
            treatMissingData: TreatMissingData.NOT_BREACHING
        })

        this.backlog_widget = new GraphWidget({
            title: "Direct Entity-event matcher backlog",
            width: 12,
            left: [
                matcher_metric(
                    "EntityEventPendingPartitions",
                    "Maximum"
                ),
                matcher_workers
            ],
            right: [oldest_pending]
        })
        this.outcomes_widget = new GraphWidget({
            title: "Direct Entity-event matcher outcomes",
            width: 12,
            left: [
                matcher_metric("EntityEventClaimed", "Sum"),
                matcher_metric(
                    "EntityEventProcessorCompleted",
                    "Sum"
                ),
                matcher_metric("EntityEventRetries", "Sum"),
                matcher_metric("EntityEventQuarantined", "Sum")
            ],
            right: [
                matcher_metric("EntityEventClaimErrors", "Sum"),
                matcher_metric(
                    "EntityEventCompletionErrors",
                    "Sum"
                ),
                health_errors
            ]
        })
    }
}
