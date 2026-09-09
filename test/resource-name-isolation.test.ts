import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { App } from "aws-cdk-lib"

const CONFIG_PATH = require.resolve("../configuration")

const physicalFields: Record<string, string[]> = {
  "AWS::ApiGateway::RestApi": ["Name"],
  "AWS::ApiGatewayV2::Api": ["Name"],
  "AWS::ApiGatewayV2::VpcLink": ["Name"],
  "AWS::Athena::WorkGroup": ["Name"],
  "AWS::CloudWatch::Alarm": ["AlarmName"],
  "AWS::CloudWatch::Dashboard": ["DashboardName"],
  "AWS::EC2::SecurityGroup": ["GroupName"],
  "AWS::ECS::Cluster": ["ClusterName"],
  "AWS::ECS::Service": ["ServiceName"],
  "AWS::ECS::TaskDefinition": ["Family"],
  "AWS::ElastiCache::ReplicationGroup": [
    "ReplicationGroupId"
  ],
  "AWS::ElasticLoadBalancingV2::LoadBalancer": ["Name"],
  "AWS::ElasticLoadBalancingV2::TargetGroup": ["Name"],
  "AWS::Events::Rule": ["Name"],
  "AWS::Glue::Database": ["DatabaseInput.Name"],
  "AWS::Glue::Table": ["Name"],
  "AWS::IAM::Role": ["RoleName"],
  "AWS::IoT::DomainConfiguration": ["DomainConfigurationName"],
  "AWS::IoT::TopicRule": ["RuleName"],
  "AWS::KinesisFirehose::DeliveryStream": [
    "DeliveryStreamName"
  ],
  "AWS::Lambda::Function": ["FunctionName"],
  "AWS::Lambda::LayerVersion": ["LayerName"],
  "AWS::Logs::LogGroup": ["LogGroupName"],
  "AWS::RDS::DBCluster": ["DBClusterIdentifier"],
  "AWS::RDS::DBInstance": ["DBInstanceIdentifier"],
  "AWS::RDS::DBProxy": ["DBProxyName"],
  "AWS::S3::Bucket": ["BucketName"],
  "AWS::SecretsManager::Secret": ["Name"],
  "AWS::ServiceDiscovery::PrivateDnsNamespace": ["Name"],
  "AWS::ServiceDiscovery::Service": ["Name"],
  "AWS::SQS::Queue": ["QueueName"],
  "AWS::StepFunctions::StateMachine": ["StateMachineName"]
}

const legacyNames = new Set([
  "AWS::ApiGateway::RestApi|Name|garnet-private-sub-endpoint-api",
  "AWS::ApiGatewayV2::Api|Name|garnet-api",
  "AWS::ApiGatewayV2::VpcLink|Name|garnet-vpc-link",
  "AWS::Athena::WorkGroup|Name|garnet",
  "AWS::CloudWatch::Alarm|AlarmName|" +
    "garnet-broker-database-connections-${AWS::Region}",
  "AWS::CloudWatch::Dashboard|DashboardName|" +
    "Garnet-Ops-Dashboard-${AWS::Region}",
  "AWS::EC2::SecurityGroup|GroupName|garnet-broker-alb-sg",
  "AWS::EC2::SecurityGroup|GroupName|garnet-broker-database-sg",
  "AWS::EC2::SecurityGroup|GroupName|garnet-broker-fargate-sg",
  "AWS::EC2::SecurityGroup|GroupName|garnet-broker-rds-proxy-sg",
  "AWS::EC2::SecurityGroup|GroupName|" +
    "garnet-private-sub-endpoint-sg",
  "AWS::EC2::SecurityGroup|GroupName|garnet-sns-endpoint-sg",
  "AWS::EC2::SecurityGroup|GroupName|garnet-sqs-endpoint-sg",
  "AWS::EC2::SecurityGroup|GroupName|garnet-vpclink-sg",
  "AWS::ECS::Cluster|ClusterName|garnet-broker-cluster",
  "AWS::ECS::Service|ServiceName|" +
    "garnet-broker-all-in-one-service",
  "AWS::ECS::TaskDefinition|Family|" +
    "garnet-scorpio-all-in-one-task-definition",
  "AWS::ElasticLoadBalancingV2::LoadBalancer|Name|" +
    "garnet-broker-alb-concentrated",
  "AWS::IAM::Role|RoleName|" +
    "garnet-rds-proxy-role-${AWS::Region}",
  "AWS::Glue::Database|DatabaseInput.Name|garnetdb",
  "AWS::IoT::TopicRule|RuleName|garnet_iot_presence_rule",
  "AWS::IoT::TopicRule|RuleName|" +
    "garnet_iot_thing_group_lifecycle_rule",
  "AWS::IoT::TopicRule|RuleName|" +
    "garnet_iot_thing_group_membership_rule",
  "AWS::IoT::TopicRule|RuleName|" +
    "garnet_iot_thing_lifecycle_rule",
  "AWS::IoT::TopicRule|RuleName|garnet_subscriptions_rule",
  "AWS::KinesisFirehose::DeliveryStream|DeliveryStreamName|" +
    "garnet-datalake-firehose-stream",
  "AWS::KinesisFirehose::DeliveryStream|DeliveryStreamName|" +
    "garnet-subs-firehose-stream",
  "AWS::Lambda::Function|FunctionName|garnet-api-auth-jwt-lambda",
  "AWS::Lambda::Function|FunctionName|garnet-api-authorizer-lambda",
  "AWS::Lambda::Function|FunctionName|garnet-api-cors-preflight",
  "AWS::Lambda::Function|FunctionName|garnet-api-version-lambda",
  "AWS::Lambda::Function|FunctionName|" +
    "garnet-custom-provider-athena-lambda",
  "AWS::Lambda::Function|FunctionName|" +
    "garnet-ingestion-update-broker-lambda",
  "AWS::Lambda::Function|FunctionName|garnet-iot-event-config",
  "AWS::Lambda::Function|FunctionName|" +
    "garnet-iot-group-lifecycle-lambda",
  "AWS::Lambda::Function|FunctionName|" +
    "garnet-iot-group-membership-lambda",
  "AWS::Lambda::Function|FunctionName|garnet-iot-presence-lambda",
  "AWS::Lambda::Function|FunctionName|" +
    "garnet-iot-thing-lifecycle-lambda",
  "AWS::Lambda::Function|FunctionName|garnet-lake-athena-lambda",
  "AWS::Lambda::Function|FunctionName|garnet-lake-transform-lambda",
  "AWS::Lambda::Function|FunctionName|garnet-private-sub-lambda",
  "AWS::Lambda::Function|FunctionName|" +
    "garnet-private-sub-sqs-lambda",
  "AWS::Lambda::Function|FunctionName|" +
    "garnet-scorpiobroker-private-notification-lambda",
  "AWS::Lambda::Function|FunctionName|" +
    "garnet-utils-bucket-create-lambda",
  "AWS::Lambda::Function|FunctionName|" +
    "garnet-utils-bucket-provider-lambda",
  "AWS::Lambda::Function|FunctionName|" +
    "garnet-utils-bucket-check-lambda",
  "AWS::Lambda::Function|FunctionName|" +
    "garnet-utils-clean-ecstasks-lambda",
  "AWS::Lambda::Function|FunctionName|garnet-utils-getaz-lambda",
  "AWS::Lambda::Function|FunctionName|" +
    "garnet-utils-getaz-lambda-provider",
  "AWS::Lambda::Function|FunctionName|" +
    "garnet-utils-scorpio-cleansqs-lambda",
  "AWS::Lambda::Function|FunctionName|" +
    "garnet-utils-scorpio-cleansqs-lambda-provider",
  "AWS::Lambda::Function|FunctionName|" +
    "garnet-utils-sqs-check-lambda",
  "AWS::Lambda::Function|FunctionName|" +
    "garnet-utils-sqs-notification-provider-lambda",
  "AWS::RDS::DBCluster|DBClusterIdentifier|garnet-aurora-cluster",
  "AWS::RDS::DBProxy|DBProxyName|garnet-proxy-rds",
  "AWS::S3::Bucket|BucketName|" +
    "garnet-datalake-${AWS::Region}-${AWS::AccountId}",
  "AWS::S3::Bucket|BucketName|" +
    "garnet-datalake-${AWS::Region}-${AWS::AccountId}" +
    "-athena-results",
  "AWS::SecretsManager::Secret|Name|garnet/secret/api",
  "AWS::SecretsManager::Secret|Name|garnet/secret/api-client",
  "AWS::SecretsManager::Secret|Name|garnet/secret/brokerdb",
  "AWS::ServiceDiscovery::PrivateDnsNamespace|Name|garnet.local",
  "AWS::SQS::Queue|QueueName|" +
    "garnet-ingestion-dlq-${AWS::Region}",
  "AWS::SQS::Queue|QueueName|" +
    "garnet-ingestion-queue-${AWS::Region}",
  "AWS::SQS::Queue|QueueName|" +
    "garnet-iot-presence-${AWS::Region}"
])

const valueAt = (
  value: Record<string, unknown>,
  path: string
): unknown =>
  path.split(".").reduce<unknown>(
    (current, key) =>
      typeof current === "object" &&
      current !== null &&
      !Array.isArray(current)
        ? (current as Record<string, unknown>)[key]
        : undefined,
    value
  )

const render = (value: unknown): string => {
  if (typeof value === "string") return value
  if (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  ) {
    const object = value as Record<string, unknown>
    if (typeof object.Ref === "string") {
      return `\${${object.Ref}}`
    }
    const joinExpression = object["Fn::Join"]
    if (Array.isArray(joinExpression)) {
      const [separator, fragments] = joinExpression
      if (
        typeof separator === "string" &&
        Array.isArray(fragments)
      ) {
        return fragments.map(render).join(separator)
      }
    }
  }
  return JSON.stringify(value)
}

const templateFiles = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap(
    (entry) => {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) return templateFiles(path)
      return entry.name.endsWith(".template.json") ? [path] : []
    }
  )

describe("Garnet Framework physical resource names", () => {
  afterEach(() => jest.resetModules())

  it("does not reuse maintenance-stack physical names", () => {
    const actual = jest.requireActual<any>("../configuration")
    jest.doMock(CONFIG_PATH, () => ({
      Parameters: {
        ...actual.Parameters,
        deployment_strategy: "bluegreen",
        garnet_broker_image:
          `public.ecr.aws/garnet/broker@sha256:${"a".repeat(64)}`,
        garnet_load_image: "",
        garnet_broker_public_origin: "https://broker.example"
      }
    }))
    const {
      GarnetFrameworkStack
    } = require("../lib/garnet-framework-stack")
    const app = new App()
    new GarnetFrameworkStack(app, "GarnetFramework", {
      stackName: "GarnetFramework",
      env: {
        account: "111111111111",
        region: "eu-west-3"
      }
    })

    const currentNames = new Set<string>()
    for (const file of templateFiles(app.synth().directory)) {
      const template = JSON.parse(readFileSync(file, "utf8"))
      for (const resource of Object.values(
        template.Resources ?? {}
      ) as any[]) {
        for (const field of physicalFields[resource.Type] ?? []) {
          const value = valueAt(resource.Properties ?? {}, field)
          if (value !== undefined) {
            currentNames.add(
              `${resource.Type}|${field}|${render(value)}`
            )
          }
        }
      }
    }

    expect(currentNames.size).toBeGreaterThan(40)
    expect(
      [...currentNames].filter((name) => legacyNames.has(name))
    ).toEqual([])
  })
})
