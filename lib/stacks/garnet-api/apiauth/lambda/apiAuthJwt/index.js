const {
  GetSecretValueCommand,
  PutSecretValueCommand,
  SecretsManagerClient
} = require("@aws-sdk/client-secrets-manager")
const jwt = require('jsonwebtoken')

exports.handler = async event => {
  if (event.RequestType === 'Delete') {
    return {}
  }

  const client = new SecretsManagerClient({});
  const command = new GetSecretValueCommand({
    SecretId: process.env.SECRET_ARN
  })

  const response = await client.send(command);
  const secret = response.SecretString;
  if (!secret) {
    throw new Error('JWT signing secret has no SecretString')
  }

  const token = jwt.sign({
    sub: process.env.JWT_SUB,
    iss: process.env.JWT_ISS,
    aud: process.env.JWT_AUD,
    tenant: process.env.JWT_TENANT
  }, secret, {
    algorithm: 'HS256'
  });

  await client.send(new PutSecretValueCommand({
    SecretId: process.env.TOKEN_SECRET_ARN,
    SecretString: JSON.stringify({ Authorization: token })
  }))

  return {
    Data: {
      tokenSecretArn: process.env.TOKEN_SECRET_ARN
    }
  };
};
