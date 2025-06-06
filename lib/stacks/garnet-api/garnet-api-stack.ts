import { Aws, CfnOutput, NestedStack, NestedStackProps} from "aws-cdk-lib"
import { Construct } from "constructs"
import { GarnetApiCommon } from "./apicommon/api-common-construct"
import { Vpc } from "aws-cdk-lib/aws-ec2"
import { GarnetApiGateway } from "./apigateway/api-gateway-construct"
import { ApplicationLoadBalancer } from "aws-cdk-lib/aws-elasticloadbalancingv2"
import { GarnetApiAuthJwt } from "./apiauth/api-auth-construct"
import { Secret } from "aws-cdk-lib/aws-secretsmanager"
import { Queue } from "aws-cdk-lib/aws-sqs"



export interface GarnetApiProps extends NestedStackProps {
     readonly vpc: Vpc,
     readonly dns_context_broker: string,
     readonly garnet_ingestion_sqs: Queue, 
     readonly garnet_private_endpoint: string
     readonly fargate_alb: ApplicationLoadBalancer
     readonly secret_api_jwt: Secret
     
}

export class GarnetApi extends NestedStack {

    public readonly private_sub_endpoint: string
    public readonly api_ref: string
    public readonly broker_api_endpoint: string
    public readonly garnet_api_token : string

    constructor(scope: Construct, id: string, props: GarnetApiProps) {
      super(scope, id, props)


      const api_auth_construct = new GarnetApiAuthJwt(this, "ApiAuth", {
        secret_api_jwt: props.secret_api_jwt
      })

      const api_gateway_construct = new GarnetApiGateway(this, "Api", {
        vpc: props.vpc,
        fargate_alb: props.fargate_alb,
        lambda_authorizer_arn: api_auth_construct.lambda_authorizer_arn
      })

      const api_common_construct = new GarnetApiCommon(this, 'GarnetApiCommon', {
            api_ref: api_gateway_construct.api_ref, 
            vpc: props.vpc,
            dns_context_broker: props.dns_context_broker, 
            garnet_ingestion_sqs: props.garnet_ingestion_sqs,
            garnet_private_endpoint: props.garnet_private_endpoint
      })


      this.api_ref = api_gateway_construct.api_ref
      this.broker_api_endpoint = `https://${api_gateway_construct.api_ref}.execute-api.${Aws.REGION}.amazonaws.com`
      this.garnet_api_token = api_auth_construct.garnet_api_token
      
    new CfnOutput(this, "garnet_endpoint", {
      value: `https://${api_gateway_construct.api_ref}.execute-api.${Aws.REGION}.amazonaws.com`,
    })


    }
}