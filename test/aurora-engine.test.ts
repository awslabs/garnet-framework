import { App, Stack } from 'aws-cdk-lib'
import { Template } from 'aws-cdk-lib/assertions'
import { CfnDBCluster } from 'aws-cdk-lib/aws-rds'
import { GarnetStack } from '../lib/garnet-stack'
import { Parameters } from '../configuration'

// Regression check for the Aurora PostgreSQL engine pin. Aurora retires minor versions,
// and a pin to a retired minor makes every new deployment fail at cluster creation.
// This test keeps the pin explicit and reviewable: an ordinary (non-Limitless)
// aurora-postgresql 16.x cluster on Serverless v2, at the version below.
const EXPECTED_ENGINE_VERSION = '16.8'

test('Aurora cluster pins an ordinary aurora-postgresql 16 minor on Serverless v2', () => {
  const app = new App()
  const stack = new GarnetStack(app, 'Garnet', { env: { region: Parameters.aws_region } })

  const clusters = stack.node.findAll().filter((c): c is CfnDBCluster => c instanceof CfnDBCluster)
  expect(clusters).toHaveLength(1)

  const template = Template.fromStack(Stack.of(clusters[0]))
  template.resourceCountIs('AWS::RDS::DBCluster', 1)
  const props = Object.values(template.findResources('AWS::RDS::DBCluster'))[0].Properties

  expect(props.Engine).toBe('aurora-postgresql')
  expect(props.EngineVersion).toBe(EXPECTED_ENGINE_VERSION)
  expect(String(props.EngineVersion)).not.toMatch(/limitless/i)
  expect(props.ClusterScalabilityType).toBeUndefined()
  expect(props.ServerlessV2ScalingConfiguration).toBeDefined()
})
