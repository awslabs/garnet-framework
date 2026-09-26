import { Aws, CfnOutput, NestedStack, NestedStackProps} from "aws-cdk-lib"
import { Construct } from "constructs"
import { GarnetApiCommon } from "./apicommon/api-common-construct"
import { Vpc } from "aws-cdk-lib/aws-ec2"
import { GarnetApiGateway } from "./apigateway/api-gateway-construct"
import { ApplicationLoadBalancer } from "aws-cdk-lib/aws-elasticloadbalancingv2"



export interface GarnetApiProps extends NestedStackProps {
     readonly vpc: Vpc,
     readonly dns_context_broker: string,
     readonly broker_alb: ApplicationLoadBalancer
     readonly oidc_issuer: string
     readonly oidc_audiences: string
     
}

export class GarnetApi extends NestedStack {

    public readonly private_sub_endpoint: string
    public readonly api_ref: string
    public readonly stage_name: string
    public readonly broker_api_endpoint: string

    constructor(scope: Construct, id: string, props: GarnetApiProps) {
      super(scope, id, props)


      const api_gateway_construct = new GarnetApiGateway(this, "Api", {
        vpc: props.vpc,
        broker_alb: props.broker_alb,
        oidc_issuer: props.oidc_issuer,
        oidc_audiences: props.oidc_audiences
      })

      const api_common_construct = new GarnetApiCommon(this, 'GarnetApiCommon', {
            api_ref: api_gateway_construct.api_ref, 
            vpc: props.vpc,
            broker_alb: props.broker_alb,
            dns_context_broker: props.dns_context_broker
      })


      this.api_ref = api_gateway_construct.api_ref
      this.stage_name = api_gateway_construct.stage_name
      this.broker_api_endpoint = `https://${api_gateway_construct.api_ref}.execute-api.${Aws.REGION}.amazonaws.com`
      
    new CfnOutput(this, "garnet_endpoint", {
      value: `https://${api_gateway_construct.api_ref}.execute-api.${Aws.REGION}.amazonaws.com`,
    })


    }
}
