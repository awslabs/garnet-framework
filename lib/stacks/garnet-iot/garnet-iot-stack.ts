import { NestedStack, NestedStackProps, RemovalPolicy} from "aws-cdk-lib";
import { Construct } from "constructs"
import { GarnetIotGroup } from "./iot-group/iot-group-construct";
import { GarnetIotThing } from "./iot-thing/iot-thing-construct";
import { Vpc } from "aws-cdk-lib/aws-ec2";
import { AwsCustomResource, AwsCustomResourcePolicy, PhysicalResourceId } from "aws-cdk-lib/custom-resources";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import { garnet_resource_name } from "../../../constants";

export interface GarnetIotProps extends NestedStackProps {
    vpc: Vpc, 
    dns_context_broker: string,
    tenant: string
}

export class GarnetIot extends NestedStack {
    constructor(scope: Construct, id: string, props: GarnetIotProps) {
      super(scope, id, props)



        /*
         *  EVENT CONFIGURATION
         */

        const event_param = {
         eventConfigurations: { 
          "THING": {
            "Enabled": true
          },
          "THING_GROUP": {
            "Enabled": true
          },
           "THING_GROUP_MEMBERSHIP": { 
             Enabled: true 
           },
           "THING_GROUP_HIERARCHY": {
             "Enabled": true
           },
           "POLICY": {
            "Enabled": true
           },
           "CERTIFICATE": {
            "Enabled": true
           }
         }
        }
    
        const garnet_iot_custom_thinggroup_event_log = new LogGroup(this, 'GarnetIoTEventConfigLogs', {
         retention: RetentionDays.ONE_MONTH,
         removalPolicy: RemovalPolicy.DESTROY
         })
 
       new AwsCustomResource(this, 'GarnetIoTEventConfig', {
       functionName: garnet_resource_name("iot-event-config"),
         onCreate: {
           service: 'Iot',
           action: 'UpdateEventConfigurations',
           physicalResourceId: PhysicalResourceId.of(
             "garnet-framework-iot-event-configuration"
           ),
           parameters: event_param
         },
         onUpdate: {
           service: 'Iot',
           action: 'UpdateEventConfigurations',
           physicalResourceId: PhysicalResourceId.of(
             "garnet-framework-iot-event-configuration"
           ),
           parameters: event_param
         },
         logGroup: garnet_iot_custom_thinggroup_event_log,
         policy: AwsCustomResourcePolicy.fromSdkCalls({resources: AwsCustomResourcePolicy.ANY_RESOURCE})
       })

       /*
        *  END EVENT CONFIGURATION
        */



      new GarnetIotGroup(this, 'GarnetIotGroup', {
        vpc: props.vpc,
        dns_context_broker: props.dns_context_broker,
        tenant: props.tenant
      })
      new GarnetIotThing(this, 'GarnetIotThing',{
        vpc: props.vpc,
        dns_context_broker: props.dns_context_broker,
        tenant: props.tenant
      })
    }
}
