import { Duration, NestedStack, NestedStackProps } from "aws-cdk-lib";
import { Dashboard, GraphWidget, Metric, SingleValueWidget } from "aws-cdk-lib/aws-cloudwatch";
import { Construct } from "constructs";
import { garnet_nomenclature } from "../../../constants";
import { title } from "process";
import { deployment_params } from "../../../sizing";


export interface GarnetOpsProps extends NestedStackProps{

}

export class GarnetOps extends NestedStack {

    constructor(scope: Construct, id: string, props: GarnetOpsProps) {
        super(scope, id, props)

        // CLOUDWATCH DASHBOARD 
        const garnet_dashboard = new Dashboard(this, `GarnetCwDashboard`, {
            dashboardName: `Garnet-Dashboard`
        })

    
        // GARNET BROKER METRICS
        let garnet_broker_metrics: Array<Metric> = []


         if (deployment_params.architecture == 'distributed'){
            garnet_broker_metrics = garnet_broker_metrics.concat([
                    new Metric({
                        label: 'History Entity Manager - Memory %', 
                        namespace: 'AWS/ECS',
                        metricName: 'MemoryUtilization', 
                        dimensionsMap: {
                            ClusterName: garnet_nomenclature.garnet_broker_cluster
                        }, 
                        statistic: 'SampleCount',

                    })
            ])
         } else {

         }


        // GARNET BROKER WIDGET
        let garnet_scorpio_widget = new SingleValueWidget({
            title: 'Garnet Scorpio Broker Ops',
            width: 24,
            period: Duration.seconds(60),
            metrics: [],
            setPeriodToTimeRange: true
        })

        let iot_metrics = [
            new Metric({
                label: 'Update Shadow - Invocations',
                namespace: 'AWS/Lambda',
                metricName: 'Invocations', 
                dimensionsMap: {
                    FunctionName: garnet_nomenclature.garnet_iot_update_shadow_lambda
                }, 
                statistic: 'SampleCount',

            }), 
            new Metric({
                label: 'Update Shadow - Errors',
                namespace: 'AWS/Lambda',
                metricName: 'Errors', 
                dimensionsMap: {
                    FunctionName: garnet_nomenclature.garnet_iot_update_shadow_lambda
                }, 
                statistic: 'IQM',

            }), 
            new Metric({
                label: 'Update Shadow - Duration',
                namespace: 'AWS/Lambda',
                metricName: 'Duration', 
                dimensionsMap: {
                    FunctionName: garnet_nomenclature.garnet_iot_update_shadow_lambda
                }, 
                statistic: 'IQM',

            }), 
            new Metric({
                label: 'Update Shadow - ConcurrentExecutions',
                namespace: 'AWS/Lambda',
                metricName: 'ConcurrentExecutions', 
                dimensionsMap: {
                    FunctionName: garnet_nomenclature.garnet_iot_update_shadow_lambda
                }, 
                statistic: 'IQM'
            }),
            new Metric({
                label: 'Update Shadow - Throttles',
                namespace: 'AWS/Lambda',
                metricName: 'Throttles', 
                dimensionsMap: {
                    FunctionName: garnet_nomenclature.garnet_iot_update_shadow_lambda
                }, 
                statistic: 'IQM'
            })

        ]

        let garnet_iot_widget = new SingleValueWidget({
            title: 'Garnet IoT Ops',
            width: 24,
            period: Duration.seconds(60),
            metrics: iot_metrics,
            setPeriodToTimeRange: true
        })

        garnet_dashboard.addWidgets(garnet_iot_widget)
        



    } 
}