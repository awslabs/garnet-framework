import { Construct } from "constructs"
import { Runtime, Function, Code, Architecture,LayerVersion } from "aws-cdk-lib/aws-lambda"
import { Bucket } from "aws-cdk-lib/aws-s3"
import { PolicyStatement, Role, ServicePrincipal } from "aws-cdk-lib/aws-iam"
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs"
import { CfnDeliveryStream } from "aws-cdk-lib/aws-kinesisfirehose"
import { Duration, RemovalPolicy } from "aws-cdk-lib"
import { garnet_nomenclature } from "../../../../constants"

export interface GarnetDataLakeStreamProps {
    readonly bucket_name: string
  }


export class GarnetDataLakeStream extends Construct {
    public readonly datalake_kinesis_firehose_delivery_stream : CfnDeliveryStream

    constructor(scope: Construct, id: string, props: GarnetDataLakeStreamProps) {
        super(scope, id)


    // LAMBDA LAYER (SHARED LIBRARIES)
    const layer_lambda_path = `./lib/layers`;
    const layer_lambda = new LayerVersion(this, "LayerLambda", {
      code: Code.fromAsset(layer_lambda_path),
      compatibleRuntimes: [Runtime.NODEJS_22_X],
    })

    // KINESIS FIREHOSE TO DATALAKE BUCKET 

    // DATALAKE BUCKET
    const bucket = Bucket.fromBucketName(this, "GarnetBucket", props.bucket_name)


    // ROLE THAT GRANTS ACCESS TO FIREHOSE TO READ/WRITE BUCKET
    const role_firehose = new Role(this, "FirehoseRole", {
      assumedBy: new ServicePrincipal("firehose.amazonaws.com")
    })
    bucket.grantReadWrite(role_firehose)

// LAMBDA THAT TRANSFORMS IN FIREHOSE STREAM
    const lambda_transform_logs = new LogGroup(this, 'LambdaBucketHeadFunctionLogs', {
      retention: RetentionDays.ONE_MONTH,
      // logGroupName: `${garnet_nomenclature.garnet_lake_transform_lambda}-cw-logs`,
      removalPolicy: RemovalPolicy.DESTROY
    })
    const lambda_transform_path = `${__dirname}/lambda/transform`
    const lambda_transform = new Function(this, 'LakeTransformLambda', {
    functionName: garnet_nomenclature.garnet_lake_transform_lambda, 
        description: 'Garnet Lake - Function that transforms the Kinesis Firehose records to extract entities from notifications',
        runtime: Runtime.NODEJS_22_X,
        layers: [layer_lambda],
        code: Code.fromAsset(lambda_transform_path),
        handler: 'index.handler',
        timeout: Duration.minutes(1),
        architecture: Architecture.ARM_64,
        logGroup: lambda_transform_logs
    })
    
    lambda_transform.node.addDependency(lambda_transform_logs)

// KINESIS FIREHOSE DELIVERY STREAM
const kinesis_firehose = new CfnDeliveryStream( this, "GarnetFirehose", {
    deliveryStreamName: garnet_nomenclature.garnet_lake_firehose_stream,
    deliveryStreamType: "DirectPut",
    extendedS3DestinationConfiguration: {
      bucketArn: bucket.bucketArn,
      roleArn: role_firehose.roleArn,
      bufferingHints: {
        intervalInSeconds: garnet_nomenclature.garnet_lake_firehose_interval,
        sizeInMBs: garnet_nomenclature.garnet_lake_buffer_size,
      },
      processingConfiguration: {
        enabled: true,
        processors: [
          {
            type: "RecordDeAggregation",
            parameters: [
              {
                parameterName: "SubRecordType",
                parameterValue: "JSON",
              }
            ]
          },
            {
                type: 'Lambda',
                parameters: [{
                    parameterName: 'LambdaArn',
                    parameterValue: lambda_transform.functionArn
                }]
            },
            {
              type: 'AppendDelimiterToRecord',
              parameters: [
                {
                  parameterName: 'Delimiter',
                  parameterValue: '\\n',
                },
              ],
            }
          // ,{
          //   type: "MetadataExtraction",
          //   parameters: [
          //     {
          //       parameterName: "MetadataExtractionQuery",
          //       parameterValue: "{type:.type}",
          //     },
          //     {
          //       parameterName: "JsonParsingEngine",
          //       parameterValue: "JQ-1.6",
          //     },
          //   ],
          // }
        ],
      },
      dynamicPartitioningConfiguration: {
        enabled: true,
      },
      prefix: `type=!{partitionKeyFromLambda:type}/dt=!{timestamp:yyyy}-!{timestamp:MM}-!{timestamp:dd}-!{timestamp:HH}/`,
      errorOutputPrefix: `type=!{firehose:error-output-type}/dt=!{timestamp:yyy}-!{timestamp:MM}-!{timestamp:dd}-!{timestamp:HH}/`,
    },
  }
)

lambda_transform.grantInvoke(role_firehose)

this.datalake_kinesis_firehose_delivery_stream = kinesis_firehose


    }
}