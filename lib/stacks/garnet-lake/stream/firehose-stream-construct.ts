import {
  Aws,
  Duration,
  RemovalPolicy
} from "aws-cdk-lib"
import {
  PolicyStatement,
  Role,
  ServicePrincipal
} from "aws-cdk-lib/aws-iam"
import { CfnDeliveryStream } from "aws-cdk-lib/aws-kinesisfirehose"
import {
  Architecture,
  Code,
  Function,
  Runtime
} from "aws-cdk-lib/aws-lambda"
import {
  LogGroup,
  LogStream,
  RetentionDays
} from "aws-cdk-lib/aws-logs"
import { Bucket } from "aws-cdk-lib/aws-s3"
import { Construct } from "constructs"
import {
  garnet_nomenclature,
  garnet_resource_name
} from "../../../../constants"

export interface GarnetDataLakeStreamProps {
  bucket: Bucket
  database_name: string
  table_name: string
}

export class GarnetDataLakeStream extends Construct {
  public readonly datalake_kinesis_firehose_delivery_stream:
    CfnDeliveryStream

  constructor(
    scope: Construct,
    id: string,
    props: GarnetDataLakeStreamProps
  ) {
    super(scope, id)

    const transform_logs = new LogGroup(this, "TransformLogs", {
      retention: RetentionDays.ONE_MONTH,
      removalPolicy: RemovalPolicy.DESTROY
    })
    const transform = new Function(this, "Transform", {
      functionName: garnet_nomenclature.garnet_lake_transform_lambda,
      description:
        "Validates Garnet Entity events and maps them to the Iceberg schema",
      runtime: Runtime.NODEJS_24_X,
      code: Code.fromAsset(`${__dirname}/lambda/transform`),
      handler: "index.handler",
      timeout: Duration.minutes(1),
      architecture: Architecture.ARM_64,
      memorySize: 1024,
      logGroup: transform_logs,
      environment: {
        DESTINATION_DATABASE_NAME: props.database_name,
        DESTINATION_TABLE_NAME: props.table_name
      }
    })

    const delivery_logs = new LogGroup(this, "DeliveryLogs", {
      retention: RetentionDays.ONE_MONTH,
      removalPolicy: RemovalPolicy.DESTROY
    })
    const delivery_log_stream = new LogStream(
      this,
      "DeliveryLogStream",
      {
        logGroup: delivery_logs,
        logStreamName: "iceberg"
      }
    )
    const role = new Role(this, "FirehoseRole", {
      assumedBy: new ServicePrincipal("firehose.amazonaws.com")
    })
    props.bucket.grantReadWrite(role)
    role.addToPolicy(new PolicyStatement({
      actions: [
        "glue:GetDatabase",
        "glue:GetDatabases",
        "glue:GetTable",
        "glue:GetTables",
        "glue:GetTableVersion",
        "glue:GetTableVersions",
        "glue:UpdateTable"
      ],
      resources: [
        `arn:${Aws.PARTITION}:glue:${Aws.REGION}:${Aws.ACCOUNT_ID}:catalog`,
        `arn:${Aws.PARTITION}:glue:${Aws.REGION}:${Aws.ACCOUNT_ID}:database/${props.database_name}`,
        `arn:${Aws.PARTITION}:glue:${Aws.REGION}:${Aws.ACCOUNT_ID}:table/${props.database_name}/${props.table_name}`
      ]
    }))
    role.addToPolicy(new PolicyStatement({
      actions: ["lakeformation:GetDataAccess"],
      resources: ["*"]
    }))
    delivery_logs.grantWrite(role)
    transform.grantInvoke(role)
    role.addToPolicy(new PolicyStatement({
      actions: ["lambda:GetFunctionConfiguration"],
      resources: [transform.functionArn]
    }))

    const stream = new CfnDeliveryStream(this, "Firehose", {
      deliveryStreamName:
        garnet_nomenclature.garnet_lake_firehose_stream,
      deliveryStreamType: "DirectPut",
      icebergDestinationConfiguration: {
        appendOnly: true,
        bufferingHints: {
          intervalInSeconds:
            garnet_nomenclature.garnet_lake_firehose_interval,
          sizeInMBs:
            garnet_nomenclature.garnet_lake_buffer_size
        },
        catalogConfiguration: {
          catalogArn:
            `arn:${Aws.PARTITION}:glue:${Aws.REGION}:${Aws.ACCOUNT_ID}:catalog`
        },
        cloudWatchLoggingOptions: {
          enabled: true,
          logGroupName: delivery_logs.logGroupName,
          logStreamName: delivery_log_stream.logStreamName
        },
        destinationTableConfigurationList: [{
          destinationDatabaseName: props.database_name,
          destinationTableName: props.table_name,
          s3ErrorOutputPrefix:
            "failed/table=!{firehose:error-output-type}/"
        }],
        processingConfiguration: {
          enabled: true,
          processors: [{
            type: "Lambda",
            parameters: [
              {
                parameterName: "LambdaArn",
                parameterValue: transform.functionArn
              },
              {
                parameterName: "NumberOfRetries",
                parameterValue: "3"
              },
              {
                parameterName: "BufferSizeInMBs",
                parameterValue: "3"
              },
              {
                parameterName: "BufferIntervalInSeconds",
                parameterValue: "60"
              }
            ]
          }]
        },
        retryOptions: {
          durationInSeconds: 300
        },
        roleArn: role.roleArn,
        s3Configuration: {
          bucketArn: props.bucket.bucketArn,
          roleArn: role.roleArn,
          bufferingHints: {
            intervalInSeconds: 60,
            sizeInMBs: 64
          },
          compressionFormat: "GZIP",
          prefix: "failed/",
          errorOutputPrefix:
            "failed/type=!{firehose:error-output-type}/" +
            "year=!{timestamp:yyyy}/month=!{timestamp:MM}/" +
            "day=!{timestamp:dd}/"
        }
      }
    })
    stream.node.addDependency(transform)
    stream.node.addDependency(delivery_log_stream)

    this.datalake_kinesis_firehose_delivery_stream = stream
  }
}
