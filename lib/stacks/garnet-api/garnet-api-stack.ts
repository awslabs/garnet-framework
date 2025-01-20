import { Aws, CfnOutput, NestedStack, NestedStackProps} from "aws-cdk-lib"
import { Construct } from "constructs"
import { GarnetApiCommon } from "./apibroker"
import { Vpc } from "aws-cdk-lib/aws-ec2"
import { GarnetApiGateway } from "./apigateway"
import { ApplicationLoadBalancer } from "aws-cdk-lib/aws-elasticloadbalancingv2"



export interface GarnetApiProps extends NestedStackProps {
     readonly vpc: Vpc,
     readonly dns_context_broker: string,
     readonly garnet_ingestion_sqs_arn: string, 
     readonly garnet_private_endpoint: string
     readonly fargate_alb: ApplicationLoadBalancer
}

export class GarnetApi extends NestedStack {

    public readonly private_sub_endpoint: string
    public readonly api_ref: string
  
    constructor(scope: Construct, id: string, props: GarnetApiProps) {
      super(scope, id, props)

      const api_stack = new GarnetApiGateway(this, "Api", {
        vpc: props.vpc,
        fargate_alb: props.fargate_alb,
      })

      const api_common_construct = new GarnetApiCommon(this, 'GarnetApiCommon', {
            api_ref: api_stack.api_ref, 
            vpc: props.vpc,
            dns_context_broker: props.dns_context_broker, 
            garnet_ingestion_sqs_arn: props.garnet_ingestion_sqs_arn,
            garnet_private_endpoint: props.garnet_private_endpoint
      })


      this.api_ref = api_stack.api_ref

    new CfnOutput(this, "garnet_endpoint", {
      value: `https://${api_stack.api_ref}.execute-api.${Aws.REGION}.amazonaws.com`,
    })


    }
}