import {
  Aws,
  CfnElement,
  CfnOutput,
  Stack,
  StackProps
} from 'aws-cdk-lib'
import { Construct } from 'constructs'
import { GarnetIngestionStack} from './stacks/garnet-ingestion/garnet-ingestion-stack'
import { garnet_constant } from '../constants'
import { GarnetCommon } from './stacks/garnet-common/garnet-common-stack'
import { GarnetOps } from './stacks/garnet-ops/garnet-ops-stack'
import {
  deployment_params
} from '../architecture'
import { GarnetLake } from './stacks/garnet-lake/garnet-lake-stack'
import {
  AwsIotCoreMqttConnector
} from './connectors/aws-iot-core-mqtt/aws-iot-core-mqtt-connector'
import { GarnetApi } from './stacks/garnet-api/garnet-api-stack'
import { Parameters } from '../configuration'
import { GarnetBroker } from './stacks/garnet-broker/garnet-broker-stack'

export class GarnetFrameworkStack extends Stack {


  getLogicalId(element: CfnElement): string {
    if (element?.node?.id?.includes('NestedStackResource')) {
        const stack_name = (/([a-zA-Z0-9]+)\.NestedStackResource/.exec(element.node.id)![1])
        return stack_name
    }
    return super.getLogicalId(element)
  }

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props)
    const garnet_datalake = new GarnetLake(this, 'GarnetLake', {}) 

    const garnet_common = new GarnetCommon(this, 'CommonContructs', {})

    const iot_core_mqtt_connector =
      deployment_params.aws_iot_core_mqtt_connector_enabled
        ? new AwsIotCoreMqttConnector(
            this,
            'AwsIotCoreMqttConnector',
            {
              vpc: garnet_common.vpc,
              tenant: Parameters.garnet_bootstrap_tenant
            }
          )
        : undefined

    const garnet_broker_stack = new GarnetBroker(this, 'GarnetBroker', {
      vpc: garnet_common.vpc,
      delivery_stream: garnet_datalake.delivery_stream,
      image: Parameters.garnet_broker_image,
      load_image: Parameters.garnet_load_image,
      public_origin: Parameters.garnet_broker_public_origin,
      notification_delivery_allow_origins:
        Parameters.garnet_notification_delivery_allow_origins,
      private_notification_origin:
        iot_core_mqtt_connector?.notification_origin ?? '',
      context_allow_hosts: Parameters.garnet_context_allow_hosts,
      oidc_issuer: Parameters.garnet_oidc_issuer,
      oidc_audiences: Parameters.garnet_oidc_audiences,
      oidc_tenant_claim: Parameters.garnet_oidc_tenant_claim,
      bootstrap_admin_subject:
        Parameters.garnet_bootstrap_admin_subject,
      load_oidc_secret_arn:
        Parameters.garnet_load_oidc_secret_arn,
      load_oidc_subject:
        Parameters.garnet_load_oidc_subject,
      load_oidc_client_id:
        Parameters.garnet_load_oidc_client_id,
      authorization_cutover_stopped:
        Parameters.garnet_authorization_cutover_stopped,
      bootstrap_tenant: Parameters.garnet_bootstrap_tenant,
      authorization_policies:
        Parameters.garnet_authorization_policies,
      authorization_bindings:
        Parameters.garnet_authorization_bindings,
      eventual_entity_reads:
        Parameters.garnet_eventual_entity_reads,
      eventual_entity_read_route:
        Parameters.garnet_eventual_entity_read_route,
      temporal_history_retention_days:
        Parameters.temporal_history_retention_days,
      temporal_history_retention_max_gib:
        Parameters.temporal_history_retention_max_gib,
      temporal_history_retention_max_partitions:
        Parameters.temporal_history_retention_max_partitions
    })
    
    const garnet_ingestion_stack = new GarnetIngestionStack(this, 'GarnetIngestion', {
      dns_context_broker: garnet_broker_stack.dns_context_broker, 
      vpc: garnet_common.vpc,
      tenant: Parameters.garnet_bootstrap_tenant
    })
    
    const garnet_api = new GarnetApi(this, 'GarnetApi', {
      vpc: garnet_common.vpc, 
      dns_context_broker: garnet_broker_stack.dns_context_broker,
      broker_alb: garnet_broker_stack.broker_alb,
      oidc_issuer: Parameters.garnet_oidc_issuer,
      oidc_audiences: Parameters.garnet_oidc_audiences
  })

    new GarnetOps(this, 'GarnetOps', {
      broker_cluster_name: garnet_broker_stack.cluster_name,
      database_cluster_identifier:
        garnet_broker_stack.database_cluster_identifier,
      lake_delivery_stream_name:
        garnet_datalake.delivery_stream_name
    })

    new CfnOutput(this, 'GarnetVersion', {
      value: garnet_constant.garnet_version,
      description: 'Version of Garnet Framework'
    })
    new CfnOutput(this, 'GarnetArchitecture', {
      value: deployment_params.architecture,
      description: 'Architecture deployed'
    })
    new CfnOutput(this, 'GarnetDeploymentStrategy', {
      value: Parameters.deployment_strategy,
      description: 'Garnet API deployment strategy'
    })
    new CfnOutput(this, 'GarnetSchemaCompatibility', {
      value: Parameters.garnet_schema_compatibility,
      description: 'Database compatibility declared for this release'
    })
    new CfnOutput(this, 'GarnetAwsRegion', {
      value: Aws.REGION,
      description: 'AWS Region containing the Garnet deployment'
    })
    new CfnOutput(this, 'GarnetAwsAccount', {
      value: Aws.ACCOUNT_ID,
      description: 'AWS account containing the Garnet deployment'
    })
    new CfnOutput(this, 'GarnetBrokerImage', {
      value: Parameters.garnet_broker_image,
      description: 'Immutable Garnet Broker image used by every service'
    })
    new CfnOutput(this, 'GarnetAuthorizationConfigurationDigest', {
      value:
        garnet_broker_stack.authorization_configuration_digest,
      description:
        'Canonical non-secret identity and authorization configuration digest'
    })
    new CfnOutput(this, 'GarnetBrokerCluster', {
      value: garnet_broker_stack.cluster_name,
      description: 'ECS cluster containing Garnet Broker services'
    })
    new CfnOutput(this, 'GarnetDatabaseCluster', {
      value: garnet_broker_stack.database_cluster_identifier,
      description: 'Aurora cluster used by Garnet Broker'
    })
    new CfnOutput(this, 'GarnetDatabaseTopology', {
      value: Parameters.database_reader_enabled
        ? 'writer-reader'
        : 'writer-only',
      description:
        'Database topology required by native qualification telemetry'
    })
    new CfnOutput(this, 'GarnetApiId', {
      value: garnet_api.api_ref,
      description: 'Public HTTP API identifier used for qualification telemetry'
    })
    new CfnOutput(this, 'GarnetApiStage', {
      value: garnet_api.stage_name,
      description: 'Public HTTP API stage used for qualification telemetry'
    })
    new CfnOutput(this, 'GarnetLakeDeliveryStream', {
      value: garnet_datalake.delivery_stream_name,
      description: 'Firehose delivery stream used for lake qualification telemetry'
    })
    if (garnet_broker_stack.load !== undefined) {
      const load = garnet_broker_stack.load
      new CfnOutput(this, 'GarnetLoadCluster', {
        value: load.cluster_name
      })
      new CfnOutput(this, 'GarnetLoadCapacityProvider', {
        value: load.capacity_provider
      })
      new CfnOutput(this, 'GarnetLoadGeneratorTask', {
        value: load.generator_task.taskDefinitionArn
      })
      new CfnOutput(this, 'GarnetLoadAggregateTask', {
        value: load.aggregate_task.taskDefinitionArn
      })
      new CfnOutput(this, 'GarnetLoadSecurityGroup', {
        value: load.security_group.securityGroupId
      })
      new CfnOutput(this, 'GarnetLoadSubnets', {
        value: load.subnet_ids.join(',')
      })
      new CfnOutput(this, 'GarnetLoadReportBucket', {
        value: load.report_bucket.bucketName
      })
      new CfnOutput(this, 'GarnetLoadBrokerUrl', {
        value: load.broker_url
      })
    }
    new CfnOutput(this, 'GarnetEndpoint', {
      value: garnet_api.broker_api_endpoint,
      description: 'Garnet Unified API'
    })
    if (iot_core_mqtt_connector !== undefined) {
      new CfnOutput(this, 'GarnetAwsIotCoreMqttConnectorEndpoint', {
        value: iot_core_mqtt_connector.endpoint,
        description:
          'Optional private NGSI-LD Subscription to AWS IoT Core MQTT endpoint'
      })
      new CfnOutput(this, 'GarnetAwsIotCoreMqttConnectorApiKeyId', {
        value: iot_core_mqtt_connector.api_key_id,
        description:
          'API key id for the optional AWS IoT Core MQTT connector'
      })
    }
    new CfnOutput(this, 'GarnetIngestionQueue', {
      value: garnet_ingestion_stack.sqs_garnet_ingestion.queueUrl,
      description: 'Garnet SQS Queue URL to ingest data from your Data Producers'
    })

    new CfnOutput(this, 'BucketDatalakeName', {
      value: garnet_datalake.bucket_name,
      description: 'Name of the S3 Bucket for the datalake'
    })




  }
}
