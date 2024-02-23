import { Aws, Duration, NestedStack, NestedStackProps } from "aws-cdk-lib";
import { Dashboard,  Metric, Row, SingleValueWidget } from "aws-cdk-lib/aws-cloudwatch";
import { Construct } from "constructs";
import { garnet_bucket, garnet_nomenclature, scorpiobroker_sqs_object } from "../../../constants";
import { deployment_params } from "../../../sizing";


export interface GarnetOpsProps extends NestedStackProps{

}

export class GarnetOps extends NestedStack {

    constructor(scope: Construct, id: string, props: GarnetOpsProps) {
        super(scope, id, props)

        // CLOUDWATCH DASHBOARD 
        const garnet_dashboard = new Dashboard(this, `GarnetCwDashboard`, {
            dashboardName: `Garnet-Ops-Dashboard-${Aws.REGION}`
        })


        const set_service_widgets = (GarnetDashboard: Dashboard, Name:string, ClusterName:string, ServiceName: string, DiscoveryName: string) => {

            let garnet_broker_service_metrics: Array<Metric> = []
            garnet_broker_service_metrics = [
                new Metric({               
                    label: `Scorpio - ${Name} - Memory %`, 
                    namespace: 'AWS/ECS',
                    metricName: 'MemoryUtilization', 
                    dimensionsMap: {
                        ClusterName: ClusterName,
                        ServiceName: ServiceName
                    }, 
                    statistic: 'Average',
        
                }),
                new Metric({
                    label: `Scorpio - ${Name} - CPU %`, 
                    namespace: 'AWS/ECS',
                    metricName: 'CPUUtilization', 
                    dimensionsMap: {
                        ClusterName: ClusterName,
                        ServiceName: ServiceName
                    }, 
                    statistic: 'Average',
        
                }),
                new Metric({
                    label: `Scorpio - ${Name} - Processed Bytes`, 
                    namespace: 'AWS/ECS',
                    metricName: 'ProcessedBytes', 
                    dimensionsMap: {
                        ClusterName: ClusterName,
                        ServiceName: ServiceName, 
                        DiscoveryName: DiscoveryName
                    }, 
                    statistic: 'Average'
        
                }), 
                new Metric({
                    label: `Scorpio - ${Name} - Active Connection Count`, 
                    namespace: 'AWS/ECS',
                    metricName: 'ActiveConnectionCount', 
                    dimensionsMap: {
                        ClusterName: ClusterName,
                        ServiceName: ServiceName, 
                        DiscoveryName: DiscoveryName
                    },  
                    statistic: 'IQM'
                }), 
            ]
        
        
            let garnet_broker_service_widget = new SingleValueWidget({
                title: `Garnet Scorpio -  ${Name}`,
                width: 24,
                period: Duration.seconds(60),
                metrics: garnet_broker_service_metrics,
                setPeriodToTimeRange: true
            })
            GarnetDashboard.addWidgets(garnet_broker_service_widget)     
        }

        const set_lambda_widgets = (label:string, functionName: string ) => {
            let garnet_lambda_metrics = [
                new Metric({
                    label: `${label}- Invocations`,
                    namespace: 'AWS/Lambda',
                    metricName: 'Invocations', 
                    dimensionsMap: {
                        FunctionName: functionName
                    }, 
                    statistic: 'Sum',
    
                }), 
                new Metric({
                    label: `${label} - Errors`,
                    namespace: 'AWS/Lambda',
                    metricName: 'Errors', 
                    dimensionsMap: {
                        FunctionName: functionName
                    }, 
                    statistic: 'Sum',
    
                }), 
                new Metric({
                    label: `${label} - Duration`,
                    namespace: 'AWS/Lambda',
                    metricName: 'Duration', 
                    dimensionsMap: {
                        FunctionName: functionName
                    }, 
                    statistic: 'IQM',
    
                }), 
                new Metric({
                    label: `${label} - ConcurrentExecutions`,
                    namespace: 'AWS/Lambda',
                    metricName: 'ConcurrentExecutions', 
                    dimensionsMap: {
                        FunctionName: functionName
                    }, 
                    statistic: 'IQM'
                }),
                new Metric({
                    label: `${label} - Throttles`,
                    namespace: 'AWS/Lambda',
                    metricName: 'Throttles', 
                    dimensionsMap: {
                        FunctionName: functionName
                    }, 
                    statistic: 'Sum'
                })
            ]
            return new SingleValueWidget({
                title: `Garnet IoT - Lambda ${label}`,
                width: 24,
                period: Duration.seconds(60),
                metrics: garnet_lambda_metrics, 
                setPeriodToTimeRange: true
            })  
        }

        const set_sqs_widgets = (label:string, queueName:string) => {
            let garnet_sqs_metrics = [
                new Metric({
                    label: `${label} - Nb Message Sent`,
                    namespace: 'AWS/SQS',
                    metricName: 'NumberOfMessagesSent', 
                    dimensionsMap: {
                        QueueName: queueName
                    }, 
                    statistic: 'Sum',

                }),
                new Metric({
                    label: `${label}- Sent Message Size`,
                    namespace: 'AWS/SQS',
                    metricName: 'SentMessageSize', 
                    dimensionsMap: {
                        QueueName:  queueName
                    }, 
                    statistic: 'IQM',

                }), 
                new Metric({
                    label: `${label} - Nb Message Received`,
                    namespace: 'AWS/SQS',
                    metricName: 'NumberOfMessagesReceived', 
                    dimensionsMap: {
                        QueueName:  queueName
                    }, 
                    statistic: 'Sum',

                }),
                new Metric({
                    label: `${label} - Approx Age Oldest Message`,
                    namespace: 'AWS/SQS',
                    metricName: 'ApproximateAgeOfOldestMessage', 
                    dimensionsMap: {
                        QueueName:  queueName
                    }, 
                    statistic: 'IQM',

                })
            ]
            return new SingleValueWidget({
                title: `${label}`,
                width: 24,
                period: Duration.seconds(60),
                metrics: garnet_sqs_metrics,
                setPeriodToTimeRange: true
            })
        }


        // // GARNET IOT LAMBDA UPDATE SHADOW 
        let garnet_iot_lambda_update_shadow_widget = set_lambda_widgets('Update Shadow', garnet_nomenclature.garnet_iot_update_shadow_lambda)

        // GARNET IOT LAMBDA UPDATE BROKER 

        let garnet_iot_lambda_update_broker_widget = set_lambda_widgets('Update Broker', garnet_nomenclature.garnet_iot_update_broker_lambda)



        // GARNET IOT RULE INGESTION 
        let garnet_iot_rule_metrics = [
            new Metric({
                label: 'Garnet IoT - Ingestion Rule - Success',
                namespace: 'AWS/IoT',
                metricName: 'Success', 
                dimensionsMap: {
                    ActionType: "SQS",
                    RuleName: garnet_nomenclature.garnet_iot_rule
                }, 
                statistic: 'Sum',

            }), 
            new Metric({
                label: 'Garnet IoT - Ingestion Rule - Failure',
                namespace: 'AWS/IoT',
                metricName: 'Failure', 
                dimensionsMap: {
                    ActionType: "SQS",
                    RuleName: garnet_nomenclature.garnet_iot_rule
                }, 
                statistic: 'Sum',
            }), 
            new Metric({
                label: 'Garnet IoT - Data Lake Rule - Success',
                namespace: 'AWS/IoT',
                metricName: 'Success', 
                dimensionsMap: {
                    ActionType: "Firehose",
                    RuleName: garnet_nomenclature.garnet_lake_rule
                }, 
                statistic: 'Sum',

            }), 
            new Metric({
                label: 'Garnet IoT - Data Lake Rule - Failure',
                namespace: 'AWS/IoT',
                metricName: 'Failure', 
                dimensionsMap: {
                    ActionType: "Firehose",
                    RuleName: garnet_nomenclature.garnet_lake_rule
                }, 
                statistic: 'Sum',
            })
        ]
        
        let garnet_iot_rule_widget = new SingleValueWidget({
            title: 'Garnet IoT - IoT Rules',
            width: 24,
            period: Duration.seconds(60),
            metrics: garnet_iot_rule_metrics,
            setPeriodToTimeRange: true
        })

    
        // GARNET IOT SQS INGESTION 
        let garnet_iot_sqs_widget = set_sqs_widgets('Garnet IoT - SQS IoT', garnet_nomenclature.garnet_iot_queue)

        // GARNET IOT SQS UPDATE BROKER  
        let garnet_iot_sqs_broker_widget = set_sqs_widgets('Garnet IoT - SQS Update Broker', garnet_nomenclature.garnet_iot_contextbroker_queue)


        // GARNET DATALAKE 
        let garnet_iot_datalake_metrics = [
            new Metric({
                label: 'Garnet Lake - Number of Objects Stored',
                namespace: 'AWS/S3',
                metricName: 'NumberOfObjects', 
                dimensionsMap: {
                    BucketName: garnet_bucket,
                    StorageType: "AllStorageTypes"
                }, 
                statistic: 'Sum',

            }),
            new Metric({
                label: 'Garnet Lake - Bytes Stored',
                namespace: 'AWS/S3',
                metricName: 'BucketSizeBytes', 
                dimensionsMap: {
                    BucketName: garnet_bucket,
                    StorageType: "StandardStorage"
                }, 
                statistic: 'Sum',

            }), 
            new Metric({
                label: 'Garnet Lake - Firehose',
                namespace: 'AWS/Firehose',
                metricName: 'DeliveryToS3.Records', 
                dimensionsMap: {
                    DeliveryStreamName: garnet_nomenclature.garnet_lake_iot_firehose_stream,
                }, 
                statistic: 'Sum'
            })
        ]

        let garnet_iot_datalake_widget = new SingleValueWidget({
            title: 'Garnet Data Lake',
            width: 24,
            period: Duration.seconds(60),
            metrics: garnet_iot_datalake_metrics,
            setPeriodToTimeRange: true
        })


        let garnet_iot_ingestion = new Row(
            garnet_iot_lambda_update_shadow_widget,
            garnet_iot_lambda_update_broker_widget,
            garnet_iot_sqs_widget, 
            garnet_iot_sqs_broker_widget,
            garnet_iot_rule_widget,
            garnet_iot_datalake_widget)


        garnet_dashboard.addWidgets(garnet_iot_ingestion)


        // GARNET IOT RULE INGESTION 
        let garnet_broker_db_metrics = [
            new Metric({
                label: 'Garnet Broker Aurora - DataBase Connections',
                namespace: 'AWS/RDS',
                metricName: 'DatabaseConnections', 
                dimensionsMap: {
                    DBClusterIdentifier: garnet_nomenclature.garnet_db_cluster_id
                }, 
                statistic: 'IQM'
            }),
            new Metric({
                label: 'Garnet Broker Aurora - ACU Utilization',
                namespace: 'AWS/RDS',
                metricName: 'ACUUtilization', 
                dimensionsMap: {
                    DBClusterIdentifier: garnet_nomenclature.garnet_db_cluster_id
                }, 
                statistic: 'IQM'
            }),
            new Metric({
                label: 'Garnet Broker Aurora - ACU Capacity',
                namespace: 'AWS/RDS',
                metricName: 'ServerlessDatabaseCapacity', 
                dimensionsMap: {
                    DBClusterIdentifier: garnet_nomenclature.garnet_db_cluster_id
                }, 
                statistic: 'IQM'
            }),
            new Metric({
                label: 'Garnet Broker Aurora - CPU Utilization',
                namespace: 'AWS/RDS',
                metricName: 'CPUUtilization', 
                dimensionsMap: {
                    DBClusterIdentifier: garnet_nomenclature.garnet_db_cluster_id
                }, 
                statistic: 'IQM'
            }),
            new Metric({
                label: 'Garnet Broker Aurora - Write Ops',
                namespace: 'AWS/RDS',
                metricName: 'WriteIOPS', 
                dimensionsMap: {
                    DBClusterIdentifier: garnet_nomenclature.garnet_db_cluster_id
                }, 
                statistic: 'IQM'
            }),
            new Metric({
                label: 'Garnet Broker Aurora - Write Latency',
                namespace: 'AWS/RDS',
                metricName: 'WriteLatency', 
                dimensionsMap: {
                    DBClusterIdentifier: garnet_nomenclature.garnet_db_cluster_id
                }, 
                statistic: 'IQM'
            }),
            new Metric({
                label: 'Garnet Broker Aurora - Read Ops',
                namespace: 'AWS/RDS',
                metricName: 'ReadIOPS', 
                dimensionsMap: {
                    DBClusterIdentifier: garnet_nomenclature.garnet_db_cluster_id
                }, 
                statistic: 'IQM'
            }),
            new Metric({
                label: 'Garnet Broker Aurora - Read Latency',
                namespace: 'AWS/RDS',
                metricName: 'ReadLatency', 
                dimensionsMap: {
                    DBClusterIdentifier: garnet_nomenclature.garnet_db_cluster_id
                }, 
                statistic: 'IQM'
            }),
            new Metric({
                label: 'Garnet Broker Aurora - Freeable Memory',
                namespace: 'AWS/RDS',
                metricName: 'FreeableMemory', 
                dimensionsMap: {
                    DBClusterIdentifier: garnet_nomenclature.garnet_db_cluster_id
                }, 
                statistic: 'IQM'
            }),
        ]
        
        let garnet_broker_db_widget = new SingleValueWidget({
            title: 'Garnet Broker - Database',
            width: 24,
            period: Duration.seconds(60),
            metrics: garnet_broker_db_metrics,
            setPeriodToTimeRange: true
        })

       garnet_dashboard.addWidgets(garnet_broker_db_widget)


        let service_widget: any = []

        if (deployment_params.architecture == 'distributed'){

        service_widget = [{
                Name: `Entity Manager`,
                DiscoveryName: garnet_nomenclature.garnet_broker_entitymanager
            },
            {
                Name: `Subscription Manager`,
                DiscoveryName: garnet_nomenclature.garnet_broker_subscriptionmanager
            },
            {
                Name: `Query Manager`,
                DiscoveryName: garnet_nomenclature.garnet_broker_querymanager
            },
            {
                Name: `At Context Server`,
                DiscoveryName: garnet_nomenclature.garnet_broker_atcontextserver
            },

            {
                Name: `History Entity Manager`,
                DiscoveryName: garnet_nomenclature.garnet_broker_historyentitymanager
            },
            {
                Name: `History Query Manager`,
                DiscoveryName: garnet_nomenclature.garnet_broker_historyquerymanager
            },

            {
                Name: `Registry Manager`,
                DiscoveryName: garnet_nomenclature.garnet_broker_registrymanager
            },
            {
                Name: `Registry Subscription Manager`,
                DiscoveryName: garnet_nomenclature.garnet_broker_registrysubscriptionmanager
        }]
  
        } else {
            service_widget = [{
                Name: `All In One`,
                DiscoveryName: garnet_nomenclature.garnet_broker_allinone
            }]
        }



        service_widget.forEach( 
            (service:any) => { 
                set_service_widgets(garnet_dashboard, 
                                service.Name, 
                                garnet_nomenclature.garnet_broker_cluster, 
                                `${service.DiscoveryName}-service`, 
                                service.DiscoveryName)

                                
            }
        )

        
        let service_sqs_widget: any = []
        Object.entries(scorpiobroker_sqs_object).forEach(([key, value]) => {
            let sqs_service_widget = set_sqs_widgets(`${key} SQS`, value)
            garnet_dashboard.addWidgets(sqs_service_widget)
        })












    } 
}

