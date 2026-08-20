/**
 * Tests for the broker deployment strategy wiring.
 *
 * These assert on the synthesized CloudFormation rather than on CDK objects,
 * because the properties that matter here (circuit breaker, BLUE_GREEN strategy,
 * the alternate target group behind the production listener rule) are what ECS
 * actually reads at deploy time.
 */

import { App, Stack } from 'aws-cdk-lib'
import { Template, Match } from 'aws-cdk-lib/assertions'

const CONFIG_PATH = require.resolve('../configuration')
const ARCHITECTURE_PATH = require.resolve('../architecture')

type Strategy = 'rolling' | 'bluegreen'

/**
 * The construct reads architecture and strategy from module-level config, so each
 * scenario needs a fresh module registry with the config patched before load.
 */
const synth_broker = (architecture: 'concentrated' | 'distributed', strategy: Strategy) => {
  jest.resetModules()

  const real_config = jest.requireActual<any>('../configuration')
  jest.doMock(CONFIG_PATH, () => ({
    Parameters: {
      ...real_config.Parameters,
      architecture,
      deployment_strategy: strategy
    }
  }))

  // architecture.ts derives deployment_params from Parameters at import time
  jest.doMock(ARCHITECTURE_PATH, () => {
    const actual = jest.requireActual<any>('../architecture')
    const base = architecture == 'concentrated'
      ? actual.deployment_params
      : actual.deployment_params
    return {
      ...actual,
      deployment_params: { ...base, architecture, deployment_strategy: strategy }
    }
  })

  const { GarnetScorpioFargate } = require('../lib/stacks/garnet-scorpio/fargate/container-construct')
  const { Vpc } = require('aws-cdk-lib/aws-ec2')
  const { SecurityGroup } = require('aws-cdk-lib/aws-ec2')
  const { CfnDeliveryStream } = require('aws-cdk-lib/aws-kinesisfirehose')

  const app = new App()
  const stack = new Stack(app, 'TestStack', { env: { region: 'us-east-1', account: '111111111111' } })
  const vpc = new Vpc(stack, 'Vpc', { maxAzs: 2 })
  const sg_proxy = new SecurityGroup(stack, 'SgProxy', { vpc })
  const delivery_stream = new CfnDeliveryStream(stack, 'Stream', { deliveryStreamName: 'test-stream' })

  new GarnetScorpioFargate(stack, 'Fargate', {
    vpc,
    sg_proxy,
    db_endpoint: 'db.example.internal',
    db_port: '5432',
    secret_arn: 'arn:aws:secretsmanager:us-east-1:111111111111:secret:garnet-abc123',
    image_context_broker: 'public.ecr.aws/garnet/scorpio:test',
    delivery_stream
  })

  return Template.fromStack(stack)
}

describe('broker deployment strategy', () => {
  afterEach(() => jest.resetModules())

  describe('rolling (default)', () => {
    it('enables the circuit breaker with rollback on the concentrated service', () => {
      const template = synth_broker('concentrated', 'rolling')

      template.hasResourceProperties('AWS::ECS::Service', {
        DeploymentConfiguration: Match.objectLike({
          DeploymentCircuitBreaker: { Enable: true, Rollback: true }
        })
      })
    })

    it('enables the circuit breaker on every distributed service', () => {
      const template = synth_broker('distributed', 'rolling')

      const services = template.findResources('AWS::ECS::Service')
      const names = Object.keys(services)
      expect(names.length).toBe(8)

      // A service without rollback can hang a failed deployment for hours
      for (const name of names) {
        expect(services[name].Properties.DeploymentConfiguration.DeploymentCircuitBreaker)
          .toEqual({ Enable: true, Rollback: true })
      }
    })

    it('does not request a blue/green strategy', () => {
      const template = synth_broker('concentrated', 'rolling')

      const services = template.findResources('AWS::ECS::Service')
      for (const name of Object.keys(services)) {
        expect(services[name].Properties.DeploymentConfiguration.Strategy).toBeUndefined()
      }
    })
  })

  describe('blue/green (concentrated)', () => {
    it('requests BLUE_GREEN with the configured bake time', () => {
      const template = synth_broker('concentrated', 'bluegreen')

      template.hasResourceProperties('AWS::ECS::Service', {
        DeploymentController: { Type: 'ECS' },
        DeploymentConfiguration: Match.objectLike({
          Strategy: 'BLUE_GREEN',
          BakeTimeInMinutes: 10
        })
      })
    })

    it('never drops below full capacity while shifting', () => {
      const template = synth_broker('concentrated', 'bluegreen')

      template.hasResourceProperties('AWS::ECS::Service', {
        DeploymentConfiguration: Match.objectLike({
          MinimumHealthyPercent: 100,
          MaximumPercent: 200
        })
      })
    })

    it('registers a single target with an alternate target group and both listener rules', () => {
      const template = synth_broker('concentrated', 'bluegreen')

      const services = template.findResources('AWS::ECS::Service')
      const service = services[Object.keys(services)[0]]
      const load_balancers = service.Properties.LoadBalancers

      // More than one registration means only the first would swap on a shift,
      // leaving the others pointed at the retired task set
      expect(load_balancers).toHaveLength(1)
      expect(load_balancers[0].AdvancedConfiguration).toBeDefined()
      expect(load_balancers[0].AdvancedConfiguration.ProductionListenerRule).toBeDefined()
      expect(load_balancers[0].AdvancedConfiguration.TestListenerRule).toBeDefined()
      expect(load_balancers[0].AdvancedConfiguration.AlternateTargetGroupArn).toBeDefined()
    })

    it('creates a separate test listener so a release can be validated before traffic shifts', () => {
      const template = synth_broker('concentrated', 'bluegreen')

      const ports = Object.values(template.findResources('AWS::ElasticLoadBalancingV2::Listener'))
        .map((l: any) => l.Properties.Port)
        .sort()

      expect(ports).toEqual([80, 8080])
    })

    it('creates distinct blue and green target groups', () => {
      const template = synth_broker('concentrated', 'bluegreen')

      const names = Object.values(template.findResources('AWS::ElasticLoadBalancingV2::TargetGroup'))
        .map((tg: any) => tg.Properties.Name)
        .sort()

      expect(names).toEqual(['garnet-broker-blue', 'garnet-broker-green'])
    })
  })

  describe('blue/green (distributed) is rejected', () => {
    it('fails fast rather than synthesizing a rollout that cannot shift atomically', () => {
      expect(() => synth_broker('distributed', 'bluegreen'))
        .toThrow(/BlueGreen is currently supported only with the Concentrated architecture/)
    })
  })
})
