import { Duration } from "aws-cdk-lib"
import { CfnScalingPolicy } from
    "aws-cdk-lib/aws-applicationautoscaling"
import { ScalableTaskCount } from "aws-cdk-lib/aws-ecs"
import { Construct } from "constructs"
import { garnet_resource_name } from "../../../../constants"

export interface MatcherScalingProps {
    scope: Construct
    id: string
    scaling: ScalableTaskCount
    target_pending_partitions_per_worker: number
}

/**
 * Scale direct PostgreSQL matchers by independent work, not event-row count.
 *
 * Every matcher emits the same bounded global health sample. Dividing non-empty
 * logical partitions by live matcher membership produces a load metric that
 * falls as tasks join without rewarding a single hot partition that cannot be
 * parallelized safely.
 */
export const scale_on_matcher_partitions = (
    props: MatcherScalingProps
): void => {
    const target = props.scaling.scalableTargetRef
    const policy = new CfnScalingPolicy(props.scope, props.id, {
        policyName: garnet_resource_name(
            "matcher-partition-scaling"
        ),
        policyType: "TargetTrackingScaling",
        scalingTargetId: target.resourceId,
        targetTrackingScalingPolicyConfiguration: {
            targetValue:
                props.target_pending_partitions_per_worker,
            scaleInCooldown: Duration.seconds(180).toSeconds(),
            scaleOutCooldown: Duration.seconds(30).toSeconds(),
            customizedMetricSpecification: {
                metrics: [
                    {
                        id: "pending_per_worker",
                        expression:
                            "IF(workers > 0, pending / workers, pending)",
                        label:
                            "Pending Entity-event partitions per live matcher",
                        returnData: true
                    },
                    {
                        id: "pending",
                        returnData: false,
                        metricStat: {
                            metric: {
                                namespace: "Garnet/Broker",
                                metricName:
                                    "EntityEventPendingPartitions",
                                dimensions: [{
                                    name: "Service",
                                    value: "garnet-matcher"
                                }]
                            },
                            stat: "Average"
                        }
                    },
                    {
                        id: "workers",
                        returnData: false,
                        metricStat: {
                            metric: {
                                namespace: "Garnet/Broker",
                                metricName:
                                    "EntityEventMatcherWorkers",
                                dimensions: [{
                                    name: "Service",
                                    value: "garnet-matcher"
                                }]
                            },
                            stat: "Average"
                        }
                    }
                ]
            }
        }
    })
    policy.node.addDependency(props.scaling)
}
