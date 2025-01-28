import { Aws, Duration, Names, RemovalPolicy } from "aws-cdk-lib";
import { Runtime, Function, Code, Architecture, LayerVersion, CfnPermission } from "aws-cdk-lib/aws-lambda";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import { Queue } from "aws-cdk-lib/aws-sqs";
import { Construct } from "constructs"
import { PolicyStatement, Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { SqsEventSource } from "aws-cdk-lib/aws-lambda-event-sources";
import { CfnTopicRule } from "aws-cdk-lib/aws-iot";
import { AwsCustomResource, AwsCustomResourcePolicy, PhysicalResourceId } from "aws-cdk-lib/custom-resources";
import { garnet_constant, garnet_nomenclature } from "../../../../constants";

export interface GarnetIotThingProps {
  sqs_ingestion_endpoint: string
}

export class GarnetIotThing extends Construct {
  
    public readonly private_sub_endpoint: string
  
    constructor(scope: Construct, id: string, props?: GarnetIotThingProps) {
      super(scope, id)


          // LAMBDA LAYER (SHARED LIBRARIES)
        const layer_lambda_path = `./lib/layers`;
        const layer_lambda = new LayerVersion(this, "LayerLambda", {
          code: Code.fromAsset(layer_lambda_path),
          compatibleRuntimes: [Runtime.NODEJS_20_X],
        })
    

        //  CONNECTIVITY STATUS 


        // SQS ENTRY POINT CONNECTIVITY STATUS 
        const sqs_garnet_iot_presence = new Queue(this, "SqsGarnetPresenceThing", {
          queueName: garnet_nomenclature.garnet_iot_presence_queue, 
          visibilityTimeout: Duration.seconds(55)
        })

    
        // LAMBDA TO PUSH IN QUEUE WITH CONNECTIVITY STATUS
        const lambda_update_shadow_presence_log = new LogGroup(this, 'LambdaUpdatePresenceThingLogs', {
          retention: RetentionDays.ONE_MONTH,
          // logGroupName: `${garnet_nomenclature.garnet_iot_presence_shadow_lambda}-logs`,
          removalPolicy: RemovalPolicy.DESTROY
        })
        const lambda_update_shadow_presence_path = `${__dirname}/lambda/presence`;
        const lambda_update_shadow_presence = new Function(this, "LambdaUpdatePresenceThing", {
          functionName: garnet_nomenclature.garnet_iot_presence_shadow_lambda,
          description: 'Garnet IoT Things Presence- Function that updates presence for Iot MQTT connected things',
          runtime: Runtime.NODEJS_20_X,
          layers: [layer_lambda],
          code: Code.fromAsset(lambda_update_shadow_presence_path),
          handler: "index.handler",
          timeout: Duration.seconds(50),
          logGroup: lambda_update_shadow_presence_log,
          architecture: Architecture.ARM_64,
          environment: {
            AWSIOTREGION: Aws.REGION,
            SHADOW_PREFIX: garnet_constant.shadow_prefix,
            AWSIOTTHINGTYPE: garnet_nomenclature.aws_iot_thing
          }
        })
        lambda_update_shadow_presence.node.addDependency(lambda_update_shadow_presence_log)
        // ADD PERMISSION FOR LAMBDA THAT UPDATES SHADOW TO ACCESS SQS ENTRY POINT
        lambda_update_shadow_presence.addToRolePolicy(
          new PolicyStatement({
            actions: [
              "sqs:ReceiveMessage",
              "sqs:DeleteMessage",
              "sqs:GetQueueAttributes",
            ],
            resources: [`${sqs_garnet_iot_presence.queueArn}`],
          })
        )

        // ADD PERMISSION TO ACCESS AWS IoT DEVICE SHADOW
        lambda_update_shadow_presence.addToRolePolicy(
          new PolicyStatement({
            actions: ["iot:UpdateThingShadow"],
            resources: [
              `arn:aws:iot:${Aws.REGION}:${Aws.ACCOUNT_ID}:thing/*/${garnet_constant.shadow_prefix}-*`,
            ],
          })
        )

        // ADD THE SQS  AS EVENT SOURCE FOR LAMBDA
        lambda_update_shadow_presence.addEventSource(
          new SqsEventSource(sqs_garnet_iot_presence, { batchSize: 10 })
        )
    
        // ROLE THAT GRANT ACCESS TO IOT RULE TO ACTIONS
        const iot_rule_actions_role = new Role(this, "RoleGarnetIotRulePresence", {
          assumedBy: new ServicePrincipal("iot.amazonaws.com"),
        })

        iot_rule_actions_role.addToPolicy(
          new PolicyStatement({
            resources: [
              `${sqs_garnet_iot_presence.queueArn}`
            ],
            actions: [
              "sqs:SendMessage"
            ],
          })
        )


      // IOT RULE THAT LISTENS TO CHANGES IN IoT PRESENCE AND PUSH TO SQS
      const iot_rule = new CfnTopicRule(this, "IoTRulePresence", {
        ruleName: garnet_nomenclature.garnet_iot_presence_rule,
        topicRulePayload: {
          awsIotSqlVersion: "2016-03-23",
          ruleDisabled: false,
          sql: `SELECT * from '$aws/events/presence/#'`,
          actions: [
            {
              sqs: {
                queueUrl: sqs_garnet_iot_presence.queueUrl,
                roleArn: iot_rule_actions_role.roleArn,
              },
            }
          ],
        },
      })
    
       // END CONNECTIVITY STATUS 
    
    }
}