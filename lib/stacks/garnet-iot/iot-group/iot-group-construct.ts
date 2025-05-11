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
 * https://docs.aws.amazon.com/iot/latest/developerguide/registry-events.html#registry-events-thinggroup
 */

export interface GarnetIotGroupProps {
  vpc: Vpc, 
  dns_context_broker: string
}

export class GarnetIotGroup extends Construct {
  
    public readonly private_sub_endpoint: string
  
    constructor(scope: Construct, id: string, props: GarnetIotGroupProps) {
      super(scope, id)

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


         /*
          *  SHARED LIBRARIES
          */
        const layer_lambda_path = `./lib/layers`;
        const layer_lambda = new LayerVersion(this, "GarnetIoTSharedLayer", {
          code: Code.fromAsset(layer_lambda_path),
          compatibleRuntimes: [Runtime.NODEJS_22_X],
        })

        /////////////////////////////////////////////

       /*
        *  THING GROUP MEMBERSHIP 
        */

        // LAMBDA TO UPDATE BROKER WITH GROUP MEMBERSHIP
        const lambda_update_group_membership_log = new LogGroup(this, 'GarnetIoTGroupMembershipLambdaLogs', {
          retention: RetentionDays.ONE_MONTH,
          removalPolicy: RemovalPolicy.DESTROY
        })
        const lambda_update_group_membership_path = `${__dirname}/lambda/groupMembership`;
        const lambda_update_group_membership = new Function(this, "GarnetIoTGroupMembershipLambda", {
          functionName: `${garnet_nomenclature.garnet_iot_group_membership_lambda}`,
          description: 'Garnet Sync AWS IoT Things Group- Function that updates Things Group membership for Things',
          vpc: props.vpc,
          vpcSubnets: {
            subnetType: SubnetType.PRIVATE_WITH_EGRESS,
          },
          runtime: Runtime.NODEJS_22_X,
          layers: [layer_lambda],
          code: Code.fromAsset(lambda_update_group_membership_path),
          handler: "index.handler",
          timeout: Duration.seconds(50),
          logGroup: lambda_update_group_membership_log,
          architecture: Architecture.ARM_64,
          environment: {
            DNS_CONTEXT_BROKER: props.dns_context_broker,
            AWSIOTTHINGTYPE: garnet_nomenclature.aws_iot_thing,
            AWSIOTTHINGGROUPTYPE: garnet_nomenclature.aws_iot_thing_group
          }
        })

        lambda_update_group_membership.node.addDependency(lambda_update_group_membership_log)
 
        lambda_update_group_membership.addToRolePolicy(
          new PolicyStatement({
            actions: ["iot:ListThingGroupsForThing"],
            resources: [
              `arn:aws:iot:${Aws.REGION}:${Aws.ACCOUNT_ID}:thing/*`,
            ]
          })
        )

        // IOT RULE FOR GROUP MEMBERSHIP EVENTS
        const iot_rule_group_membership = new CfnTopicRule(this, "GarnetIoTGroupMembershipRule", {
          ruleName: `garnet_iot_thing_group_membership_rule`,
          topicRulePayload: {
            awsIotSqlVersion: "2016-03-23",
            ruleDisabled: false,
            sql: `SELECT *, topic(7) as thingName, topic(5) as thingGroup from '$aws/events/thingGroupMembership/thingGroup/+/thing/+/+'`,
            actions: [
              {
                lambda: {
                  functionArn: lambda_update_group_membership.functionArn
                }
              }
            ]
          }
        })

        // GRANT IOT RULE PERMISSION TO INVOKE LAMBDA
        new CfnPermission(this, 'GarnetIoTGroupMembershipLambdaPermission', {
          principal: `iot.amazonaws.com`,
          action: 'lambda:InvokeFunction',
          functionName: lambda_update_group_membership.functionName,
          sourceArn: `${iot_rule_group_membership.attrArn}`
        })

        /*
         *  END THING GROUP MEMBERSHIP 
         */


        /*
         *  THING GROUP LIFECYCLE 
         */

        // LAMBDA TO HANDLE THING GROUP CREATION/DELETION
        const lambda_group_lifecyle_log = new LogGroup(this, 'GarnetIoTGroupLifecycleLambdaLogs', {
          retention: RetentionDays.ONE_MONTH,
          removalPolicy: RemovalPolicy.DESTROY
        })
        const lambda_group_lifecycle_path = `${__dirname}/lambda/groupLifecycle`;
        const lambda_group_lifecyle = new Function(this, "GarnetIoTGroupLifecycleLambda", {
          functionName: `${garnet_nomenclature.garnet_iot_group_lifecycle_lambda}`,
          description: 'Garnet AWS IoT Things Group Sync - Function that handles Thing Group lifecycle',
          vpc: props.vpc,
          vpcSubnets: {
            subnetType: SubnetType.PRIVATE_WITH_EGRESS,
          },
          runtime: Runtime.NODEJS_22_X,
          layers: [layer_lambda],
          code: Code.fromAsset(lambda_group_lifecycle_path),
          handler: "index.handler",
          timeout: Duration.seconds(50),
          logGroup: lambda_group_lifecyle_log,
          architecture: Architecture.ARM_64,
          environment: {
            DNS_CONTEXT_BROKER: props.dns_context_broker,
            AWSIOTTHINGGROUPTYPE: garnet_nomenclature.aws_iot_thing_group
          }
        })
        lambda_group_lifecyle.node.addDependency(lambda_group_lifecyle_log)

        // IOT RULE FOR GROUP LIFECYCLE EVENTS
        const iot_rule_group_lifecycle = new CfnTopicRule(this, "GarnetIoTGroupLifecycleRule", {
          ruleName: `garnet_iot_thing_group_lifecycle_rule`,
          topicRulePayload: {
            awsIotSqlVersion: "2016-03-23",
            ruleDisabled: false,
            sql: `SELECT * from '$aws/events/thingGroup/#'`,
            actions: [
              {
                lambda: {
                  functionArn: lambda_group_lifecyle.functionArn
                }
              }
            ]
          }
        })

        // GRANT IOT RULE PERMISSION TO INVOKE LAMBDA
        new CfnPermission(this, 'GarnetIoTGroupLifecycleLambdaPermission', {
          principal: `iot.amazonaws.com`,
          action: 'lambda:InvokeFunction',
          functionName: lambda_group_lifecyle.functionName,
          sourceArn: `${iot_rule_group_lifecycle.attrArn}`
        })

        /*
         *  END THING GROUP LIFECYCLE 
         */

    }
}
