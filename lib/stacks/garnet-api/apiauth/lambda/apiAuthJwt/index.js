const {
  GetSecretValueCommand,
  PutSecretValueCommand,
  SecretsManagerClient
} = require("@aws-sdk/client-secrets-manager")
const jwt = require('jsonwebtoken')

const positiveInteger = (value, name) => {
  if (!/^[1-9]\d*$/.test(value ?? '')) {
    throw new Error(`${name} must be a positive integer`)
  }
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`${name} must be a safe integer`)
  }
  return parsed
}

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

  const issuedAt = Math.floor(Date.now() / 1000)
  const expiresAt = issuedAt + positiveInteger(
    process.env.JWT_TTL_SECONDS,
    'JWT_TTL_SECONDS'
  )
  const token = jwt.sign({
    sub: process.env.JWT_SUB,
    iss: process.env.JWT_ISS,
    aud: process.env.JWT_AUD,
    tenant: process.env.JWT_TENANT,
    iat: issuedAt,
    exp: expiresAt
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
