const { SecretsManagerClient, GetSecretValueCommand } = require("@aws-sdk/client-secrets-manager")
const jwt = require('jsonwebtoken')

// Cache variable outside the handler to persist between invocations
let cachedSecret = null;
let lastFetchTime = null;
const CACHE_TTL = 1000 * 60 * 60; // 1 hour in milliseconds

exports.handler = async (event) => {
  try {
 // Check for token in query parameters
 const authParam = event.queryStringParameters?.token;
    
 // Fallback to Authorization header if not in query parameters
 const authHeader = event.headers?.authorization;

 if (!authParam && !authHeader) {
   console.log('No token provided');
   return { isAuthorized: false };
 }

 // Use token from query parameter if available, otherwise use from header
    const token = authParam || authHeader;


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
      audience: process.env.JWT_AUD
    });

    console.log(decoded)
    return {
      isAuthorized: true,
      context: {
        sub: decoded.sub,
        iss: decoded.iss,
        aud: decoded.aud
      }
    };

  } catch (error) {
    console.error('Authorization error:', error);
    return { isAuthorized: false };
  }
}