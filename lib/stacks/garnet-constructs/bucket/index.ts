import { CustomResource, Duration, Names, RemovalPolicy } from "aws-cdk-lib";
import { Runtime, Function, Code, Architecture } from "aws-cdk-lib/aws-lambda";
import { Construct } from "constructs";
import { Parameters } from "../../../../parameters";
import { PolicyStatement} from "aws-cdk-lib/aws-iam";
import { Provider } from "aws-cdk-lib/custom-resources";
import { CfnDeliveryStream } from "aws-cdk-lib/aws-kinesisfirehose";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import {garnet_bucket } from './../../../../constants'

export interface GarnetBucketProps {

  }


export class GarnetBucket extends Construct {

    public readonly bucket_name: string
    public readonly kinesis_firehose: CfnDeliveryStream

    constructor(scope: Construct, id: string, props: GarnetBucketProps) {
        super(scope, id)


      // CUSTOM RESOURCE WITH A LAMBDA THAT WILL CREATE GARNET BUCKET AND ATHENA RESULTS BUCKET IF NOT EXISTS
      const lambda_bucket_logs = new LogGroup(this, 'LambdaBucketHeadFunctionLogs', {
        retention: RetentionDays.ONE_MONTH,
        logGroupName: `garnet-utils-bucket-lambda-cw-logs`,
        removalPolicy: RemovalPolicy.DESTROY
    })
      
      const lambda_bucket_path = `${__dirname}/lambda/bucketHead`
      const lambda_bucket = new Function(this, 'BucketHeadFunction', {
            functionName: `garnet-utils-bucket-lambda`,
            description: 'Garnet Utils - Function that creates Garnet Bucket if it does not exist',
            runtime: Runtime.NODEJS_20_X,
            code: Code.fromAsset(lambda_bucket_path),
            handler: 'index.handler',
            timeout: Duration.seconds(50),
            logGroup: lambda_bucket_logs, 
            architecture: Architecture.ARM_64,
            environment: {
              BUCKET_NAME: garnet_bucket
            }
      })

      lambda_bucket.node.addDependency(lambda_bucket_logs)

      lambda_bucket.addToRolePolicy(new PolicyStatement({
          actions: ["s3:CreateBucket"],
          resources: ["arn:aws:s3:::*"] 
          }))


     const bucket_provider_log = new LogGroup(this, 'LambdaCustomBucketProviderLogs', {
      retention: RetentionDays.ONE_MONTH,
      logGroupName: `garnet-provider-custom-bucket-lambda-cw-logs`,
      removalPolicy: RemovalPolicy.DESTROY
      })

      const bucket_provider = new Provider(this, 'CustomBucketProvider', {
        onEventHandler: lambda_bucket,
        providerFunctionName:  `garnet-provider-custom-bucket-lambda`,
        logGroup: bucket_provider_log
      }) 

    bucket_provider.node.addDependency(bucket_provider_log)
    
     const bucket_resource = new CustomResource(this, 'CustomBucketProviderResource', {
          serviceToken: bucket_provider.serviceToken,
          
      })

    this.bucket_name = garnet_bucket

    }
}