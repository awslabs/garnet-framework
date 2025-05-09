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


          // LAMBDA LAYER (SHARED LIBRARIES)
        const layer_lambda_path = `./lib/layers`;
        const layer_lambda = new LayerVersion(this, "LayerLambda", {
          code: Code.fromAsset(layer_lambda_path),
          compatibleRuntimes: [Runtime.NODEJS_22_X],
        })
    

       // THING GROUP MEMBERSHIP 

       let event_param = {
        eventConfigurations: { 
          "THING_GROUP_MEMBERSHIP": { 
            Enabled: true 
          },
          "THING_GROUP": {
            "Enabled": true
          },
          "THING_GROUP_HIERARCHY": {
            "Enabled": true
          }
        }
       }

       const garnet_iot_custom_thing_event_log = new LogGroup(this, 'CustomIotUpdateGroupMembershipLogs', {
        retention: RetentionDays.ONE_MONTH,
        removalPolicy: RemovalPolicy.DESTROY
        })

      const iot_event = new AwsCustomResource(this, 'CustomIotUpdateGroupMembership', {
      functionName: `garnet-iot-custom-updating-group-event`,
        onCreate: {
          service: 'Iot',
          action: 'UpdateEventConfigurations',
          physicalResourceId: PhysicalResourceId.of(Date.now().toString()),
          parameters: event_param
        },
        onUpdate: {
          service: 'Iot',
          action: 'UpdateEventConfigurations',
          physicalResourceId: PhysicalResourceId.of(Date.now().toString()),
          parameters: event_param
        },
        logGroup: garnet_iot_custom_thing_event_log,
        policy: AwsCustomResourcePolicy.fromSdkCalls({resources: AwsCustomResourcePolicy.ANY_RESOURCE})
      })

      //iot_event.node.addDependency(garnet_iot_custom_thing_event_log)


    // LAMBDA TO UPDATE BROKER WITH GROUP MEMBERSHIP
    const lambda_update_group_membership_log = new LogGroup(this, 'LambdaUpdateGroupThingLogs', {
      retention: RetentionDays.ONE_MONTH,
      removalPolicy: RemovalPolicy.DESTROY
    })
    const lambda_update_group_membership_path = `${__dirname}/lambda/groupMembership`;
    const lambda_update_group_membership = new Function(this, "LambdaUpdateGroupThing", {
      functionName: garnet_nomenclature.garnet_iot_group_lambda,
      description: 'Garnet IoT Things Group- Function that updates Things Group membership for Things',
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
        AWSIOTTHINGTYPE: garnet_nomenclature.aws_iot_thing
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

    // IOT RULE THAT LISTENS TO CHANGES IN GROUP MEMBERSHIP AND PUSH TO LAMBDA
    const iot_rule_group_membership = new CfnTopicRule(this, "IoTRuleGroupMembership", {
      ruleName: `garnet_iot_group_membership_rule`,
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

    // GRANT IOT RULE PERMISSION TO INVOKE MODELING LAMBDA
    new CfnPermission(this, 'LambdaGroupthingPermissionIotRule', {
      principal: `iot.amazonaws.com`,
      action: 'lambda:InvokeFunction',
      functionName: lambda_update_group_membership.functionName,
      sourceArn: `${iot_rule_group_membership.attrArn}`
    })


    }
}