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
      Name: 'garnet/secret/api-client',
      Description: 'Authorization header used by trusted Garnet API clients'
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
      TokenSecretArn: Match.anyValue()
    })
  })
})
