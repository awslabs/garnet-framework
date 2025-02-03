const { SecretsManagerClient, GetSecretValueCommand } = require("@aws-sdk/client-secrets-manager")
const jwt = require('jsonwebtoken')

exports.handler = async (event, context) => {

  try {
    const client = new SecretsManagerClient({});
    const command = new GetSecretValueCommand({
      SecretId: process.env.SECRET_ARN
    })

    const response = await client.send(command);
    const secret = response.SecretString;

    const token = jwt.sign({
      sub: process.env.JWT_SUB,
      iss: process.env.JWT_ISS,
      aud: process.env.JWT_AUD
    }, secret);

    return {
      Status: 'SUCCESS',
      Data: {
        token: token
      }
    };
  } 
  catch (e) {
    console.log(e)
    return {
      Status: 'FAILED',
      Reason: error.message
    }
  }
};