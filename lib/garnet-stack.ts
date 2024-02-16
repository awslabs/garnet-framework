import { CfnElement, CfnOutput, Names, Stack, StackProps } from 'aws-cdk-lib'
import { Construct } from 'constructs'
import { GarnetScorpio } from './stacks/garnet-scorpio/garnet-scorpio'
import { GarnetIotStack } from './stacks/garnet-iot/garnet-iot-stack'
import { garnet_constant } from '../constants'
import { GarnetConstructs } from './stacks/garnet-constructs/garnet-constructs'
import { GarnetOps } from './stacks/garnet-ops/garnet-ops'



export class GarnetStack extends Stack {


  getLogicalId(element: CfnElement): string {
    if (element?.node?.id?.includes('NestedStackResource')) {
        let stack_name = /([a-zA-Z0-9]+)\.NestedStackResource/.exec(element.node.id)![1]
        return stack_name
    }
    return super.getLogicalId(element)
  }

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props)

    const garnet_constructs = new GarnetConstructs(this, 'CommonContructs', {})

    let garnet_broker_stack = new GarnetScorpio(this, 'ScorpioBroker', {
        vpc: garnet_constructs.vpc, 
        secret: garnet_constructs.secret
      })

    const garnet_iot_stack  = new GarnetIotStack(this, 'GarnetIoT', {
      dns_context_broker: garnet_broker_stack.dns_context_broker, 
      vpc: garnet_constructs.vpc, 
      api_ref: garnet_broker_stack.api_ref,
      bucket_name: garnet_constructs.bucket_name,
      az1: garnet_constructs.az1,
      az2: garnet_constructs.az2
    })

    const garnet_ops_stack = new GarnetOps(this, 'GarnetOps', {})

    new CfnOutput(this, 'GarnetEndpoint', {
      value: garnet_broker_stack.broker_api_endpoint,
      description: 'Garnet Unified API to access the Context Broker and Garnet IoT Capabilities'
    })

    new CfnOutput(this, 'GarnetPrivateSubEndpoint', {
      value: garnet_iot_stack.private_sub_endpoint,
      description: 'Garnet Private Notification Endpoint for Secured Subscriptions. Only accessible within the Garnet VPC'
    })

    new CfnOutput(this, 'GarnetIotQueueUrl', {
      value: garnet_iot_stack.iot_sqs_endpoint_url,
      description: 'Garnet IoT SQS Queue URL to connect your Data Producers'
    })

    new CfnOutput(this, 'GarnetVersion', {
      value: garnet_constant.garnet_version,
      description: 'Version of Garnet Framework'
    })


  }
}
