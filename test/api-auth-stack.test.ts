import { App, Stack } from 'aws-cdk-lib'
import { Match, Template } from 'aws-cdk-lib/assertions'
import { Secret } from 'aws-cdk-lib/aws-secretsmanager'
import {
  GarnetApiAuthJwt
} from '../lib/stacks/garnet-api/apiauth/api-auth-construct'

describe('API client credential infrastructure', () => {
  const synth_auth = (): Template => {
    const app = new App()
    const stack = new Stack(app, 'AuthTest', {
      env: {
        account: '111111111111',
        region: 'eu-west-3'
      }
    })
    const signing_secret = new Secret(stack, 'SigningSecret')

    new GarnetApiAuthJwt(stack, 'ApiAuth', {
      secret_api_jwt: signing_secret
    })

    return Template.fromStack(stack)
  }

  it('stores the client credential in a dedicated named secret', () => {
    const template = synth_auth()

    template.resourceCountIs('AWS::SecretsManager::Secret', 2)
    template.hasResourceProperties('AWS::SecretsManager::Secret', {
      Name: 'garnet-framework/secret/api-client',
      Description:
        'Rotating Authorization header used by trusted Garnet API clients'
    })
  })

  it('grants only the generator permission to write the client secret', () => {
    const template = synth_auth()

    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: Match.arrayWith([
              'secretsmanager:PutSecretValue'
            ]),
            Effect: 'Allow'
          })
        ])
      }
    })
    template.hasResourceProperties('AWS::Lambda::Function', {
      Environment: {
        Variables: Match.objectLike({
          TOKEN_SECRET_ARN: Match.anyValue()
        })
      }
    })
  })

  it('forces existing stacks to invoke the provisioner on upgrade', () => {
    const template = synth_auth()

    template.hasResourceProperties('AWS::CloudFormation::CustomResource', {
      TokenSecretArn: Match.anyValue(),
      Tenant: 'default',
      TokenSchemaVersion: 'tenant-v2-expiring'
    })
  })

  it('refreshes the expiring credential daily with durable failure capture', () => {
    const template = synth_auth()

    template.hasResourceProperties('AWS::Events::Rule', {
      ScheduleExpression: 'rate(1 day)',
      State: 'ENABLED',
      Targets: Match.arrayWith([
        Match.objectLike({
          DeadLetterConfig: {
            Arn: Match.anyValue()
          },
          RetryPolicy: {
            MaximumEventAgeInSeconds: 86400,
            MaximumRetryAttempts: 185
          }
        })
      ])
    })
    template.hasResourceProperties('AWS::SQS::Queue', {
      QueueName: 'garnet-framework-api-token-refresh-dlq',
      SqsManagedSseEnabled: true,
      MessageRetentionPeriod: 1209600
    })
    template.hasResourceProperties('AWS::Lambda::EventInvokeConfig', {
      MaximumEventAgeInSeconds: 21600,
      MaximumRetryAttempts: 2
    })
    template.hasResourceProperties('AWS::Lambda::Function', {
      Environment: {
        Variables: Match.objectLike({
          JWT_TTL_SECONDS: '2592000'
        })
      }
    })
    template.hasResourceProperties('AWS::Lambda::Function', {
      Environment: {
        Variables: Match.objectLike({
          JWT_MAX_AGE_SECONDS: '2678400'
        })
      }
    })
    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      AlarmName: 'garnet-framework-api-token-refresh-errors',
      Threshold: 0,
      EvaluationPeriods: 1,
      TreatMissingData: 'notBreaching'
    })
    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      AlarmName: 'garnet-framework-api-token-refresh-delivery'
    })
    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      AlarmName: 'garnet-framework-api-token-refresh-dead-letter'
    })
  })

  it('does not grant API Gateway account-wide authorizer access', () => {
    const permissions = Object.values(
      synth_auth().findResources('AWS::Lambda::Permission')
    ) as any[]

    expect(
      permissions.some(
        (permission) =>
          permission.Properties.Principal ===
          'apigateway.amazonaws.com'
      )
    ).toBe(false)
  })
})
