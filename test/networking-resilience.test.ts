import { App, Stack } from "aws-cdk-lib"
import { Template } from "aws-cdk-lib/assertions"
import { GarnetNetworking } from
  "../lib/stacks/garnet-common/networking/networking-construct"

describe("production network resilience", () => {
  it("keeps egress zone-independent and routes S3 without NAT", () => {
    const app = new App()
    const stack = new Stack(app, "Network", {
      env: {
        account: "111111111111",
        region: "eu-west-3"
      }
    })

    new GarnetNetworking(stack, "Networking", {
      az1: "eu-west-3a",
      az2: "eu-west-3b"
    })
    const template = Template.fromStack(stack)

    template.resourceCountIs("AWS::EC2::NatGateway", 2)
    template.hasResourceProperties("AWS::EC2::VPCEndpoint", {
      ServiceName: {
        "Fn::Join": [
          "",
          [
            "com.amazonaws.",
            { Ref: "AWS::Region" },
            ".s3"
          ]
        ]
      },
      VpcEndpointType: "Gateway"
    })
  })
})
