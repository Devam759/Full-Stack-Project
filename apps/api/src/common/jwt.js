import jwt from 'jsonwebtoken';
import config from '../config/index.js';
import { BUSINESS_CONFIG } from '@borrowloop/shared';

const { TOKEN_AUDIENCES } = BUSINESS_CONFIG;

/**
 * Signs an access token for user or portal sessions.
 * @param {object} payload
 * @param {string} payload.sub - User ID
 * @param {string} payload.role - User role
 * @param {string} audience - Expected audience (borrowloop:user or borrowloop:portal)
 * @returns {string} JWT string
 */
export function signAccessToken(payload, audience = TOKEN_AUDIENCES.USER) {
  return jwt.sign(
    {
      sub: payload.sub,
      role: payload.role,
    },
    config.JWT_ACCESS_SECRET,
    {
      expiresIn: BUSINESS_CONFIG.ACCESS_TOKEN_EXPIRY_SECONDS,
      audience,
      issuer: 'borrowloop-api',
    },
  );
}

/**
 * Signs a short-lived (5 min) pre-TOTP token for portal login step 1.
 * Only valid for audience borrowloop:portal_pre_totp.
 * @param {object} payload
 * @param {string} payload.sub
 * @returns {string} JWT string
 */
export function signPreTotpToken(payload) {
  return jwt.sign(
    {
      sub: payload.sub,
      purpose: 'portal_pre_totp',
    },
    config.JWT_ACCESS_SECRET,
    {
      expiresIn: 300, // 5 minutes
      audience: TOKEN_AUDIENCES.PORTAL_PRE_TOTP,
      issuer: 'borrowloop-api',
    },
  );
}

/**
 * Verifies an access token and validates its audience.
 * @param {string} token
 * @param {string} expectedAudience
 * @returns {object} decoded payload
 */
export function verifyAccessToken(token, expectedAudience) {
  return jwt.verify(token, config.JWT_ACCESS_SECRET, {
    audience: expectedAudience,
    issuer: 'borrowloop-api',
  });
}
