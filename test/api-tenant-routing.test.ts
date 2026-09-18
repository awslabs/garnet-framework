import { App, Stack } from "aws-cdk-lib"
import { Template } from "aws-cdk-lib/assertions"
import { Vpc } from "aws-cdk-lib/aws-ec2"
import {
  ApplicationLoadBalancer,
  ListenerAction
} from
  "aws-cdk-lib/aws-elasticloadbalancingv2"
import { GarnetApiGateway } from
  "../lib/stacks/garnet-api/apigateway/api-gateway-construct"

describe("tenant-safe API routing", () => {
  it("uses native OIDC while preserving the signed caller request", () => {
    const app = new App()
    const stack = new Stack(app, "ApiTenantRouting", {
      env: {
        account: "111111111111",
        region: "eu-west-3"
      }
    })
    const vpc = new Vpc(stack, "Vpc", { maxAzs: 2 })
    const load_balancer = new ApplicationLoadBalancer(
      stack,
      "LoadBalancer",
      {
        vpc,
        internetFacing: false
      }
    )
    load_balancer.addListener("Listener", {
      port: 80,
      defaultAction: ListenerAction.fixedResponse(404)
    })

    new GarnetApiGateway(stack, "Api", {
      vpc,
      broker_alb: load_balancer,
      oidc_issuer: "https://identity.example",
      oidc_audiences: "garnet-api,garnet-cli"
    })
    const template = Template.fromStack(stack)

    template.hasResourceProperties(
      "AWS::ApiGatewayV2::Integration",
      {
        IntegrationType: "HTTP_PROXY"
      }
    )
    template.hasResourceProperties(
      "AWS::ApiGatewayV2::Authorizer",
      {
        AuthorizerType: "JWT",
        IdentitySource: ["$request.header.Authorization"],
        JwtConfiguration: {
          Audience: ["garnet-api", "garnet-cli"],
          Issuer: "https://identity.example"
        }
      }
    )
    template.hasResourceProperties("AWS::ApiGatewayV2::Api", {
      CorsConfiguration: {
        AllowHeaders: [
          "Authorization",
          "Content-Type",
          "Link",
          "NGSILD-Tenant",
          "NGSILD-Path"
        ],
        AllowMethods: [
          "GET",
          "POST",
          "PATCH",
          "DELETE",
          "OPTIONS"
        ],
        AllowOrigins: ["*"],
        ExposeHeaders: [
          "Content-Type",
          "Link",
          "Location",
          "NGSILD-Results-Count"
        ],
        MaxAge: 5
      }
    })
    template.resourceCountIs("AWS::ApiGatewayV2::Integration", 1)
    template.resourceCountIs("AWS::ApiGatewayV2::Route", 1)
    template.resourceCountIs("AWS::Lambda::Function", 0)
    template.resourceCountIs("AWS::Lambda::Permission", 0)
    template.hasResourceProperties("AWS::ApiGatewayV2::Route", {
      AuthorizationType: "JWT"
    })

    const ingress = Object.values(
      template.findResources("AWS::EC2::SecurityGroupIngress")
    ).find(
      (resource: any) =>
        resource.Properties.Description ===
          "API Gateway VPC link to the Garnet Broker ALB"
    ) as any

    expect(ingress.Properties).toMatchObject({
      FromPort: 80,
      IpProtocol: "tcp",
      SourceSecurityGroupId: expect.anything(),
      ToPort: 80
    })
    expect(ingress.Properties).not.toHaveProperty("CidrIp")
  })
})
