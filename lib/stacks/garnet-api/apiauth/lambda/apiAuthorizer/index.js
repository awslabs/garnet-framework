const { SecretsManagerClient, GetSecretValueCommand } = require("@aws-sdk/client-secrets-manager")
const jwt = require('jsonwebtoken')

// Cache variable outside the handler to persist between invocations
let cachedSecret = null;
let lastFetchTime = null;
const CACHE_TTL = 1000 * 60;

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
      if (
        typeof response.SecretString !== 'string' ||
        response.SecretString === ''
      ) {
        throw new Error('JWT signing secret has no SecretString')
      }
      cachedSecret = response.SecretString;
      lastFetchTime = currentTime
    }

    // Verify token
    const decoded = jwt.verify(token, cachedSecret, {
      issuer: process.env.JWT_ISS,
      audience: process.env.JWT_AUD,
      algorithms: ['HS256'],
      maxAge: positiveInteger(
        process.env.JWT_MAX_AGE_SECONDS,
        'JWT_MAX_AGE_SECONDS'
      )
    });
    const currentEpochSeconds = Math.floor(currentTime / 1000)
    if (
      typeof decoded !== 'object' ||
      decoded === null ||
      typeof decoded.sub !== 'string' ||
      decoded.sub.trim() === '' ||
      typeof decoded.tenant !== 'string' ||
      decoded.tenant.trim() === '' ||
      /[\0\r\n]/.test(decoded.tenant) ||
      !Number.isSafeInteger(decoded.iat) ||
      !Number.isSafeInteger(decoded.exp) ||
      decoded.exp <= currentEpochSeconds ||
      decoded.exp <= decoded.iat
    ) {
      return { isAuthorized: false }
    }

    return {
      isAuthorized: true,
      context: {
        sub: decoded.sub.trim(),
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
