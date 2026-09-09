import { Duration } from "aws-cdk-lib"
import { Metric } from "aws-cdk-lib/aws-cloudwatch"
import { ScalableTaskCount } from "aws-cdk-lib/aws-ecs"

export interface WorkerScalingProps {
    id: string
    scaling: ScalableTaskCount
    service_name: string
    target_utilization_percent: number
}

/**
 * Scale I/O-bound workers from their bounded concurrency rather than CPU.
 *
 * Every task emits one fixed-cardinality EMF sample per minute, including zero
 * while idle, so the service can scale both out and in without queue-specific
 * assumptions.
 */
export const scale_on_worker_utilization = (
    props: WorkerScalingProps
): void => {
    props.scaling.scaleToTrackCustomMetric(props.id, {
        metric: new Metric({
            namespace: "Garnet/Broker",
            metricName: "WorkerUtilizationMax",
            dimensionsMap: {
                Service: props.service_name
            },
            period: Duration.minutes(1),
            statistic: "Average"
        }),
        targetValue: props.target_utilization_percent,
        scaleInCooldown: Duration.seconds(180),
        scaleOutCooldown: Duration.seconds(30)
    })
}
