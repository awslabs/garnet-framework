import {
  Duration,
  RemovalPolicy
} from "aws-cdk-lib"
import {
  Alarm,
  ComparisonOperator,
  MathExpression,
  TreatMissingData
} from "aws-cdk-lib/aws-cloudwatch"
import {
  Port,
  SecurityGroup,
  SubnetType,
  Vpc
} from "aws-cdk-lib/aws-ec2"
import {
  AlarmBehavior,
  BaseService,
  DeploymentLifecycleLambdaTarget,
  DeploymentLifecycleStage
} from "aws-cdk-lib/aws-ecs"
import {
  ApplicationLoadBalancer,
  ApplicationTargetGroup,
  HttpCodeTarget
} from "aws-cdk-lib/aws-elasticloadbalancingv2"
import {
  Architecture,
  Code,
  Function,
  Runtime
} from "aws-cdk-lib/aws-lambda"
import {
  LogGroup,
  RetentionDays
} from "aws-cdk-lib/aws-logs"
import { Construct } from "constructs"
import { garnet_resource_name } from "../../../../constants"

export interface GarnetApiDeploymentGuardProps {
  vpc: Vpc
  service: BaseService
  load_balancer: ApplicationLoadBalancer
  load_balancer_security_group: SecurityGroup
  test_listener_port: number
  production_target: ApplicationTargetGroup
  test_target: ApplicationTargetGroup
}

export class GarnetApiDeploymentGuard extends Construct {
  constructor(
    scope: Construct,
    id: string,
    props: GarnetApiDeploymentGuardProps
  ) {
    super(scope, id)

    const validation_security_group = new SecurityGroup(
      this,
      "ValidationSecurityGroup",
      {
        vpc: props.vpc,
        description:
          "Garnet API blue/green test-traffic validation",
        allowAllOutbound: true
      }
    )
    props.load_balancer_security_group.addIngressRule(
      validation_security_group,
      Port.tcp(props.test_listener_port),
      "Blue/green validation Lambda to the test listener"
    )

    const validation_logs = new LogGroup(this, "ValidationLogs", {
      retention: RetentionDays.ONE_MONTH,
      removalPolicy: RemovalPolicy.DESTROY
    })
    const validation = new Function(this, "Validation", {
      functionName:
        garnet_resource_name("api-deployment-validation"),
      description:
        "Validates Garnet API test traffic before production cutover",
      runtime: Runtime.NODEJS_24_X,
      architecture: Architecture.ARM_64,
      code: Code.fromAsset(
        `${__dirname}/lambda/deployment-validation`
      ),
      handler: "index.handler",
      timeout: Duration.seconds(30),
      memorySize: 256,
      logGroup: validation_logs,
      vpc: props.vpc,
      vpcSubnets: {
        subnetType: SubnetType.PRIVATE_WITH_EGRESS
      },
      securityGroups: [validation_security_group],
      environment: {
        TEST_ORIGIN:
          `http://${props.load_balancer.loadBalancerDnsName}:` +
          String(props.test_listener_port)
      }
    })
    props.service.addLifecycleHook(
      new DeploymentLifecycleLambdaTarget(
        validation,
        "ValidateTestTraffic",
        {
          lifecycleStages: [
            DeploymentLifecycleStage.POST_TEST_TRAFFIC_SHIFT
          ]
        }
      )
    )

    const target_5xx_rate_name =
      garnet_resource_name("api-deployment-target-5xx-rate")
    const unhealthy_targets_name =
      garnet_resource_name("api-deployment-unhealthy-targets")
    new Alarm(this, "Target5xxRate", {
      alarmName: target_5xx_rate_name,
      metric: new MathExpression({
        expression:
          "IF((blueRequests + greenRequests) > 0, " +
          "100 * (blue5xx + green5xx) / " +
          "(blueRequests + greenRequests), 0)",
        usingMetrics: {
          blueRequests:
            props.production_target.metrics.requestCount(),
          greenRequests:
            props.test_target.metrics.requestCount(),
          blue5xx: props.production_target.metrics.httpCodeTarget(
            HttpCodeTarget.TARGET_5XX_COUNT
          ),
          green5xx: props.test_target.metrics.httpCodeTarget(
            HttpCodeTarget.TARGET_5XX_COUNT
          )
        },
        period: Duration.minutes(1),
        label: "Garnet API target 5xx rate"
      }),
      threshold: 2,
      comparisonOperator:
        ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: 2,
      datapointsToAlarm: 2,
      treatMissingData: TreatMissingData.NOT_BREACHING
    })
    new Alarm(
      this,
      "UnhealthyTargets",
      {
        alarmName: unhealthy_targets_name,
        metric: new MathExpression({
          expression: "blueUnhealthy + greenUnhealthy",
          usingMetrics: {
            blueUnhealthy:
              props.production_target.metrics.unhealthyHostCount(),
            greenUnhealthy:
              props.test_target.metrics.unhealthyHostCount()
          },
          period: Duration.minutes(1),
          label: "Garnet API unhealthy targets"
        }),
        threshold: 0,
        evaluationPeriods: 2,
        datapointsToAlarm: 2,
        treatMissingData: TreatMissingData.NOT_BREACHING
      }
    )
    props.service.enableDeploymentAlarms(
      [target_5xx_rate_name, unhealthy_targets_name],
      {
        behavior: AlarmBehavior.ROLLBACK_ON_ALARM
      }
    )
  }
}
