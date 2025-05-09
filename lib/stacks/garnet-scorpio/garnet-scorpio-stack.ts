import { Aws, CfnOutput, NestedStack, NestedStackProps } from "aws-cdk-lib";
import { SecurityGroup, Vpc } from "aws-cdk-lib/aws-ec2";
import { Construct } from "constructs";
import { GarnetApiGateway } from "../garnet-api/apigateway/api-gateway-construct";
import { GarnetScorpioDatabase } from "./database/database-construct";
import { GarnetScorpioFargate } from "./fargate/container-construct";

import { Secret } from "aws-cdk-lib/aws-secretsmanager";
import { garnet_scorpio_images } from "../../../constants";
import { ApplicationLoadBalancer } from "aws-cdk-lib/aws-elasticloadbalancingv2";
import { CfnDeliveryStream } from "aws-cdk-lib/aws-kinesisfirehose";


export interface GarnetScorpioProps extends NestedStackProps{
  vpc: Vpc,
  secret: Secret,
  delivery_stream: CfnDeliveryStream
}

export class GarnetScorpio extends NestedStack {
  
  public readonly dns_context_broker: string;
  public readonly vpc: Vpc;
  public readonly fargate_alb: ApplicationLoadBalancer;

  public readonly sg_broker: SecurityGroup


  constructor(scope: Construct, id: string, props: GarnetScorpioProps) {
    super(scope, id, props);

    const database_construct = new GarnetScorpioDatabase(this, "Database", {
      vpc: props.vpc,
      secret_arn: props.secret.secretArn
    })

    const fargate_construct = new GarnetScorpioFargate( this, "Fargate", {
        vpc: props.vpc,
        sg_proxy: database_construct.sg_proxy,
        secret_arn: props.secret.secretArn,
        db_endpoint: database_construct.database_endpoint,
        // db_reader_endpoint: database_construct.database_reader_endpoint,
        db_port: database_construct.database_port,
        image_context_broker: garnet_scorpio_images.allInOne,
        delivery_stream: props.delivery_stream
      }
    )

    fargate_construct.node.addDependency(database_construct)

    this.fargate_alb = fargate_construct.fargate_alb
    this.dns_context_broker = fargate_construct.fargate_alb.loadBalancerDnsName
    this.vpc = props.vpc
  
    this.sg_broker = fargate_construct.sg_broker

    new CfnOutput(this, "fargate_alb", {
      value: fargate_construct.fargate_alb.loadBalancerDnsName,
    })
  }
}
