/**
 * @file apps/worker/src/jobs/reconciliationJob.js
 * Nightly reconciliation job for the BullMQ / worker process with:
 * - Fixed jobId repeatable schedule via BUSINESS_CONFIG.BACKGROUND_JOBS.LEDGER_RECONCILIATION_CRON
 * - Single concurrency & distributed lock to prevent multi-worker collisions
 * - Automatic resume of stale in_progress runs
 */

import crypto from 'node:crypto';
import { Queue, Worker } from 'bullmq';
import { BUSINESS_CONFIG } from '@borrowloop/shared';
import logger from '../logger.js';
import { runReconciliation, ReconciliationRun } from '@borrowloop/server-core';
const reconciliationService = { runReconciliation };

let reconciliationQueue = null;
let reconciliationWorker = null;
let activeRedisConnection = null;
let inProcessExecuting = false;

export const RECONCILIATION_QUEUE_NAME = 'ledger_reconciliation_queue';
export const RECONCILIATION_JOB_ID = 'ledger_reconciliation_nightly';
export const RECONCILIATION_LOCK_KEY = 'lock:reconciliation';
export const RECONCILIATION_LOCK_TTL_MS = 30_000;

const RELEASE_LOCK_LUA = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
`;

const EXTEND_LOCK_LUA = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("pexpire", KEYS[1], ARGV[2])
else
  return 0
end
`;

let testHoldHook = null;

/**
 * Injects a test hold hook for testing concurrency/locks.
 * Strictly wired only when NODE_ENV === 'test'.
 */
export function __setTestHoldHook(fn) {
  if (process.env.NODE_ENV === 'test') {
    testHoldHook = fn;
  }
}

/**
 * Executes the scheduled ledger reconciliation job with distributed lock and resume support.
 *
 * @param {object} [options]
 * @param {any} [options.redisClient]
 */
export async function executeReconciliationJob(options = {}) {
  if (inProcessExecuting) {
    logger.warn('Reconciliation execution already running in this process, skipping');
    return { skipped: true, reason: 'CONCURRENT_EXECUTION_BLOCKED' };
  }
  inProcessExecuting = true;

  const redis = options.redisClient || activeRedisConnection;
  const lockKey = RECONCILIATION_LOCK_KEY;
  const lockToken = crypto.randomUUID();
  const ttlMs = RECONCILIATION_LOCK_TTL_MS;
  let lockAcquired = false;
  let heartbeatTimer = null;

  if (redis && typeof redis.set === 'function') {
    const acquireResult = await redis.set(lockKey, lockToken, 'PX', ttlMs, 'NX');
    if (!acquireResult) {
      logger.warn('Distributed reconciliation lock currently held by another worker, skipping');
      return { skipped: true, reason: 'DISTRIBUTED_LOCK_ACQUIRED_BY_OTHER_WORKER' };
    }
    lockAcquired = true;

    // Start heartbeat timer to extend lock while job is executing
    const heartbeatInterval = Math.max(1000, Math.floor(ttlMs / 3));
    heartbeatTimer = setInterval(async () => {
      try {
        await redis.eval(EXTEND_LOCK_LUA, 1, lockKey, lockToken, String(ttlMs));
      } catch (err) {
        logger.warn({ err: err.message }, 'Failed to extend reconciliation distributed lock');
      }
    }, heartbeatInterval);
  }

  logger.info('Starting ledger reconciliation job with distributed lock');
  try {
    const timeoutMs = BUSINESS_CONFIG.RECONCILIATION_RESUME_TIMEOUT_MS || 15 * 60 * 1000;
    const staleThreshold = new Date(Date.now() - timeoutMs);

    // Check for stale run to resume
    const staleRun = await ReconciliationRun.findOne({
      status: 'in_progress',
      startedAt: { $lt: staleThreshold },
    }).sort({ startedAt: -1 });

    // Check for active young run already executing
    const activeYoungRun = await ReconciliationRun.findOne({
      status: 'in_progress',
      startedAt: { $gte: staleThreshold },
    });

    if (activeYoungRun) {
      logger.warn(
        { runId: activeYoungRun.runId },
        'Another young reconciliation run is currently in progress in DB, skipping',
      );
      return {
        skipped: true,
        reason: 'ACTIVE_RUN_IN_PROGRESS',
        runId: activeYoungRun.runId,
      };
    }

    let resumeRunId = null;
    if (staleRun) {
      logger.info(
        { runId: staleRun.runId },
        'Resuming interrupted reconciliation run from checkpoint',
      );
      resumeRunId = staleRun.runId;
    }

    const result = await reconciliationService.runReconciliation({ resumeRunId });
    if (process.env.NODE_ENV === 'test' && typeof testHoldHook === 'function') {
      await testHoldHook();
    }
    logger.info(
      {
        runId: result.runId,
        status: result.status,
        walletsChecked: result.totalWalletsChecked,
        globalSum: result.globalLedgerSumPaise,
        mismatchesCount: result.mismatchesCount,
      },
      'Ledger reconciliation run finished',
    );
    return result;
  } catch (error) {
    // If duplicate key error on status index, another worker just started a run
    if (error?.code === 11000 && error?.message?.includes('status')) {
      logger.warn('Reconciliation run duplicate status key conflict in database, skipping');
      return { skipped: true, reason: 'CONCURRENT_DB_RUN_BLOCKED' };
    }
    logger.error({ err: error }, 'Ledger reconciliation job failed');
    throw error;
  } finally {
    inProcessExecuting = false;
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
    }
    if (redis && lockAcquired) {
      try {
        await redis.eval(RELEASE_LOCK_LUA, 1, lockKey, lockToken);
      } catch (err) {
        logger.warn({ err: err.message }, 'Failed to release reconciliation distributed lock');
      }
    }
  }
}

/**
 * Registers the BullMQ repeatable reconciliation job.
 *
 * @param {any} connection - Redis connection
 */
export async function registerReconciliationJob(connection, options = {}) {
  activeRedisConnection = connection;
  const cron =
    process.env.NODE_ENV !== 'production' && options.cron
      ? options.cron
      : BUSINESS_CONFIG.BACKGROUND_JOBS.LEDGER_RECONCILIATION_CRON;

  if (!reconciliationQueue && connection) {
    const queueConn = connection?.duplicate ? connection.duplicate() : connection;
    if (queueConn?.on) {
      queueConn.on('error', () => {});
    }
    reconciliationQueue = new Queue(RECONCILIATION_QUEUE_NAME, {
      connection: queueConn,
      defaultJobOptions: {
        attempts: 1,
        removeOnComplete: true,
      },
    });

    const repeatOpts = /^\d+$/.test(String(cron).trim())
      ? { every: parseInt(cron, 10) }
      : { pattern: cron };

    await reconciliationQueue.add(
      'run_reconciliation',
      {},
      {
        jobId: RECONCILIATION_JOB_ID,
        repeat: repeatOpts,
      },
    );
  }

  if (!reconciliationWorker && connection) {
    const workerConn = connection?.duplicate ? connection.duplicate() : connection;
    if (workerConn?.on) {
      workerConn.on('error', () => {});
    }
    reconciliationWorker = new Worker(
      RECONCILIATION_QUEUE_NAME,
      async () => {
        return executeReconciliationJob();
      },
      {
        connection: workerConn,
        concurrency: 1,
      },
    );
  }

  return {
    queue: reconciliationQueue,
    worker: reconciliationWorker,
    jobId: RECONCILIATION_JOB_ID,
    cron,
  };
}

export function getReconciliationQueue() {
  return reconciliationQueue;
}

export async function closeReconciliationScheduler() {
  if (reconciliationWorker) {
    await reconciliationWorker.close();
    reconciliationWorker = null;
  }
  if (reconciliationQueue) {
    await reconciliationQueue.close();
    reconciliationQueue = null;
  }
}

export default {
  executeReconciliationJob,
  registerReconciliationJob,
  getReconciliationQueue,
  closeReconciliationScheduler,
  RECONCILIATION_QUEUE_NAME,
  RECONCILIATION_JOB_ID,
};
