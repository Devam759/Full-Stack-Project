import crypto from 'crypto';
import argon2 from 'argon2';
import config from '../config/index.js';

// Pre-computed dummy argon2id hash to prevent timing attacks when an email does not exist
export const DUMMY_ARGON2_HASH =
  '$argon2id$v=19$m=65536,t=3,p=4$dGVzdHNhbHQxMjM0NTY3OA$u1fV4g7fWp+7+f83hK88wWJ8wB0+Y8l1N5N6+4n5KkY';

/**
 * Hashes a plain password using argon2id.
 * @param {string} password
 * @returns {Promise<string>}
 */
export async function hashPassword(password) {
  return argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 4,
  });
}

/**
 * Verifies a plain password against an argon2id hash.
 * @param {string} hash
 * @param {string} password
 * @returns {Promise<boolean>}
 */
export async function verifyPassword(hash, password) {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

/**
 * Computes a SHA-256 hash of a token string.
 * @param {string} token
 * @returns {string} hex string
 */
export function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Generates a cryptographically secure random token string.
 * @param {number} [bytes=32]
 * @returns {string} hex string
 */
export function generateRandomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('hex');
}

/**
 * Derives a 32-byte key from JWT_ACCESS_SECRET for AES-256-GCM.
 */
function getEncryptionKey() {
  return crypto.createHash('sha256').update(config.JWT_ACCESS_SECRET).digest();
}

/**
 * Encrypts a sensitive string (e.g. totpSecret) using AES-256-GCM.
 * @param {string} plaintext
 * @returns {string} iv:authTag:ciphertext (base64)
 */
export function encryptSecret(plaintext) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted.toString('base64')}`;
}

/**
 * Decrypts an encrypted string (iv:authTag:ciphertext).
 * @param {string} encryptedString
 * @returns {string} plaintext
 */
export function decryptSecret(encryptedString) {
  const [ivB64, authTagB64, encryptedB64] = encryptedString.split(':');
  if (!ivB64 || !authTagB64 || !encryptedB64) {
    throw new Error('Invalid encrypted payload format');
  }

  const iv = Buffer.from(ivB64, 'base64');
  const authTag = Buffer.from(authTagB64, 'base64');
  const encrypted = Buffer.from(encryptedB64, 'base64');

  const decipher = crypto.createDecipheriv('aes-256-gcm', getEncryptionKey(), iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString('utf8');
}
