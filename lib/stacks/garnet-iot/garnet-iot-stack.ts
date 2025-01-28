import { NestedStack, NestedStackProps} from "aws-cdk-lib";
import { Construct } from "constructs"
import { GarnetIotGroup } from "./iot-group";
import { GarnetIotThing } from "./iot-presence";

export interface GarnetIotProps extends NestedStackProps {

}

export class GarnetIot extends NestedStack {
  
  
    public readonly private_sub_endpoint: string
  
    constructor(scope: Construct, id: string, props?: GarnetIotProps) {
      super(scope, id, props)
      const iot_group_construct = new GarnetIotGroup(this, 'GarnetIotGroup')
      const iot_presence_construct = new GarnetIotThing(this, 'GarnetIotThing')
    }
}