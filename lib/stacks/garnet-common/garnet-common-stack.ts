import { NestedStack, NestedStackProps } from "aws-cdk-lib";
import { Construct } from "constructs";
import { GarnetNetworking } from "./networking/networking-construct";
import { Utils } from "./utils/utils-construct";
import { Vpc } from "aws-cdk-lib/aws-ec2";


export class GarnetCommon extends NestedStack {
  public readonly vpc: Vpc
  public readonly az1: string
  public readonly az2: string

  constructor(scope: Construct, id: string, props?: NestedStackProps) {
    super(scope, id, props);
    
    const utils_construct = new Utils(this, "Utils")
    const networking_construct = new GarnetNetworking(this, "Networking", {
      az1: utils_construct.az1,
      az2: utils_construct.az2
    })

    networking_construct.node.addDependency(utils_construct)
    

    this.az1 = utils_construct.az1
    this.az2 = utils_construct.az2
    this.vpc = networking_construct.vpc
  }
}
