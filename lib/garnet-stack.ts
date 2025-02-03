import { CfnElement, CfnOutput, Names, Stack, StackProps } from 'aws-cdk-lib'
import { Construct } from 'constructs'
import { GarnetScorpio } from './stacks/garnet-scorpio/garnet-scorpio-stack'
import { GarnetIngestionStack} from './stacks/garnet-ingestion/garnet-ingestion-stack'
import { garnet_constant } from '../constants'
import { GarnetCommon } from './stacks/garnet-common/garnet-common-stack'
import { GarnetOps } from './stacks/garnet-ops/garnet-ops-stack'
import { deployment_params } from '../sizing'
import { GarnetLake } from './stacks/garnet-lake/garnet-lake-stack'
import { GarnetIot } from './stacks/garnet-iot/garnet-iot-stack'
import { GarnetPrivateSub } from './stacks/garnet-privatesub/garnet-privatesub-stack'
import { GarnetApi } from './stacks/garnet-api/garnet-api-stack'



export class GarnetStack extends Stack {


  getLogicalId(element: CfnElement): string {
    if (element?.node?.id?.includes('NestedStackResource')) {
        let stack_name = (/([a-zA-Z0-9]+)\.NestedStackResource/.exec(element.node.id)![1])
        return stack_name
    }
    return super.getLogicalId(element)
  }

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props)
    const garnet_datalake = new GarnetLake(this, 'GarnetLake', {}) 

    const garnet_common = new GarnetCommon(this, 'CommonContructs', {})
   

    const garnet_broker_stack = new GarnetScorpio(this, 'ScorpioBroker', {
        vpc: garnet_common.vpc, 
        secret: garnet_common.secret,
        delivery_stream: garnet_datalake.delivery_stream
      })
    
    const garnet_ingestion_stack = new GarnetIngestionStack(this, 'GarnetIngestion', {
      dns_context_broker: garnet_broker_stack.dns_context_broker, 
      vpc: garnet_common.vpc,

    })
    
    const garnet_iot_stack = new GarnetIot(this, 'GarnetIoT')

    const garnet_privatesub = new GarnetPrivateSub(this, 'GarnetPrivateSub', {
      vpc: garnet_common.vpc, 
      bucket_name: garnet_datalake.bucket_name
    })

    const garnet_api = new GarnetApi(this, 'GarnetApi', {
      vpc: garnet_common.vpc, 
      garnet_ingestion_sqs_arn: garnet_ingestion_stack.sqs_garnet_ingestion_arn,
      dns_context_broker: garnet_broker_stack.dns_context_broker,
      garnet_private_endpoint: garnet_privatesub.private_sub_endpoint,
      fargate_alb: garnet_broker_stack.fargate_alb,
      secret_api_jwt: garnet_common.secret_api_jwt
  })

    const garnet_ops_stack = new GarnetOps(this, 'GarnetOps', {})

    new CfnOutput(this, 'GarnetVersion', {
      value: garnet_constant.garnet_version,
      description: 'Version of Garnet Framework'
    })
    new CfnOutput(this, 'GarnetArchitecture', {
      value: deployment_params.architecture,
      description: 'Architecture deployed'
    })
    new CfnOutput(this, 'GarnetEndpoint', {
      value: garnet_api.broker_api_endpoint,
      description: 'Garnet Unified API'
    })
    new CfnOutput(this, 'GarnetApiToken', {
      value: garnet_api.garnet_api_token,
      description: `Authentication token for Garnet API. Use in HTTP headers as: Authorization: <token>. Example: curl -H "Auth: <token>" <garnet-endpoint>`
    })
    new CfnOutput(this, 'GarnetPrivateSubEndpoint', {
      value: garnet_privatesub.private_sub_endpoint,
      description: 'Garnet Private Notification Endpoint for Secured Subscriptions. Only accessible within the Garnet VPC'
    })
    new CfnOutput(this, 'GarnetIngestionQueue', {
      value: garnet_ingestion_stack.sqs_garnet_ingestion_url,
      description: 'Garnet SQS Queue URL to ingest data from your Data Producers'
    })

    new CfnOutput(this, 'BucketDatalakeName', {
      value: garnet_datalake.bucket_name,
      description: 'Name of the S3 Bucket for the datalake'
    })




  }
}
