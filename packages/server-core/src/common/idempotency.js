/**
 * @file packages/server-core/src/common/idempotency.js
 * Core idempotency utilities shared across API and worker services.
 */

import crypto from 'node:crypto';
import { AppError, ERROR_CODES } from '@borrowloop/shared';
import IdempotencyKey from '../models/IdempotencyKey.js';

/**
 * Produces a deterministic canonical JSON string with sorted keys.
 *
 * @param {unknown} obj
 * @returns {string}
 */
export function canonicalJsonStringify(obj) {
  if (obj === null || typeof obj !== 'object') {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return `[${obj.map(canonicalJsonStringify).join(',')}]`;
  }
  const sortedKeys = Object.keys(obj).sort();
  const pairs = sortedKeys.map(
    (key) => `${JSON.stringify(key)}:${canonicalJsonStringify(obj[key])}`,
  );
  return `{${pairs.join(',')}}`;
}

/**
 * Computes a SHA-256 hash of the request method, target URL, and canonicalized body.
 *
 * @param {string} method
 * @param {string} url
 * @param {unknown} body
 * @returns {string} hex digest
 */
export function computeRequestHash(method, url, body) {
  const hash = crypto.createHash('sha256');
  hash.update(`${method.toUpperCase()}:${url}:`);
  hash.update(canonicalJsonStringify(body || {}));
  return hash.digest('hex');
}

/**
 * Saves an idempotency record inside an optional MongoDB transaction session.
 */
export async function saveIdempotencyRecord({
  userId,
  key,
  requestHash,
  statusCode = 200,
  responseBody = {},
  session = null,
}) {
  if (!key) return null;
  const record = new IdempotencyKey({
    userId,
    key,
    requestHash,
    statusCode,
    responseBody,
  });
  await record.save(session ? { session } : {});
  return record;
}

export function isIdempotencyDuplicateError(err) {
  if (!err) return false;
  if (err.code === 11000) {
    const msg = String(err.message || '');
    if (
      msg.includes('idempotency_keys') ||
      msg.includes('IdempotencyKey') ||
      err.keyPattern?.key ||
      err.keyValue?.key
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Handles duplicate key conflict on IdempotencyKey by polling/returning saved response
 * or throwing 409 IDEMPOTENCY_KEY_REUSE / IDEMPOTENCY_IN_PROGRESS.
 */
export async function handleIdempotencyConflict({ userId, idempotency, key, requestHash }) {
  const ikKey = key || idempotency?.key;
  const reqHash = requestHash || idempotency?.requestHash;
  if (!ikKey) return null;

  let existing = await IdempotencyKey.findOne({
    userId,
    key: ikKey,
  });
  if (!existing) {
    for (let i = 0; i < 4; i++) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      existing = await IdempotencyKey.findOne({
        userId,
        key: ikKey,
      });
      if (existing) break;
    }
  }
  if (existing) {
    if (reqHash && existing.requestHash !== reqHash) {
      throw new AppError(
        ERROR_CODES.IDEMPOTENCY_KEY_REUSE,
        'Idempotency key has already been used with different request parameters',
        409,
      );
    }
    return {
      ...existing.responseBody,
      _isReplay: true,
      _statusCode: existing.statusCode,
    };
  }
  throw new AppError(
    ERROR_CODES.IDEMPOTENCY_IN_PROGRESS,
    'A request with this idempotency key is currently in progress',
    409,
  );
}

export default {
  canonicalJsonStringify,
  computeRequestHash,
  saveIdempotencyRecord,
  isIdempotencyDuplicateError,
  handleIdempotencyConflict,
};
