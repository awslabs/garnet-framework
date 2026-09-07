import { Duration } from "aws-cdk-lib"
import {
    MathExpression,
    Metric
} from "aws-cdk-lib/aws-cloudwatch"
import {
    FargateService,
    ScalableTaskCount
} from "aws-cdk-lib/aws-ecs"
import { Queue } from "aws-cdk-lib/aws-sqs"

export interface QueueBacklogScalingProps {
    id: string
    queue: Queue
    service: FargateService
    scaling: ScalableTaskCount
    target_backlog_per_task: number
}

/**
 * Scale parallel queue work without treating a coalesced watermark as one event.
 *
 * Queue age remains the lag alarm: one hot FIFO group cannot become parallel by
 * adding tasks. Visible messages per running task instead measures independent
 * partitions that another matcher task can actually consume.
 */
export const scale_on_queue_backlog = (
    props: QueueBacklogScalingProps
): void => {
    const period = Duration.minutes(1)
    const visible = props.queue.metricApproximateNumberOfMessagesVisible({
        period,
        statistic: "Sum"
    })
    const running = new Metric({
        namespace: "ECS/ContainerInsights",
        metricName: "RunningTaskCount",
        dimensionsMap: {
            ClusterName: props.service.cluster.clusterName,
            ServiceName: props.service.serviceName
        },
        period,
        statistic: "Average"
    })
    const backlog_per_task = new MathExpression({
        expression: "visible / running",
        usingMetrics: {
            visible,
            running
        },
        period,
        label: `${props.service.serviceName} visible backlog per task`
    })

    props.scaling.scaleOnMetric(props.id, {
        metric: backlog_per_task,
        scalingSteps: [
            {
                upper: 1,
                change: -1
            },
            {
                lower: 1,
                upper: props.target_backlog_per_task,
                change: 0
            },
            {
                lower: props.target_backlog_per_task,
                upper: props.target_backlog_per_task * 2,
                change: 1
            },
            {
                lower: props.target_backlog_per_task * 2,
                upper: props.target_backlog_per_task * 4,
                change: 2
            },
            {
                lower: props.target_backlog_per_task * 4,
                change: 4
            }
        ],
        cooldown: Duration.seconds(60),
        evaluationPeriods: 2,
        datapointsToAlarm: 2
    })
}
