import { Aws, Duration, RemovalPolicy } from "aws-cdk-lib";
import { CfnIntegration, CfnRoute } from "aws-cdk-lib/aws-apigatewayv2";
import { CfnSecurityGroupIngress, Vpc } from "aws-cdk-lib/aws-ec2";
import { ApplicationLoadBalancer } from "aws-cdk-lib/aws-elasticloadbalancingv2";
import {
  Runtime,
  Function,
  Code,
  CfnPermission,
  LayerVersion,
  Architecture,
} from "aws-cdk-lib/aws-lambda";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import { Construct } from "constructs";
import {
  garnet_broker,
  garnet_constant,
  garnet_resource_name,
} from "../../../../constants";

export interface GarnetApiCommonProps {
  readonly api_ref: string;
  readonly vpc: Vpc;
  readonly broker_alb: ApplicationLoadBalancer;
  readonly dns_context_broker: string;
}

export class GarnetApiCommon extends Construct {
  constructor(scope: Construct, id: string, props: GarnetApiCommonProps) {
    super(scope, id);

    // LAMBDA LAYER (SHARED LIBRARIES)
    const layer_lambda_path = `./lib/layers`;
    const layer_lambda = new LayerVersion(this, "LayerLambda", {
      code: Code.fromAsset(layer_lambda_path),
      compatibleRuntimes: [Runtime.NODEJS_24_X],
    });

    // **********************************************

    /**
     *  GARNET VERSION
     */

    // LAMBDA GARNET API VERSION
    const lambda_garnet_version_log = new LogGroup(
      this,
      "LambdaGarnetVersionLogs",
      {
        retention: RetentionDays.THREE_MONTHS,
        removalPolicy: RemovalPolicy.DESTROY,
      }
    );
    const lambda_garnet_version_path = `${__dirname}/lambda/garnetVersion`;
    const lambda_garnet_version = new Function(this, "LambdaGarnetVersion", {
      functionName: garnet_resource_name("api-version"),
      vpc: props.vpc,
      description: "Garnet API - Function that returns the Garnet Version",
      runtime: Runtime.NODEJS_24_X,
      code: Code.fromAsset(lambda_garnet_version_path),
      handler: "index.handler",
      timeout: Duration.seconds(30),
      logGroup: lambda_garnet_version_log,
      layers: [layer_lambda],
      architecture: Architecture.ARM_64,
      environment: {
        CONTEXT_BROKER: garnet_broker,
        GARNET_VERSION: garnet_constant.garnet_version,
        DNS_CONTEXT_BROKER: props.dns_context_broker,
        GARNET_ARCHITECTURE: "distributed",
      },
    });
    lambda_garnet_version.node.addDependency(lambda_garnet_version_log);
    for (const [index, security_group] of
      props.broker_alb.connections.securityGroups.entries()) {
      new CfnSecurityGroupIngress(
        this,
        `BrokerHealthIngress${index}`,
        {
          description:
            "Version Lambda health check to the production Broker listener",
          groupId: security_group.securityGroupId,
          ipProtocol: "tcp",
          fromPort: 80,
          toPort: 80,
          sourceSecurityGroupId:
            lambda_garnet_version.connections.securityGroups[0]
              .securityGroupId
        }
      )
    }
    const garnet_version_integration = new CfnIntegration(
      this,
      "GarnetVersionIntegration",
      {
        apiId: props.api_ref,
        integrationMethod: "GET",
        integrationType: "AWS_PROXY",
        integrationUri: lambda_garnet_version.functionArn,
        connectionType: "INTERNET",
        description: "GARNET VERSION INTEGRATION",
        payloadFormatVersion: "1.0",
      }
    );

    const garnet_version_route = new CfnRoute(this, "GarnetVersionRoute", {
      apiId: props.api_ref,
      routeKey: "GET /",
      target: `integrations/${garnet_version_integration.ref}`,
    });

    new CfnPermission(this, "ApiGatewayLambdaPermissionGarnetVersion", {
      principal: `apigateway.amazonaws.com`,
      action: "lambda:InvokeFunction",
      functionName: lambda_garnet_version.functionName,
      sourceArn: `arn:aws:execute-api:${Aws.REGION}:${Aws.ACCOUNT_ID}:${props.api_ref}/*/*/*`,
    });

    /**
     *  END GARNET VERSION
     */

    // **********************************************
  }
}
