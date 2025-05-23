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
import { SubnetType, Vpc } from "aws-cdk-lib/aws-ec2";
import { Parameters } from "../../../../configuration";

/***
 * https://docs.aws.amazon.com/iot/latest/developerguide/registry-events.html#registry-events-thing
 */


export interface GarnetIotThingProps {
    vpc: Vpc, 
    dns_context_broker: string
}

export class GarnetIotThing extends Construct {
  
    public readonly private_sub_endpoint: string
  
    constructor(scope: Construct, id: string, props: GarnetIotThingProps) {
      super(scope, id)


          // LAMBDA LAYER (SHARED LIBRARIES)
        const layer_lambda_path = `./lib/layers`;
        const layer_lambda = new LayerVersion(this, "LayerLambda", {
          code: Code.fromAsset(layer_lambda_path),
          compatibleRuntimes: [Runtime.NODEJS_22_X],
        })
    

        //  CONNECTIVITY STATUS 


        // SQS ENTRY POINT CONNECTIVITY STATUS 
        const sqs_garnet_iot_presence = new Queue(this, "SqsGarnetPresenceThing", {
          queueName: garnet_nomenclature.garnet_iot_presence_queue, 
          visibilityTimeout: Duration.seconds(55)
        })

    
        // LAMBDA TO PUSH IN QUEUE WITH CONNECTIVITY STATUS
        const lambda_update_presence_log = new LogGroup(this, 'LambdaUpdatePresenceThingLogs', {
          retention: RetentionDays.ONE_MONTH,
          // logGroupName: `${garnet_nomenclature.garnet_iot_presence_shadow_lambda}-logs`,
          removalPolicy: RemovalPolicy.DESTROY
        })
        const lambda_update_presence_path = `${__dirname}/lambda/presence`;
        const lambda_update_presence = new Function(this, "LambdaUpdatePresenceThing", {
          functionName: garnet_nomenclature.garnet_iot_presence_lambda,
          description: 'Garnet IoT Things Presence- Function that updates presence for Iot MQTT connected things',
                vpc: props.vpc,
                vpcSubnets: {
                  subnetType: SubnetType.PRIVATE_WITH_EGRESS,
                },
          runtime: Runtime.NODEJS_22_X,
          layers: [layer_lambda],
          code: Code.fromAsset(lambda_update_presence_path),
          handler: "index.handler",
          timeout: Duration.seconds(50),
          logGroup: lambda_update_presence_log,
          architecture: Architecture.ARM_64,
          environment: {
             DNS_CONTEXT_BROKER: props.dns_context_broker,
             AWSIOTTHINGTYPE: garnet_nomenclature.aws_iot_thing
          }
        })
        lambda_update_presence.node.addDependency(lambda_update_presence_log)
        // ADD PERMISSION FOR LAMBDA THAT UPDATES SHADOW TO ACCESS SQS ENTRY POINT
        lambda_update_presence.addToRolePolicy(
          new PolicyStatement({
            actions: [
              "sqs:ReceiveMessage",
              "sqs:DeleteMessage",
              "sqs:GetQueueAttributes"
            ],
            resources: [`${sqs_garnet_iot_presence.queueArn}`],
          })
        )

        // ADD THE SQS AS EVENT SOURCE FOR LAMBDA
        lambda_update_presence.addEventSource(
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




       /*
         *  THING LIFECYCLE 
         */

        // LAMBDA TO HANDLE THING CREATION/DELETION
        const lambda_thing_lifecyle_log = new LogGroup(this, 'GarnetIotThingLifecycleLambdaLogs', {
          retention: RetentionDays.ONE_MONTH,
          removalPolicy: RemovalPolicy.DESTROY
        })
        const lambda_thing_lifecycle_path = `${__dirname}/lambda/thingLifecycle`;
        const lambda_thing_lifecyle = new Function(this, "GarnetIotThingLifecycleLambda", {
          functionName: `${garnet_nomenclature.garnet_iot_lifecycle_lambda}`,
          description: 'Garnet AWS IoT Things  Sync - Function that handles Thing lifecycle',
          vpc: props.vpc,
          vpcSubnets: {
            subnetType: SubnetType.PRIVATE_WITH_EGRESS,
          },
          runtime: Runtime.NODEJS_22_X,
          layers: [layer_lambda],
          code: Code.fromAsset(lambda_thing_lifecycle_path),
          handler: "index.handler",
          timeout: Duration.seconds(50),
          logGroup: lambda_thing_lifecyle_log,
          architecture: Architecture.ARM_64,
          environment: {
            DNS_CONTEXT_BROKER: props.dns_context_broker,
            AWSIOTTHINGTYPE: garnet_nomenclature.aws_iot_thing
          }
        })
        lambda_thing_lifecyle.node.addDependency(lambda_thing_lifecyle_log)

        // IOT RULE FOR THING LIFECYCLE EVENTS
        const iot_rule_thing_lifecycle = new CfnTopicRule(this, "GarnetIotThingLifecycleRule", {
          ruleName: `garnet_iot_thing_lifecycle_rule`,
          topicRulePayload: {
            awsIotSqlVersion: "2016-03-23",
            ruleDisabled: false,
            sql: `SELECT * from '$aws/events/thing/#'`,
            actions: [
              {
                lambda: {
                  functionArn: lambda_thing_lifecyle.functionArn
                }
              }
            ]
          }
        })

        // GRANT IOT RULE PERMISSION TO INVOKE LAMBDA
        new CfnPermission(this, 'GarnetIotThingLifecycleLambdaPermission', {
          principal: `iot.amazonaws.com`,
          action: 'lambda:InvokeFunction',
          functionName: lambda_thing_lifecyle.functionName,
          sourceArn: `${iot_rule_thing_lifecycle.attrArn}`
        })

        /*
         *  END THING LIFECYCLE 
         */
    
    }
}