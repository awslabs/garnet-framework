import { Aws, Duration, RemovalPolicy } from "aws-cdk-lib"
import { CfnIntegration, CfnRoute } from "aws-cdk-lib/aws-apigatewayv2"
import { Vpc } from "aws-cdk-lib/aws-ec2"
import { Runtime, Function, Code, CfnPermission, LayerVersion, Architecture } from "aws-cdk-lib/aws-lambda"
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs"
import { Construct } from "constructs"
import { garnet_broker, garnet_constant, garnet_nomenclature } from "../../../../constants"
import { deployment_params } from "../../../../sizing"
import { Queue } from "aws-cdk-lib/aws-sqs"



export interface GarnetApiCommonProps {
    readonly api_ref: string,
    readonly vpc: Vpc,
    dns_context_broker: string,
    garnet_ingestion_sqs_arn: string, 
    garnet_private_endpoint: string
}

export class GarnetApiCommon extends Construct {
   
    constructor(scope: Construct, id: string, props: GarnetApiCommonProps){
        super(scope, id)
        
        const sqs_ingestion = Queue.fromQueueArn(this, 'SqsIngestion', props.garnet_ingestion_sqs_arn)


        // LAMBDA LAYER (SHARED LIBRARIES)
        const layer_lambda_path = `./lib/layers`
        const layer_lambda = new LayerVersion(this, 'LayerLambda', {
            code: Code.fromAsset(layer_lambda_path),
            compatibleRuntimes: [Runtime.NODEJS_20_X]
        })


// ********************************************** 

        /**
         *  GARNET VERSION 
         */

        // LAMBDA GARNET API VERSION
        const lambda_garnet_version_log = new LogGroup(this, 'LambdaGarnetVersionLogs', {
            retention: RetentionDays.THREE_MONTHS,
            removalPolicy: RemovalPolicy.DESTROY
        })
        const lambda_garnet_version_path = `${__dirname}/lambda/garnetVersion`
        const lambda_garnet_version = new Function(this, 'LambdaGarnetVersion', {
            functionName: `garnet-api-version-lambda`,
            vpc: props.vpc, 
            description: 'Garnet API - Function that returns the Garnet Version',
            runtime: Runtime.NODEJS_20_X,
            code: Code.fromAsset(lambda_garnet_version_path),
            handler: 'index.handler',
            timeout: Duration.seconds(30),
            logGroup: lambda_garnet_version_log,
            layers: [layer_lambda],
            architecture: Architecture.ARM_64,
            environment: {
                    CONTEXT_BROKER: garnet_broker,
                    GARNET_VERSION: garnet_constant.garnet_version, 
                    GARNET_PRIVATE_ENDPOINT: props.garnet_private_endpoint, 
                    GARNET_INGESTION_SQS_URL: sqs_ingestion.queueUrl, 
                    GARNET_INGESTION_SQS_ARN: sqs_ingestion.queueArn,
                    DNS_CONTEXT_BROKER: props.dns_context_broker,
                    GARNET_ARCHITECTURE: deployment_params.architecture,
                    GARNET_CONTAINERS: deployment_params.architecture == 'distributed' ? 
                                                                        JSON.stringify([
                                                                            `${garnet_nomenclature.garnet_broker_atcontextserver}`,
                                                                            `${garnet_nomenclature.garnet_broker_entitymanager}`,
                                                                            `${garnet_nomenclature.garnet_broker_historyentitymanager}`,
                                                                            `${garnet_nomenclature.garnet_broker_historyquerymanager}`,
                                                                            `${garnet_nomenclature.garnet_broker_querymanager}`,
                                                                            `${garnet_nomenclature.garnet_broker_registrymanager}`,
                                                                            `${garnet_nomenclature.garnet_broker_registrysubscriptionmanager}`,
                                                                            `${garnet_nomenclature.garnet_broker_subscriptionmanager}`
                                                                        ]) : 
                                                                        JSON.stringify([
                                                                            `${garnet_nomenclature.garnet_broker_allinone}`
                                                                        ])
            }   
        })
        lambda_garnet_version.node.addDependency(lambda_garnet_version_log)
        const garnet_version_integration = new CfnIntegration(this, 'GarnetVersionIntegration', {
            apiId: props.api_ref,
            integrationMethod: "GET",
            integrationType: "AWS_PROXY",
            integrationUri: lambda_garnet_version.functionArn,
            connectionType: "INTERNET",
            description: "GARNET VERSION INTEGRATION",
            payloadFormatVersion: "1.0",
        })

        const garnet_version_route = new CfnRoute(this, 'GarnetVersionRoute', {
            apiId: props.api_ref,
            routeKey: "GET /",
            target: `integrations/${garnet_version_integration.ref}`
        })

        new CfnPermission(this, 'ApiGatewayLambdaPermissionGarnetVersion', {
            principal: `apigateway.amazonaws.com`,
            action: 'lambda:InvokeFunction',
            functionName: lambda_garnet_version.functionName,
            sourceArn: `arn:aws:execute-api:${Aws.REGION}:${Aws.ACCOUNT_ID}:${props.api_ref}/*/*/*`
        })

        /**
        *  END GARNET VERSION
        */


// ********************************************** 







    }
}
