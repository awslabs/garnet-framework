import { Construct } from "constructs";
import { azlist, scorpiobroker_sqs_object, garnet_constant } from "../constants"
import { Aws, CfnOutput, CustomResource, Duration, Names, Stack } from "aws-cdk-lib";
import { Code, Runtime, Function, Architecture } from "aws-cdk-lib/aws-lambda";
import { PolicyStatement } from "aws-cdk-lib/aws-iam";
import { Provider } from "aws-cdk-lib/custom-resources";
import { Parameters } from "../../../../parameters";
import { DatabaseInstanceEngine, ParameterGroup, PostgresEngineVersion } from "aws-cdk-lib/aws-rds";
import { EngineVersion } from "aws-cdk-lib/aws-opensearchservice";

export interface GarnetUtilProps {}

export class Utils extends Construct { 

    public readonly az1: string
    public readonly az2: string
    public readonly rds_parameter_group: string

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
    
        const get_az_func_path = `${__dirname}/lambda/getAzs`
        const get_az_func = new Function(this, 'AzFunction', {
            functionName: `garnet-utils-az-lambda`,
              description: 'Garnet Utils - Function that checks if which AZs the stack can be deployed for HTTP VPC Link and IoT VPC Endpoint service availability', 
              runtime: Runtime.NODEJS_20_X,
              code: Code.fromAsset(get_az_func_path),
              handler: 'index.handler',
              timeout: Duration.seconds(50),
              architecture: Architecture.ARM_64,
              environment: {
                COMPATIBLE_AZS: JSON.stringify(compatible_azs)
              }
        })
        get_az_func.addToRolePolicy(new PolicyStatement({
          actions: [
            "ec2:DescribeAvailabilityZones",
            "ec2:DescribeVpcEndpointServices"
          ],
          resources: ['*'] 
          }))
      
          const get_az_provider = new Provider(this, 'getAzCleanUpprovider', {
          onEventHandler: get_az_func,
          providerFunctionName: `garnet-provider-utils-az`
        }) 
        
        const get_az = new CustomResource(this, 'getAzCustomResource', {
          serviceToken: get_az_provider.serviceToken
        })

        this.az1 = get_az.getAtt('az1').toString()
        this.az2 = get_az.getAtt('az2').toString()


        // RDS PARAMETER GROUP 
        const parameter_rds_lambda_path = `${__dirname}/lambda/parameterRds`
        const parameter_rds_lambda = new Function(this, 'CustomParameterRdsLambda', {
          functionName: `garnet-custom-parameter-group-rds-lambda`,
          description: 'Garnet Custom - Function that creates a parameter group for db disabling tls', 
            runtime: Runtime.NODEJS_20_X,
            code: Code.fromAsset(parameter_rds_lambda_path),
            handler: 'index.handler',
            timeout: Duration.seconds(50),
            architecture: Architecture.ARM_64,
            environment: {
              DBParameterGroupName: garnet_constant.DBParameterGroupName,
              DBParameterGroupFamily: garnet_constant.DBParameterGroupFamily
            }
      })
      parameter_rds_lambda.addToRolePolicy(new PolicyStatement({
        actions: [				
            "rds:CreateDBParameterGroup",
            "rds:ModifyDBParameterGroup",
            "rds:DescribeDBParameterGroups",
            "rds:DeleteDBParameterGroup"
        ],
        resources: [`*`] 
        }))

        const parameter_rds_provider = new Provider(this, 'parameterRdsProvider', {
        onEventHandler: parameter_rds_lambda,
        providerFunctionName: `garnet-provider-utils-parameter-rds`
      }) 
      
      const parameter_rds_resource = new CustomResource(this, 'parameterRdsCustomResource', {
        serviceToken: parameter_rds_provider.serviceToken
      })

      this.rds_parameter_group = parameter_rds_resource.getAtt('name').toString()
      
      // CLEAN SQS QUEUES CREATED BY SCORPIO BROKER 
      if(Parameters.garnet_broker == 'Scorpio'){

        let sqs_urls = Object.values(scorpiobroker_sqs_object).map(q => `https://sqs.${Aws.REGION}.amazonaws.com/${Aws.ACCOUNT_ID}/${q}`)

        const scorpio_sqs_lambda_path = `${__dirname}/lambda/scorpioSqs`
        const scorpio_sqs_lambda = new Function(this, 'ScorpioSqsFunction', {
          functionName: `garnet-utils-scorpio-sqs-lambda`,
          description: 'Garnet Utils - Function that deletes the SQS Queue created by the Scorpio Context Broker', 
            runtime: Runtime.NODEJS_20_X,
            code: Code.fromAsset(scorpio_sqs_lambda_path),
            handler: 'index.handler',
            timeout: Duration.seconds(50),
            architecture: Architecture.ARM_64,
            environment: {
              SQS_QUEUES: JSON.stringify(sqs_urls)
            }
      })
      scorpio_sqs_lambda.addToRolePolicy(new PolicyStatement({
        actions: ["sqs:DeleteQueue"],
        resources: [`arn:aws:sqs:${Aws.REGION}:${Aws.ACCOUNT_ID}:garnet-scorpiobroker-*`] 
        }))
    
        const scorpio_sqs_provider = new Provider(this, 'scorpioSqsProvider', {
        onEventHandler: scorpio_sqs_lambda,
        providerFunctionName: `garnet-provider-utils-scorpio-sqs`
      }) 
      
      const scorpio_sqs_resource = new CustomResource(this, 'scorpioSqsCustomResource', {
        serviceToken: scorpio_sqs_provider.serviceToken
      })

      }


      // CLEAN INACTIVE GARNET TASK DEFINITION IN ECS
        const clean_ecs_lambda_path = `${__dirname}/lambda/cleanTasks`
        const clean_ecs_lambda = new Function(this, 'CleanEcsFunction', {
          functionName: `garnet-utils-clean-ecs-lambda`,
            description: 'Garnet Utils - Function that removes unactive ECS task definitions',
            runtime: Runtime.NODEJS_20_X,
            code: Code.fromAsset(clean_ecs_lambda_path),
            handler: 'index.handler',
            timeout: Duration.seconds(50),
            architecture: Architecture.ARM_64,
            environment: {
            }
      })
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
    
        const clean_ecs_provider = new Provider(this, 'cleanEcsProvider', {
        onEventHandler: clean_ecs_lambda,
        providerFunctionName: `garnet-provider-utils-clean-ecs`
      }) 
      
      const scorpio_sqs_resource = new CustomResource(this, 'cleanEcsCustomResource', {
        serviceToken: clean_ecs_provider.serviceToken
      })


      
    }
}
