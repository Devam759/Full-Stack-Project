import { ERROR_CODES, formatErrorResponse } from '@borrowloop/shared';

/**
 * Creates a rate limiting middleware backed by Redis, with an in-memory fallback.
 *
 * @param {object} options
 * @param {import('ioredis').Redis} [options.redis]
 * @param {number} [options.windowSeconds=60]
 * @param {number} [options.maxRequests=60]
 * @param {string} [options.keyPrefix='rl']
 * @param {Function} [options.keyGenerator]
 */
export function createRateLimiter({
  redis,
  windowSeconds = 60,
  maxRequests = 60,
  keyPrefix = 'rl',
  keyGenerator = (req) => req.ip || req.connection.remoteAddress || 'unknown',
} = {}) {
  const memoryStore = new Map();

  return async function rateLimiter(req, res, next) {
    const limit = typeof maxRequests === 'function' ? maxRequests(req) : maxRequests;
    const identifier = keyGenerator(req);
    const key = `${keyPrefix}:${identifier}`;

    try {
      if (redis && redis.status === 'ready') {
        const pipeline = redis.pipeline();
        pipeline.incr(key);
        pipeline.ttl(key);
        const results = await pipeline.exec();

        const count = results[0][1];
        let ttl = results[1][1];

        if (ttl === -1) {
          await redis.expire(key, windowSeconds);
          ttl = windowSeconds;
        }

        res.setHeader('RateLimit-Limit', limit);
        res.setHeader('RateLimit-Remaining', Math.max(0, limit - count));
        res.setHeader('RateLimit-Reset', ttl);

        if (count > limit) {
          res.setHeader('Retry-After', ttl);
          return res
            .status(429)
            .json(
              formatErrorResponse(
                ERROR_CODES.RATE_LIMITED,
                'Too many requests, please try again later',
                { retryAfterSeconds: ttl },
              ),
            );
        }
        return next();
      }
    } catch {
      // If Redis fails, fall through to in-memory store
    }

    // In-memory fallback
    const now = Date.now();
    const entry = memoryStore.get(key) || { count: 0, resetAt: now + windowSeconds * 1000 };

    if (now > entry.resetAt) {
      entry.count = 0;
      entry.resetAt = now + windowSeconds * 1000;
    }

    entry.count += 1;
    memoryStore.set(key, entry);

    const ttlSeconds = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
    res.setHeader('RateLimit-Limit', limit);
    res.setHeader('RateLimit-Remaining', Math.max(0, limit - entry.count));
    res.setHeader('RateLimit-Reset', ttlSeconds);

    if (entry.count > limit) {
      res.setHeader('Retry-After', ttlSeconds);
      return res
        .status(429)
        .json(
          formatErrorResponse(
            ERROR_CODES.RATE_LIMITED,
            'Too many requests, please try again later',
            { retryAfterSeconds: ttlSeconds },
          ),
        );
    }

    return next();
  };
}

export default createRateLimiter;
