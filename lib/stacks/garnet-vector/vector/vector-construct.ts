import { CustomResource, Duration, RemovalPolicy } from "aws-cdk-lib"
import { Runtime, Function as LambdaFunction, Code, Architecture,  } from "aws-cdk-lib/aws-lambda"
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs"
import { Construct } from "constructs"
import { garnet_nomenclature, garnet_vector_bucket } from "../../../../constants"
import { PolicyStatement } from "aws-cdk-lib/aws-iam"
import { Provider } from "aws-cdk-lib/custom-resources"

export interface GarnetVectorProps {

  }


export class GarnetVector extends Construct {
    public readonly bucket_name: string

    constructor(scope: Construct, id: string, props: GarnetVectorProps) {
        super(scope, id)

        // CUSTOM RESOURCE WITH A LAMBDA THAT WILL CREATE GARNET VECTOR BUCKET IF NOT EXISTS
        const lambda_vector_bucket_logs = new LogGroup(this, 'LambdaVectorBucketCreateFunctionLogs', {
        retention: RetentionDays.ONE_MONTH,
        removalPolicy: RemovalPolicy.DESTROY
        })

        const lambda_vector_bucket_path = `${__dirname}/lambda/vectorCreate`
        const lambda_vector_bucket = new LambdaFunction(this, 'VectorBucketCreateFunction', {
            functionName: garnet_nomenclature.garnet_utils_vector_create_lambda,
            description: 'Garnet Utils - Function that creates Garnet Vector Bucket if it does not exist',
            runtime: Runtime.NODEJS_LATEST,
            code: Code.fromAsset(lambda_vector_bucket_path),
            handler: 'index.handler',
            timeout: Duration.seconds(50),
            logGroup: lambda_vector_bucket_logs, 
            architecture: Architecture.ARM_64,
            environment: {
                VECTOR_BUCKET_NAME: garnet_vector_bucket
            }
        })

        lambda_vector_bucket.node.addDependency(lambda_vector_bucket_logs)

        lambda_vector_bucket.addToRolePolicy(new PolicyStatement({
            actions: [
            "s3:CreateBucket",
            "s3:PutMetricsConfiguration",
            "s3:HeadBucket",
            "s3:ListBucket"
            ],
            resources: ["arn:aws:s3:::*"] 
        }))


        // CUSTOM RESOURCE WITH A LAMBDA THAT WILL CHECK IF GARNET VECTOR EXISTS
        const lambda_vector_check_logs = new LogGroup(this, 'LambdaVectorCheckFunctionLogs', {
            retention: RetentionDays.ONE_MONTH,
            removalPolicy: RemovalPolicy.DESTROY
        })
        const lambda_vector_check_path = `${__dirname}/lambda/vectorCheck`
        const lambda_vector_check = new LambdaFunction(this, 'VectorBucketCheckFunction', {
            functionName: garnet_nomenclature.garnet_utils_bucket_check_lambda,
            description: 'Garnet Utils - Function that check if Garnet Vector exists',
            runtime: Runtime.NODEJS_LATEST,
            code: Code.fromAsset(lambda_vector_check_path),
            handler: 'index.handler',
            timeout: Duration.seconds(50),
            logGroup: lambda_vector_check_logs, 
            architecture: Architecture.ARM_64,
            environment: {
                VECTOR_BUCKET_NAME: garnet_vector_bucket
            }
        })

        lambda_vector_check.node.addDependency(lambda_vector_check_logs)

        lambda_vector_check.addToRolePolicy(new PolicyStatement({
            actions: [
            "s3:CreateBucket",
            "s3:PutMetricsConfiguration",
            "s3:HeadBucket",
            "s3:ListBucket"
            ],
            resources: ["arn:aws:s3:::*"] 
        }))

        const vector_provider_log = new LogGroup(this, 'LambdaCustomVectorProviderLogs', {
        retention: RetentionDays.ONE_MONTH,
        // logGroupName: `garnet-provider-custom-bucket-lambda-cw-logs`,
        removalPolicy: RemovalPolicy.DESTROY
        })
    
        const vector_provider = new Provider(this, 'CustomVectorProvider', {
            onEventHandler: lambda_vector_bucket,
            isCompleteHandler: lambda_vector_check,
            providerFunctionName:  garnet_nomenclature.garnet_utils_vector_provider_lambda,
            logGroup: vector_provider_log
        }) 
    
        vector_provider.node.addDependency(vector_provider_log)
        
        const vector_resource = new CustomResource(this, 'CustomVectorProviderResource', {
            serviceToken: vector_provider.serviceToken,
            
        })
    
        this.bucket_name = vector_resource.getAtt('vector_bucket_name').toString()

    }

}