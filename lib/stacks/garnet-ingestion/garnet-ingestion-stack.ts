import { Duration, NestedStack, NestedStackProps, RemovalPolicy, Stack } from 'aws-cdk-lib'
import { SubnetType, Vpc } from 'aws-cdk-lib/aws-ec2'
import { Code, LayerVersion, Runtime, Function,Architecture} from "aws-cdk-lib/aws-lambda"
import { Queue } from "aws-cdk-lib/aws-sqs"
import { garnet_nomenclature } from '../../../constants'
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs'
import { Parameters } from '../../../parameters'
import { PolicyStatement } from 'aws-cdk-lib/aws-iam'
import { deployment_params } from '../../../sizing'
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources'

export interface GarnetIngestionStackProps extends NestedStackProps {
  dns_context_broker: string,
  vpc: Vpc
}

export class GarnetIngestionStack extends NestedStack {

  public readonly sqs_garnet_ingestion: Queue

  constructor(scope: Stack, id: string, props: GarnetIngestionStackProps) {
    super(scope, id, props)

        //CHECK PROPS
        if (!props.vpc) {
          throw new Error(
            "The property vpc is required to create an instance of the construct"
          );
        }
        if (!props.dns_context_broker) {
          throw new Error(
            "The property dns_context_broker is required to create an instance of the construct"
          );
        }
    
        // LAMBDA LAYER (SHARED LIBRARIES)
        const layer_lambda_path = `./lib/layers`;
        const layer_lambda = new LayerVersion(this, "LayerLambda", {
          code: Code.fromAsset(layer_lambda_path),
          compatibleRuntimes: [Runtime.NODEJS_22_X],
        })
    
        // SQS ENTRY POINT
        const sqs_garnet_endpoint = new Queue(this, "SqsGarnetIot", {
          queueName: garnet_nomenclature.garnet_ingestion_queue,
          visibilityTimeout: Duration.seconds(55)
        })

    
        // LAMBDA THAT GETS MESSAGES FROM THE QUEUE AND UPDATES CONTEXT BROKER
        const lambda_to_context_broker_log = new LogGroup(this, 'LambdaIngestionUpdateContextBrokerLogs', {
          retention: RetentionDays.THREE_MONTHS,
          removalPolicy: RemovalPolicy.DESTROY
        })
        const lambda_to_context_broker_path = `${__dirname}/lambda/updateContextBroker`;
        const lambda_to_context_broker = new Function(this,"LambdaIngestionUpdateContextBroker", {
            functionName: garnet_nomenclature.garnet_ingestion_update_broker_lambda,
            description: 'Garnet Ingestion- Function that updates the context broker',
            vpc: props.vpc,
            vpcSubnets: {
              subnetType: SubnetType.PRIVATE_WITH_EGRESS,
            },
            runtime: Runtime.NODEJS_22_X,
            code: Code.fromAsset(lambda_to_context_broker_path),
            handler: "index.handler",
            timeout: Duration.seconds(50),
            logGroup: lambda_to_context_broker_log,
            layers: [layer_lambda],
            architecture: Architecture.ARM_64,
            environment: {
              DNS_CONTEXT_BROKER: props.dns_context_broker,
              URL_SMART_DATA_MODEL: Parameters.smart_data_model_url,
              AWSIOTTHINGTYPE: garnet_nomenclature.aws_iot_thing
            }
          }
        )
        lambda_to_context_broker.node.addDependency(lambda_to_context_broker_log)
        lambda_to_context_broker.addToRolePolicy(
          new PolicyStatement({
            actions: [
              "logs:CreateLogGroup",
              "logs:CreateLogStream",
              "logs:PutLogEvents",
              "ec2:CreateNetworkInterface",
              "ec2:DescribeNetworkInterfaces",
              "ec2:DeleteNetworkInterface",
              "ec2:AssignPrivateIpAddresses",
              "ec2:UnassignPrivateIpAddresses",
            ],
            resources: ["*"],
          })
        )
    
        // ADD PERMISSION FOR LAMBDA TO ACCESS SQS
        lambda_to_context_broker.addToRolePolicy(
          new PolicyStatement({
            actions: [
              "sqs:ReceiveMessage",
              "sqs:DeleteMessage",
              "sqs:GetQueueAttributes",
            ],
            resources: [`${sqs_garnet_endpoint.queueArn}`],
          })
        )
    
        lambda_to_context_broker.addEventSource(
          new SqsEventSource(sqs_garnet_endpoint, { 
            batchSize: deployment_params.lambda_broker_batch_size, 
            maxBatchingWindow: Duration.seconds(deployment_params.lambda_broker_batch_window), 
            maxConcurrency: deployment_params.lambda_broker_concurent_sqs
          })
        )
      
        this.sqs_garnet_ingestion = sqs_garnet_endpoint
      
      
      }
    }

