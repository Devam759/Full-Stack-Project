import * as OTPAuth from 'otpauth';
import { encryptSecret, decryptSecret } from '../common/crypto.js';
import { BUSINESS_CONFIG } from '@borrowloop/shared';

const { TOTP_SETTINGS } = BUSINESS_CONFIG;

/**
 * Generates a new TOTP secret for user enrollment.
 * @param {string} email
 * @returns {{ secretBase32: string, uri: string, encryptedSecret: string }}
 */
export function generateTotpSecret(email) {
  const secret = new OTPAuth.Secret({ size: 20 });
  const secretBase32 = secret.base32;

  const totp = new OTPAuth.TOTP({
    issuer: TOTP_SETTINGS.ISSUER,
    label: email,
    algorithm: 'SHA1',
    digits: 6,
    period: TOTP_SETTINGS.STEP_SECONDS,
    secret,
  });

  return {
    secretBase32,
    uri: totp.toString(),
    encryptedSecret: encryptSecret(secretBase32),
  };
}

/**
 * Validates a 6-digit TOTP code against an encrypted secret with replay protection.
 *
 * @param {object} params
 * @param {string} params.code - 6 digit code
 * @param {string} params.encryptedSecret - Encrypted base32 secret
 * @param {number} [params.lastStep=0] - Last successfully used timestamp step
 * @param {string} [params.email='user']
 * @returns {{ valid: boolean, newStep: number }}
 */
export function verifyTotpCode({ code, encryptedSecret, lastStep = 0, email = 'user' }) {
  if (!code || !encryptedSecret) {
    return { valid: false, newStep: 0 };
  }

  try {
    const secretBase32 = decryptSecret(encryptedSecret);
    const totp = new OTPAuth.TOTP({
      issuer: TOTP_SETTINGS.ISSUER,
      label: email,
      algorithm: 'SHA1',
      digits: 6,
      period: TOTP_SETTINGS.STEP_SECONDS,
      secret: OTPAuth.Secret.fromBase32(secretBase32),
    });

    const delta = totp.validate({
      token: code.trim(),
      window: TOTP_SETTINGS.WINDOW,
    });

    if (delta === null) {
      return { valid: false, newStep: 0 };
    }

    // Current time-step counter
    const currentStep = Math.floor(Date.now() / 1000 / TOTP_SETTINGS.STEP_SECONDS);
    const validatedStep = currentStep + delta;

    // Block code reuse: token must be strictly newer than the last verified step
    if (validatedStep <= lastStep) {
      return { valid: false, newStep: 0, replayed: true };
    }

    return { valid: true, newStep: validatedStep };
  } catch {
    return { valid: false, newStep: 0 };
  }
}
