import { CfnElement, CfnOutput, Stack, StackProps } from 'aws-cdk-lib'
import { Construct } from 'constructs'
import { GarnetIngestionStack} from './stacks/garnet-ingestion/garnet-ingestion-stack'
import { garnet_constant } from '../constants'
import { GarnetCommon } from './stacks/garnet-common/garnet-common-stack'
import { GarnetOps } from './stacks/garnet-ops/garnet-ops-stack'
import {
  deployment_params
} from '../architecture'
import { GarnetLake } from './stacks/garnet-lake/garnet-lake-stack'
import { GarnetIot } from './stacks/garnet-iot/garnet-iot-stack'
import { GarnetPrivateSub } from './stacks/garnet-privatesub/private-notification-stack'
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

    const garnet_privatesub = new GarnetPrivateSub(this, 'GarnetPrivateSub', {
      vpc: garnet_common.vpc,
      bucket_name: garnet_datalake.bucket_name
    })

    const garnet_broker_stack = new GarnetBroker(this, 'GarnetBroker', {
      vpc: garnet_common.vpc,
      delivery_stream: garnet_datalake.delivery_stream,
      image: Parameters.garnet_broker_image,
      load_image: Parameters.garnet_load_image,
      public_origin: Parameters.garnet_broker_public_origin,
      notification_delivery_allow_origins:
        Parameters.garnet_notification_delivery_allow_origins,
      private_notification_origin:
        garnet_privatesub.notification_origin,
      context_allow_hosts: Parameters.garnet_context_allow_hosts,
      eventual_entity_reads:
        Parameters.garnet_eventual_entity_reads
    })
    
    const garnet_ingestion_stack = new GarnetIngestionStack(this, 'GarnetIngestion', {
      dns_context_broker: garnet_broker_stack.dns_context_broker, 
      vpc: garnet_common.vpc,

    })
    
    const garnet_iot_stack = new GarnetIot(this, 'GarnetIoT', {
      vpc: garnet_common.vpc, 
      dns_context_broker: garnet_broker_stack.dns_context_broker,
    })

    const garnet_api = new GarnetApi(this, 'GarnetApi', {
      vpc: garnet_common.vpc, 
      dns_context_broker: garnet_broker_stack.dns_context_broker,
      fargate_alb: garnet_broker_stack.fargate_alb,
      secret_api_jwt: garnet_common.secret_api_jwt
  })

    new GarnetOps(this, 'GarnetOps', {
      broker_cluster_name: garnet_broker_stack.cluster_name,
      database_cluster_identifier:
        garnet_broker_stack.database_cluster_identifier,
      entity_event_queue_name:
        garnet_broker_stack.event_queue_name
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
    if (garnet_broker_stack.load !== undefined) {
      const load = garnet_broker_stack.load
      new CfnOutput(this, 'GarnetLoadCluster', {
        value: load.cluster_name
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
    new CfnOutput(this, 'GarnetApiTokenSecretArn', {
      value: garnet_api.garnet_api_token_secret.secretArn,
      description: 'Secrets Manager ARN containing the Garnet API Authorization header'
    })
    new CfnOutput(this, 'GarnetPrivateSubEndpoint', {
      value: garnet_privatesub.private_sub_endpoint,
      description: 'Garnet Private Notification Endpoint for Secured Subscriptions. Only accessible within the Garnet VPC'
    })
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
