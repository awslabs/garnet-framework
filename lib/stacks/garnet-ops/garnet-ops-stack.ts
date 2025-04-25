import { Aws, Duration, NestedStack, NestedStackProps } from "aws-cdk-lib";
import { Dashboard,  Metric, Row, SingleValueWidget } from "aws-cdk-lib/aws-cloudwatch";
import { Construct } from "constructs";
import { garnet_bucket, garnet_nomenclature, scorpiobroker_sqs_object } from "../../../constants";
import { deployment_params } from "../../../architecture";


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
                    period: Duration.minutes(30)
        
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
                    period: Duration.minutes(30)
        
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
                    statistic: 'Average',
                    period: Duration.minutes(30)
        
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
                    statistic: 'IQM',
                    period: Duration.minutes(30)
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
                    period: Duration.minutes(30)
    
                }), 
                new Metric({
                    label: `${label} - Errors`,
                    namespace: 'AWS/Lambda',
                    metricName: 'Errors', 
                    dimensionsMap: {
                        FunctionName: functionName
                    }, 
                    statistic: 'Sum',
                    period: Duration.minutes(30)
    
                }), 
                new Metric({
                    label: `${label} - Duration`,
                    namespace: 'AWS/Lambda',
                    metricName: 'Duration', 
                    dimensionsMap: {
                        FunctionName: functionName
                    }, 
                    statistic: 'IQM',
                    period: Duration.minutes(30)
    
                }), 
                new Metric({
                    label: `${label} - ConcurrentExecutions`,
                    namespace: 'AWS/Lambda',
                    metricName: 'ConcurrentExecutions', 
                    dimensionsMap: {
                        FunctionName: functionName
                    }, 
                    statistic: 'IQM',
                    period: Duration.minutes(30)
                }),
                new Metric({
                    label: `${label} - Throttles`,
                    namespace: 'AWS/Lambda',
                    metricName: 'Throttles', 
                    dimensionsMap: {
                        FunctionName: functionName
                    }, 
                    statistic: 'Sum',
                    period: Duration.minutes(30)

                })
            ]
            return new SingleValueWidget({
                title: `Garnet Ingestion- Lambda ${label}`,
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
                    period: Duration.minutes(30)
                }),
                new Metric({
                    label: `${label}- Sent Message Size`,
                    namespace: 'AWS/SQS',
                    metricName: 'SentMessageSize', 
                    dimensionsMap: {
                        QueueName:  queueName
                    }, 
                    statistic: 'IQM',
                    period: Duration.minutes(30)
                }), 
                new Metric({
                    label: `${label} - Nb Message Received`,
                    namespace: 'AWS/SQS',
                    metricName: 'NumberOfMessagesReceived', 
                    dimensionsMap: {
                        QueueName:  queueName
                    }, 
                    statistic: 'Sum',
                    period: Duration.minutes(30)
                }),
                new Metric({
                    label: `${label} - Approx Age Oldest Message`,
                    namespace: 'AWS/SQS',
                    metricName: 'ApproximateAgeOfOldestMessage', 
                    dimensionsMap: {
                        QueueName:  queueName
                    }, 
                    statistic: 'IQM',
                    period: Duration.minutes(30)
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



        

        // GARNET INGESTION LAMBDA UPDATE BROKER
        
        let garnet_ingestion_lambda_update_broker_widget = set_lambda_widgets('Ingestion Lambda', garnet_nomenclature.garnet_ingestion_update_broker_lambda)

    
        // GARNET SQS INGESTION 
        let garnet_ingestion_sqs_broker_widget = set_sqs_widgets('Garnet SQS Ingestion', garnet_nomenclature.garnet_ingestion_queue)

        // GARNET DATALAKE 
        let garnet_datalake_metrics = [
            new Metric({
                label: 'Garnet Lake - Number of Objects Stored',
                namespace: 'AWS/S3',
                metricName: 'NumberOfObjects', 
                dimensionsMap: {
                    BucketName: garnet_bucket,
                    StorageType: "AllStorageTypes"
                }, 
                statistic: 'Sum',
                period: Duration.minutes(30)
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
                period: Duration.minutes(30)
            }), 
            new Metric({
                label: 'Garnet Lake - Firehose',
                namespace: 'AWS/Firehose',
                metricName: 'DeliveryToS3.Records', 
                dimensionsMap: {
                    DeliveryStreamName: garnet_nomenclature.garnet_lake_iot_firehose_stream,
                }, 
                statistic: 'Sum',
                period: Duration.minutes(30)
            })
        ]

        let garnet_datalake_widget = new SingleValueWidget({
            title: 'Garnet Data Lake',
            width: 24,
            period: Duration.seconds(60),
            metrics: garnet_datalake_metrics,
            setPeriodToTimeRange: true
        })


        let garnet_ingestion = new Row(
            garnet_ingestion_lambda_update_broker_widget,
            garnet_ingestion_sqs_broker_widget,
            garnet_datalake_widget)


        garnet_dashboard.addWidgets(garnet_ingestion)


     
        let garnet_broker_db_metrics = [
            new Metric({
                label: 'Garnet Broker Aurora - DataBase Connections',
                namespace: 'AWS/RDS',
                metricName: 'DatabaseConnections', 
                dimensionsMap: {
                    DBClusterIdentifier: garnet_nomenclature.garnet_db_cluster_id
                }, 
                statistic: 'IQM',
                period: Duration.minutes(30)
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
                statistic: 'IQM',
                period: Duration.minutes(30)
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
                statistic: 'IQM',
                period: Duration.minutes(30)
            }),
            new Metric({
                label: 'Garnet Broker Aurora - Read Ops',
                namespace: 'AWS/RDS',
                metricName: 'ReadIOPS', 
                dimensionsMap: {
                    DBClusterIdentifier: garnet_nomenclature.garnet_db_cluster_id
                }, 
                statistic: 'IQM',
                period: Duration.minutes(30)
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
                statistic: 'IQM',
                period: Duration.minutes(30)
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

