import {
  GatewayVpcEndpointAwsService,
  SubnetType,
  Vpc
} from "aws-cdk-lib/aws-ec2"
import { Construct } from "constructs"
import { garnet_resource_name } from "../../../../constants"
import { deployment_params } from "../../../../architecture"


export interface GarnetNetworkingProps {
  az1: string,
  az2: string
}

export class GarnetNetworking extends Construct {
  public readonly vpc: Vpc
  constructor(scope: Construct, id: string, props: GarnetNetworkingProps) {
    super(scope, id)

    // VPC
    const vpc = new Vpc(this, "VpcGarnetFramework", {
      natGateways: deployment_params.nat_gateway_count,
      availabilityZones: [`${props.az1}`,`${props.az2}`],
      vpcName: garnet_resource_name("vpc"),
      subnetConfiguration: [
        {
          subnetType: SubnetType.PRIVATE_WITH_EGRESS,
          name: garnet_resource_name("subnet-egress"),
        },
        {
          subnetType: SubnetType.PRIVATE_ISOLATED,
          name: garnet_resource_name("subnet-isolated"),
        },
        {
          subnetType: SubnetType.PUBLIC,
          name: garnet_resource_name("subnet-public"),
        }
      ]
    })
    vpc.addGatewayEndpoint("S3Endpoint", {
      service: GatewayVpcEndpointAwsService.S3,
      subnets: [{
        subnetType: SubnetType.PRIVATE_WITH_EGRESS
      }]
    })

    this.vpc = vpc;
  }
}
