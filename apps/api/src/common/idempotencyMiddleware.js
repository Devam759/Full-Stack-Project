/**
 * @file apps/api/src/common/idempotencyMiddleware.js
 * Express middleware for request-level idempotency using the canonical
 * idempotency utilities from @borrowloop/server-core.
 */

import { AppError, ERROR_CODES } from '@borrowloop/shared';
import {
  IdempotencyKey,
  canonicalJsonStringify,
  computeRequestHash,
  saveIdempotencyRecord,
  isIdempotencyDuplicateError,
  handleIdempotencyConflict,
} from '@borrowloop/server-core';

export {
  canonicalJsonStringify,
  computeRequestHash,
  saveIdempotencyRecord,
  isIdempotencyDuplicateError,
  handleIdempotencyConflict,
};

/**
 * Middleware that checks Idempotency-Key header, validates key against existing records,
 * and attaches idempotency context to req.idempotency.
 */
export function requireIdempotencyKey() {
  return async (req, res, next) => {
    try {
      const key = req.headers['idempotency-key'];
      if (!key || typeof key !== 'string') {
        return next(
          new AppError(
            ERROR_CODES.INVALID_IDEMPOTENCY_KEY,
            'Missing or empty Idempotency-Key header',
            400,
          ),
        );
      }

      const trimmedKey = key.trim();
      const IDEMPOTENCY_KEY_REGEX = /^[A-Za-z0-9_-]+$/;
      if (
        trimmedKey.length < 8 ||
        trimmedKey.length > 128 ||
        !IDEMPOTENCY_KEY_REGEX.test(trimmedKey)
      ) {
        return next(
          new AppError(
            ERROR_CODES.INVALID_IDEMPOTENCY_KEY,
            'Idempotency-Key must be 8-128 characters containing only letters, numbers, hyphens, and underscores',
            400,
            { key: trimmedKey },
          ),
        );
      }
      const userId = req.user?._id;
      if (!userId) {
        return next(
          new AppError(
            ERROR_CODES.UNAUTHORIZED,
            'User must be authenticated for idempotent operations',
            401,
          ),
        );
      }

      const requestHash = computeRequestHash(req.method, req.originalUrl, req.body);

      // Check existing record
      const existing = await IdempotencyKey.findOne({ userId, key: trimmedKey });
      if (existing) {
        if (existing.requestHash !== requestHash) {
          return next(
            new AppError(
              ERROR_CODES.IDEMPOTENCY_KEY_REUSE,
              'Idempotency key has already been used with different request parameters',
              409,
              { key: trimmedKey },
            ),
          );
        }

        // Return saved response directly
        res.setHeader('X-Idempotent-Replay', 'true');
        return res.status(existing.statusCode).json(existing.responseBody);
      }

      // Attach context for route/service execution
      req.idempotency = {
        key: trimmedKey,
        requestHash,
        userId,
      };

      return next();
    } catch (err) {
      return next(err);
    }
  };
}

export default {
  canonicalJsonStringify,
  computeRequestHash,
  requireIdempotencyKey,
  saveIdempotencyRecord,
  isIdempotencyDuplicateError,
  handleIdempotencyConflict,
};
