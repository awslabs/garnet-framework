import { Construct } from "constructs";
import { azlist, garnet_constant, garnet_nomenclature, scorpiobroker_sqs_object } from "../../../../constants"
import { Aws, CustomResource, Duration, RemovalPolicy, Stack } from "aws-cdk-lib";
import { Code, Runtime, Function, Architecture } from "aws-cdk-lib/aws-lambda";
import { PolicyStatement } from "aws-cdk-lib/aws-iam";
import { Provider } from "aws-cdk-lib/custom-resources";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";

export interface GarnetUtilProps {}

export class Utils extends Construct { 

    public readonly az1: string
    public readonly az2: string

    constructor(scope: Construct, id: string, props?: GarnetUtilProps) {
        super(scope, id)


        // CHECK THE AZs TO DEPLOY GARNET 
        
        if(Stack.of(this).region.startsWith('$')){
          throw new Error('Please type a valid region in the parameter.ts file')
        }

        if(!azlist[`${Stack.of(this).region}`]){
            throw new Error('The stack is not yet available in the region selected')
          }
    
        const compatible_azs = azlist[`${Stack.of(this).region}`]
    
        const get_az_lambda_log = new LogGroup(this, 'LambdaAzFunctionLogs', {
          retention: RetentionDays.ONE_MONTH,
          removalPolicy: RemovalPolicy.DESTROY
        })
        const get_az_func_path = `${__dirname}/lambda/getAzs`
        const get_az_func = new Function(this, 'AzFunction', {
            functionName: garnet_nomenclature.garnet_utils_az_lambda,
              description: 'Garnet Utils - Function that checks if which AZs the stack can be deployed for HTTP VPC Link and IoT VPC Endpoint service availability', 
              runtime: Runtime.NODEJS_22_X,
              logGroup: get_az_lambda_log,
              code: Code.fromAsset(get_az_func_path),
              handler: 'index.handler',
              timeout: Duration.seconds(50),
              architecture: Architecture.ARM_64,
              environment: {
                COMPATIBLE_AZS: JSON.stringify(compatible_azs)
              }
        })

        get_az_func.node.addDependency(get_az_lambda_log)
        get_az_func.addToRolePolicy(new PolicyStatement({
          actions: [
            "ec2:DescribeAvailabilityZones",
            "ec2:DescribeVpcEndpointServices"
          ],
          resources: ['*'] 
          }))

          const get_az_log = new LogGroup(this, 'getAzCleanUpProviderLogs', {
            retention: RetentionDays.ONE_MONTH,
            // logGroupName: `garnet-provider-utils-az-lambda-cw-logs`,
            removalPolicy: RemovalPolicy.DESTROY
        })
      
          const get_az_provider = new Provider(this, 'getAzCleanUpprovider', {
          onEventHandler: get_az_func,
          providerFunctionName: `${garnet_nomenclature.garnet_utils_az_lambda}-provider`,
          logGroup: get_az_log
        }) 
        get_az_provider.node.addDependency(get_az_log)
        
        const get_az = new CustomResource(this, 'getAzCustomResource', {
          serviceToken: get_az_provider.serviceToken
        })

        this.az1 = get_az.getAtt('az1').toString()
        this.az2 = get_az.getAtt('az2').toString()
      
      // CLEAN SQS QUEUES CREATED BY SCORPIO BROKER 

        let sqs_urls = Object.values(scorpiobroker_sqs_object).map(q => `https://sqs.${Aws.REGION}.amazonaws.com/${Aws.ACCOUNT_ID}/${q}`)

        const scorpio_sqs_lambda_log = new LogGroup(this, 'LambdaScorpioSqsFunctionLogs', {
          retention: RetentionDays.ONE_MONTH,
          // logGroupName: `garnet-utils-scorpio-sqs-lambda-cw-logs`,
          removalPolicy: RemovalPolicy.DESTROY
        })
        const scorpio_sqs_lambda_path = `${__dirname}/lambda/scorpioSqs`
        const scorpio_sqs_lambda = new Function(this, 'ScorpioCleanSqsFunction', {
          functionName: garnet_nomenclature.garnet_utils_scorpio_sqs_lambda,
          description: 'Garnet Utils - Function that deletes the SQS Queue created by the Scorpio Context Broker', 
            runtime: Runtime.NODEJS_22_X,
            logGroup: scorpio_sqs_lambda_log, 
            code: Code.fromAsset(scorpio_sqs_lambda_path),
            handler: 'index.handler',
            timeout: Duration.seconds(50),
            architecture: Architecture.ARM_64,
            environment: {
              SQS_QUEUES: JSON.stringify(sqs_urls)
            }
      })
      scorpio_sqs_lambda.node.addDependency(scorpio_sqs_lambda_log)
      scorpio_sqs_lambda.addToRolePolicy(new PolicyStatement({
        actions: ["sqs:DeleteQueue"],
        resources: [`arn:aws:sqs:${Aws.REGION}:${Aws.ACCOUNT_ID}:garnet-scorpiobroker-*`] 
        }))

        const scorpio_sqs_provider_log = new LogGroup(this, 'LambdaScorpioSqsProviderLogs', {
          retention: RetentionDays.ONE_MONTH,
          // logGroupName: `garnet-provider-utils-scorpio-sqs-lambda-cw-logs`,
          removalPolicy: RemovalPolicy.DESTROY
      })
    
        const scorpio_sqs_provider = new Provider(this, 'scorpioSqsProvider', {
        onEventHandler: scorpio_sqs_lambda,
        providerFunctionName: `${garnet_nomenclature.garnet_utils_scorpio_sqs_lambda}-provider`,
        logGroup: scorpio_sqs_provider_log
      }) 
      scorpio_sqs_provider.node.addDependency(scorpio_sqs_provider_log)
      new CustomResource(this, 'scorpioSqsCustomResource', {
        serviceToken: scorpio_sqs_provider.serviceToken
      })


      // CLEAN INACTIVE GARNET TASK DEFINITION IN ECS
        const clean_ecs_lambda_log = new LogGroup(this, 'LambdaCleanEcsFunctionLogs', {
          retention: RetentionDays.ONE_MONTH,
          // logGroupName: `garnet-utils-clean-ecs-lambda-cw-logs`,
          removalPolicy: RemovalPolicy.DESTROY
        })
        const clean_ecs_lambda_path = `${__dirname}/lambda/cleanTasks`
        const clean_ecs_lambda = new Function(this, 'CleanEcsFunction', {
          functionName: garnet_nomenclature.garnet_utils_clean_ecs_taks_lambda,
            description: 'Garnet Utils - Function that removes unactive ECS task definitions',
            runtime: Runtime.NODEJS_22_X,
            logGroup: clean_ecs_lambda_log,
            code: Code.fromAsset(clean_ecs_lambda_path),
            handler: 'index.handler',
            timeout: Duration.seconds(50),
            architecture: Architecture.ARM_64,
            environment: {
            }
      })
      clean_ecs_lambda.node.addDependency(clean_ecs_lambda_log)
      clean_ecs_lambda.addToRolePolicy(new PolicyStatement({
        actions: [
          "ecs:RegisterTaskDefinition",
          "ecs:ListTaskDefinitions",
          "ecs:DescribeTaskDefinition"
        ],
        resources: [`*`] 
        }))

      clean_ecs_lambda.addToRolePolicy(new PolicyStatement({
        actions: [
          "ecs:DeleteTaskDefinition"
        ],
        resources: [`arn:aws:ecs:${Aws.REGION}:${Aws.ACCOUNT_ID}:task-definition/Garnet*`] 
        }))
    

        const clean_ecs_logs = new LogGroup(this, 'LambdacleanEcsProviderLogs', {
          retention: RetentionDays.ONE_MONTH,
          // logGroupName: `garnet-provider-utils-clean-ecs-lambda-cw-logs`,
          removalPolicy: RemovalPolicy.DESTROY
      })

        const clean_ecs_provider = new Provider(this, 'cleanEcsProvider', {
        onEventHandler: clean_ecs_lambda,
        providerFunctionName: `${garnet_nomenclature.garnet_utils_clean_ecs_taks_lambda}-provider`,
        logGroup: clean_ecs_logs
      }) 
      clean_ecs_provider.node.addDependency(clean_ecs_logs)
      const scorpio_sqs_resource = new CustomResource(this, 'cleanEcsCustomResource', {
        serviceToken: clean_ecs_provider.serviceToken
      })


      
    }
}
