import {
  CustomResource,
  Duration,
  RemovalPolicy,
  Stack
} from "aws-cdk-lib"
import { PolicyStatement } from "aws-cdk-lib/aws-iam"
import {
  Architecture,
  Code,
  Function,
  Runtime
} from "aws-cdk-lib/aws-lambda"
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs"
import { Provider } from "aws-cdk-lib/custom-resources"
import { Construct } from "constructs"
import {
  azlist,
  garnet_nomenclature
} from "../../../../constants"

export interface GarnetUtilProps {}

export class Utils extends Construct {
  public readonly az1: string
  public readonly az2: string

  constructor(scope: Construct, id: string, props?: GarnetUtilProps) {
    super(scope, id)

    const region = Stack.of(this).region
    if (region.startsWith("$")) {
      throw new Error(
        "Please configure a concrete AWS region"
      )
    }
    const compatible_azs = azlist[region]
    if (compatible_azs === undefined) {
      throw new Error(
        "Garnet Framework is not available in the selected region"
      )
    }

    const logs = new LogGroup(this, "AvailabilityZoneLogs", {
      retention: RetentionDays.ONE_MONTH,
      removalPolicy: RemovalPolicy.DESTROY
    })
    const resolver = new Function(this, "AvailabilityZoneResolver", {
      functionName: garnet_nomenclature.garnet_utils_az_lambda,
      description:
        "Select availability zones supported by API Gateway and IoT endpoints",
      runtime: Runtime.NODEJS_24_X,
      architecture: Architecture.ARM_64,
      code: Code.fromAsset(`${__dirname}/lambda/getAzs`),
      handler: "index.handler",
      timeout: Duration.seconds(50),
      logGroup: logs,
      environment: {
        COMPATIBLE_AZS: JSON.stringify(compatible_azs)
      }
    })
    resolver.addToRolePolicy(new PolicyStatement({
      actions: [
        "ec2:DescribeAvailabilityZones",
        "ec2:DescribeVpcEndpointServices"
      ],
      resources: ["*"]
    }))

    const provider_logs = new LogGroup(
      this,
      "AvailabilityZoneProviderLogs",
      {
        retention: RetentionDays.ONE_MONTH,
        removalPolicy: RemovalPolicy.DESTROY
      }
    )
    const provider = new Provider(this, "AvailabilityZoneProvider", {
      onEventHandler: resolver,
      providerFunctionName:
        `${garnet_nomenclature.garnet_utils_az_lambda}-provider`,
      logGroup: provider_logs
    })
    const result = new CustomResource(this, "AvailabilityZones", {
      serviceToken: provider.serviceToken
    })

    this.az1 = result.getAttString("az1")
    this.az2 = result.getAttString("az2")
  }
}
