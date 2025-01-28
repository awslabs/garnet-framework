import { Aws, CustomResource, Duration, RemovalPolicy } from "aws-cdk-lib"
import { PolicyStatement } from "aws-cdk-lib/aws-iam"
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs"
import { Provider } from "aws-cdk-lib/custom-resources"
import { Construct } from "constructs"
import { Runtime, Function, Code, Architecture } from "aws-cdk-lib/aws-lambda"
import { garnet_bucket_athena, garnet_constant } from "../../../../constants"

export interface GarnetDataLakeAthenaProps {

  }


export class GarnetDataLakeAthena extends Construct {


    constructor(scope: Construct, id: string, props: GarnetDataLakeAthenaProps) {
        super(scope, id)

         // CUSTOM RESOURCE WITH A LAMBDA THAT WILL CREATE ATHENA WORKGROUP AND GLUE DB
  const lambda_athena_log = new LogGroup(this, 'LambdaAthenaFunctionLogs', {
    retention: RetentionDays.ONE_MONTH,
    // logGroupName: `garnet-lake-athena-lambda-cw-logs`,
    removalPolicy: RemovalPolicy.DESTROY
  })
  const lambda_athena_path = `${__dirname}/lambda/athena`
  const lambda_athena = new Function(this, 'AthenaFunction', {
        functionName: `garnet-lake-athena-lambda`,
        description: 'Garnet Lake  - Function that creates Athena resources',
        logGroup: lambda_athena_log,
        runtime: Runtime.NODEJS_20_X,
        code: Code.fromAsset(lambda_athena_path),
        handler: 'index.handler',
        timeout: Duration.seconds(50),
        architecture: Architecture.ARM_64,
        environment: {
          BUCKET_NAME_ATHENA: garnet_bucket_athena,
          CATALOG_ID: Aws.ACCOUNT_ID,
          GLUEDB_NAME: garnet_constant.gluedbName
        }
  })
  lambda_athena.node.addDependency(lambda_athena_log)
  lambda_athena.addToRolePolicy(new PolicyStatement({
      actions: [
          "athena:CreateWorkGroup",
          "glue:CreateDatabase"
      ],
      resources: ["*"] 
      }))

  const athena_provider_log = new LogGroup(this, 'LambdaAthenaProviderLogs', {
    retention: RetentionDays.ONE_MONTH,
    // logGroupName: `garnet-provider-custom-athena-lambda-cw-logs`,
    removalPolicy: RemovalPolicy.DESTROY
})

  const athena_provider = new Provider(this, 'AthenaProvider', {
    onEventHandler: lambda_athena,
    providerFunctionName:  `garnet-custom-provider-athena-lambda`,
    logGroup: athena_provider_log
  }) 
  athena_provider.node.addDependency(athena_provider_log)
  const athena_resource = new CustomResource(this, 'CustomBucketAthenaResource', {
      serviceToken: athena_provider.serviceToken,
      
  })


    }
}