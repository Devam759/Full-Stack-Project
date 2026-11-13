/**
 * @file packages/server-core/src/jobs/jobFramework.js
 * Reusable distributed job execution framework with Redis locking,
 * error boundaries, timing metrics, and safe concurrency control.
 */

import crypto from 'crypto';

const RELEASE_LOCK_LUA = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
`;

/**
 * Runs a task protected by a distributed Redis lock (SET NX PX).
 * Ensures only a single instance executes the job at any given time.
 *
 * @param {object} params
 * @param {string} params.name - Unique job/task name for the lock key
 * @param {number} [params.lockTtlMs=30000] - Lock TTL in milliseconds
 * @param {import('ioredis').Redis} params.redisClient - Redis client instance
 * @param {() => Promise<any>} params.handler - Async function executing the job work
 * @param {object} [params.logger] - Optional logger instance
 * @returns {Promise<{ success: boolean, skipped?: boolean, result?: any, error?: Error, durationMs: number }>}
 */
export async function runWithRedisLock({
  name,
  lockTtlMs = 30000,
  redisClient,
  handler,
  logger = console,
}) {
  if (!redisClient) {
    throw new Error('Redis client is required for runWithRedisLock');
  }

  const lockKey = `lock:${name}`;
  const lockToken = crypto.randomUUID();
  const startTime = Date.now();

  let acquired = false;
  try {
    const acquireResult = await redisClient.set(lockKey, lockToken, 'PX', lockTtlMs, 'NX');
    acquired = acquireResult === 'OK';
  } catch (err) {
    logger.error?.(
      { job: name, err: err.message },
      'Failed to communicate with Redis for job lock',
    );
    return {
      success: false,
      skipped: true,
      error: err,
      durationMs: Date.now() - startTime,
    };
  }

  if (!acquired) {
    logger.debug?.({ job: name }, 'Job skipped; lock already held by another instance');
    return {
      success: false,
      skipped: true,
      reason: 'LOCKED',
      durationMs: Date.now() - startTime,
    };
  }

  try {
    const result = await handler();
    const durationMs = Date.now() - startTime;
    logger.info?.({ job: name, durationMs }, 'Job completed successfully');
    return {
      success: true,
      ...(typeof result === 'object' && result !== null ? result : { result }),
      durationMs,
    };
  } catch (err) {
    const durationMs = Date.now() - startTime;
    logger.error?.({ job: name, durationMs, err: err.message }, 'Job execution failed');
    return {
      success: false,
      error: err,
      durationMs,
    };
  } finally {
    try {
      await redisClient.eval(RELEASE_LOCK_LUA, 1, lockKey, lockToken);
    } catch (releaseErr) {
      logger.warn?.({ job: name, err: releaseErr.message }, 'Failed to cleanly release Redis lock');
    }
  }
}
