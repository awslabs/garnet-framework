const { SecretsManagerClient, GetSecretValueCommand } = require("@aws-sdk/client-secrets-manager")
const jwt = require('jsonwebtoken')

// Cache variable outside the handler to persist between invocations
let cachedSecret = null;
let lastFetchTime = null;
const CACHE_TTL = 1000 * 60 * 60; // 1 hour in milliseconds

const authorizationToken = (event) => {
  const value =
    event.headers?.authorization ??
    event.headers?.Authorization
  if (typeof value !== 'string' || value.trim() === '') {
    return null
  }
  return value.replace(/^Bearer\s+/i, '').trim()
}

exports.handler = async (event) => {
  try {
    const token = authorizationToken(event)
    if (!token) {
      return { isAuthorized: false }
    }

    // Get secret from cache or fetch new
    const currentTime = Date.now();
    if (!cachedSecret || !lastFetchTime || (currentTime - lastFetchTime) > CACHE_TTL) {
      const client = new SecretsManagerClient({})
      const command = new GetSecretValueCommand({
        SecretId: process.env.SECRET_ARN
      })

      const response = await client.send(command);
      cachedSecret = response.SecretString;
      lastFetchTime = currentTime
    }

    // Verify token
    const decoded = jwt.verify(token, cachedSecret, {
      issuer: process.env.JWT_ISS,
      audience: process.env.JWT_AUD,
      algorithms: ['HS256']
    });
    if (
      typeof decoded !== 'object' ||
      decoded === null ||
      typeof decoded.tenant !== 'string' ||
      decoded.tenant.trim() === '' ||
      /[\0\r\n]/.test(decoded.tenant)
    ) {
      return { isAuthorized: false }
    }

    return {
      isAuthorized: true,
      context: {
        sub: String(decoded.sub ?? ''),
        iss: String(decoded.iss ?? ''),
        aud: String(decoded.aud ?? ''),
        tenant: decoded.tenant.trim()
      }
    };

  } catch (error) {
    console.error('Authorization error:', error);
    return { isAuthorized: false };
  }
}

exports.authorizationToken = authorizationToken
