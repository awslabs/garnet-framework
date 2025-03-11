import { NestedStack, NestedStackProps} from "aws-cdk-lib";
import { Construct } from "constructs"
import { GarnetIotGroup } from "./iot-group";
import { GarnetIotThing } from "./iot-presence";
import { Queue } from "aws-cdk-lib/aws-sqs";
import { Vpc } from "aws-cdk-lib/aws-ec2";

export interface GarnetIotProps extends NestedStackProps {
    vpc: Vpc, 
    dns_context_broker: string
}

export class GarnetIot extends NestedStack {
    constructor(scope: Construct, id: string, props: GarnetIotProps) {
      super(scope, id, props)
      const iot_group_construct = new GarnetIotGroup(this, 'GarnetIotGroup', {
        vpc: props.vpc,
        dns_context_broker: props.dns_context_broker
      })
      const iot_presence_construct = new GarnetIotThing(this, 'GarnetIotThing',{
        vpc: props.vpc,
        dns_context_broker: props.dns_context_broker
      })
    }
}