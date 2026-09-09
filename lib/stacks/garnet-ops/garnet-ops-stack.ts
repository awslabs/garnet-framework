import {
    Aws,
    Duration,
    NestedStack,
    NestedStackProps
} from "aws-cdk-lib"
import {
    Dashboard,
    GraphWidget,
    Metric,
    Row,
    SingleValueWidget
} from "aws-cdk-lib/aws-cloudwatch"
import { Construct } from "constructs"
import { garnet_resource_name } from "../../../constants"

export interface GarnetOpsProps extends NestedStackProps {
    broker_cluster_name: string
    database_cluster_identifier: string
    entity_event_queue_name: string
}

const period = Duration.minutes(1)
const broker_metric = (
    metricName: string,
    service: string,
    statistic: string
): Metric => new Metric({
    namespace: "Garnet/Broker",
    metricName,
    dimensionsMap: {
        Service: service
    },
    statistic,
    period
})

export class GarnetOps extends NestedStack {
    constructor(
        scope: Construct,
        id: string,
        props: GarnetOpsProps
    ) {
        super(scope, id, props)

        const dashboard = new Dashboard(this, "Dashboard", {
            dashboardName:
                `${garnet_resource_name("ops")}-${Aws.REGION}`
        })
        dashboard.addWidgets(new Row(
            new SingleValueWidget({
                title: "Garnet API",
                width: 12,
                setPeriodToTimeRange: true,
                metrics: [
                    broker_metric("Requests", "garnet-api", "Sum"),
                    broker_metric("Responses5xx", "garnet-api", "Sum"),
                    broker_metric("Rejected", "garnet-api", "Sum")
                ]
            }),
            new GraphWidget({
                title: "Garnet API latency",
                width: 12,
                left: [
                    broker_metric(
                        "DurationP50Ms",
                        "garnet-api",
                        "Maximum"
                    ),
                    broker_metric(
                        "DurationP95Ms",
                        "garnet-api",
                        "Maximum"
                    ),
                    broker_metric(
                        "DurationP99Ms",
                        "garnet-api",
                        "Maximum"
                    )
                ]
            })
        ))
        dashboard.addWidgets(new Row(
            new GraphWidget({
                title: "Notification delivery saturation",
                width: 12,
                left: [
                    broker_metric(
                        "WorkerUtilizationMax",
                        "garnet-delivery",
                        "Average"
                    )
                ]
            }),
            new GraphWidget({
                title: "Notification delivery outcomes",
                width: 12,
                left: [
                    broker_metric(
                        "WorkerCompleted",
                        "garnet-delivery",
                        "Sum"
                    ),
                    broker_metric(
                        "WorkerFailed",
                        "garnet-delivery",
                        "Sum"
                    ),
                    broker_metric(
                        "WorkerRetries",
                        "garnet-delivery",
                        "Sum"
                    )
                ]
            })
        ))

        const service_names = [
            "garnet-api",
            "garnet-federation",
            "garnet-relay",
            "garnet-matcher",
            "garnet-lake-sink",
            "garnet-delivery",
            "garnet-notification-scheduler",
            "garnet-subscription-reconciler",
            "garnet-snapshot"
        ]
        dashboard.addWidgets(new GraphWidget({
            title: "Broker service CPU",
            width: 12,
            left: service_names.map((serviceName) => new Metric({
                namespace: "AWS/ECS",
                metricName: "CPUUtilization",
                dimensionsMap: {
                    ClusterName: props.broker_cluster_name,
                    ServiceName: serviceName
                },
                label: serviceName,
                statistic: "Average",
                period
            }))
        }), new GraphWidget({
            title: "Broker service memory",
            width: 12,
            left: service_names.map((serviceName) => new Metric({
                namespace: "AWS/ECS",
                metricName: "MemoryUtilization",
                dimensionsMap: {
                    ClusterName: props.broker_cluster_name,
                    ServiceName: serviceName
                },
                label: serviceName,
                statistic: "Average",
                period
            }))
        }))

        dashboard.addWidgets(new Row(
            new GraphWidget({
                title: "Entity event transport",
                width: 12,
                left: [
                    new Metric({
                        namespace: "AWS/SQS",
                        metricName:
                            "ApproximateNumberOfMessagesVisible",
                        dimensionsMap: {
                            QueueName:
                                props.entity_event_queue_name
                        },
                        statistic: "Maximum",
                        period
                    }),
                    new Metric({
                        namespace: "AWS/SQS",
                        metricName:
                            "ApproximateAgeOfOldestMessage",
                        dimensionsMap: {
                            QueueName:
                                props.entity_event_queue_name
                        },
                        statistic: "Maximum",
                        period
                    })
                ]
            }),
            new GraphWidget({
                title: "Aurora capacity and connections",
                width: 12,
                left: [
                    "ACUUtilization",
                    "DatabaseConnections",
                    "AuroraReplicaLagMaximum"
                ].map((metricName) => new Metric({
                    namespace: "AWS/RDS",
                    metricName,
                    dimensionsMap: {
                        DBClusterIdentifier:
                            props.database_cluster_identifier
                    },
                    statistic: "Maximum",
                    period
                }))
            })
        ))
    }
}
