/**
 * @file apps/worker/src/jobs/bookingExpiryJob.js
 * BullMQ repeatable job and Worker for automatically expiring:
 * 1. Unanswered booking requests older than 24 hours (REQUEST_EXPIRY_HOURS)
 * 2. Unpicked accepted bookings past the start-date pickup deadline (end of start date in IST)
 * 3. Unanswered extensions older than 24 hours (EXTENSION_EXPIRY_HOURS)
 *
 * Employs a 3-tier safety guard:
 * 1. In-process execution mutex
 * 2. Distributed Redis lock with heartbeat renewal and Lua script release
 * 3. Conditional database updates and settle-once LedgerOperation guards
 */

import crypto from 'node:crypto';
import { Queue, Worker } from 'bullmq';
import { BUSINESS_CONFIG } from '@borrowloop/shared';
import {
  Booking,
  ItemDayLock,
  getTodayIST,
  runInTransactionWithRetry,
  refundCancelledBooking,
  emitDomainEvent,
  transitionBookingStatus,
} from '@borrowloop/server-core';
import logger from '../logger.js';

export const BOOKING_EXPIRY_QUEUE_NAME = 'booking_lifecycle_queue';
export const BOOKING_EXPIRY_JOB_ID = 'booking_lifecycle_expiry_scanner';
export const BOOKING_EXPIRY_LOCK_KEY = 'lock:job:booking_lifecycle_expiry';
const DEFAULT_LOCK_TTL_MS = 30000;

let inProcessExecuting = false;
let testHoldHook = null;
let bookingExpiryQueue = null;
let bookingExpiryWorker = null;

/**
 * Injects a test hold hook for testing concurrency/locks.
 * Strictly wired only when NODE_ENV === 'test'.
 */
export function __setTestHoldHook(fn) {
  if (process.env.NODE_ENV === 'test') {
    testHoldHook = fn;
  }
}

export function __resetJobState() {
  inProcessExecuting = false;
  testHoldHook = null;
}

const EXTEND_LOCK_LUA = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("pexpire", KEYS[1], ARGV[2])
else
  return 0
end
`;

const RELEASE_LOCK_LUA = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
`;

/**
 * Registers the repeatable booking expiry job with BullMQ and starts the worker.
 *
 * @param {import('ioredis').Redis} redisClient
 * @returns {Promise<{ queue: Queue, worker: Worker, jobId: string, cron: string }>}
 */
export async function registerBookingExpiryJob(redisClient, options = {}) {
  const queueConn = redisClient?.duplicate ? redisClient.duplicate() : redisClient;
  if (queueConn?.on) {
    queueConn.on('error', () => {});
  }
  bookingExpiryQueue = new Queue(BOOKING_EXPIRY_QUEUE_NAME, {
    connection: queueConn,
  });
  const queue = bookingExpiryQueue;

  const defaultCron = `*/${BUSINESS_CONFIG.BACKGROUND_JOBS.EXPIRE_REQUESTS_MINUTES || 5} * * * *`;
  const cronPattern =
    options.cron ||
    (process.env.NODE_ENV !== 'production' && process.env.TEST_EXPIRY_CRON
      ? process.env.TEST_EXPIRY_CRON
      : defaultCron);

  const repeatOpts = /^\d+$/.test(String(cronPattern).trim())
    ? { every: parseInt(cronPattern, 10) }
    : { pattern: cronPattern };

  await queue.add(
    'expire_bookings',
    { scheduledAt: new Date().toISOString() },
    {
      jobId: BOOKING_EXPIRY_JOB_ID,
      repeat: repeatOpts,
      removeOnComplete: true,
      removeOnFail: 10,
    },
  );

  // Start the BullMQ Worker to consume jobs from the booking lifecycle queue unless skipped
  if (!options.skipWorker) {
    startBookingExpiryWorker(redisClient);
  }

  logger.info(
    { queue: BOOKING_EXPIRY_QUEUE_NAME, jobId: BOOKING_EXPIRY_JOB_ID, cronPattern },
    'Booking expiry repeatable job registered with BullMQ and worker active',
  );

  return {
    queue,
    worker: bookingExpiryWorker,
    jobId: BOOKING_EXPIRY_JOB_ID,
    cron: cronPattern,
  };
}

/**
 * Starts the BullMQ worker for the booking lifecycle queue.
 *
 * @param {import('ioredis').Redis} redisClient
 * @returns {Worker}
 */
export function startBookingExpiryWorker(redisClient) {
  if (bookingExpiryWorker) {
    return bookingExpiryWorker;
  }
  const workerConn = redisClient?.duplicate ? redisClient.duplicate() : redisClient;
  if (workerConn?.on) {
    workerConn.on('error', () => {});
  }
  bookingExpiryWorker = new Worker(
    BOOKING_EXPIRY_QUEUE_NAME,
    async (job) => {
      logger.info({ jobId: job.id, name: job.name }, 'Processing booking expiry job from queue');
      return await executeBookingExpiryJob({ redisClient });
    },
    { connection: workerConn },
  );

  bookingExpiryWorker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err: err.message }, 'Booking expiry worker job failed');
  });

  return bookingExpiryWorker;
}

/**
 * Executes the booking expiry job with distributed lock protection.
 * Batches scans and loops until empty.
 *
 * @param {object} [options]
 * @param {import('ioredis').Redis} [options.redisClient]
 * @param {number} [options.ttlMs]
 * @returns {Promise<object>}
 */
export async function executeBookingExpiryJob({
  redisClient = null,
  ttlMs = DEFAULT_LOCK_TTL_MS,
} = {}) {
  if (inProcessExecuting) {
    logger.warn('Booking expiry job already executing in this process, skipping');
    return { skipped: true, reason: 'CONCURRENT_EXECUTION_BLOCKED' };
  }
  inProcessExecuting = true;

  const redis = redisClient;
  const lockToken = crypto.randomUUID();
  let lockAcquired = false;
  let heartbeatTimer = null;

  if (redis && typeof redis.set === 'function') {
    const acquireResult = await redis.set(BOOKING_EXPIRY_LOCK_KEY, lockToken, 'PX', ttlMs, 'NX');
    if (!acquireResult) {
      inProcessExecuting = false;
      logger.warn('Distributed booking expiry lock currently held by another worker, skipping');
      return { skipped: true, reason: 'DISTRIBUTED_LOCK_ACQUIRED_BY_OTHER_WORKER' };
    }
    lockAcquired = true;

    const heartbeatInterval = Math.max(1000, Math.floor(ttlMs / 3));
    heartbeatTimer = setInterval(async () => {
      try {
        await redis.eval(EXTEND_LOCK_LUA, 1, BOOKING_EXPIRY_LOCK_KEY, lockToken, String(ttlMs));
      } catch (err) {
        logger.warn({ err: err.message }, 'Failed to extend booking expiry lock');
      }
    }, heartbeatInterval);
  }

  logger.info('Starting booking lifecycle expiry job');
  let expiredRequestsCount = 0;
  let expiredPickupsCount = 0;
  let expiredExtensionsCount = 0;

  const BATCH_SIZE = BUSINESS_CONFIG.BACKGROUND_JOBS.EXPIRY_BATCH_SIZE || 100;

  try {
    const now = new Date();

    // 1. Expire pending requests older than expiresAt (in batches until empty)
    // Runs each expiry in a transaction with the event in the same transaction
    const MAX_CONSECUTIVE_FAILURES = 5;
    let consecutiveFailures = 0;
    let hasMoreRequests = true;

    while (hasMoreRequests) {
      const pendingRequests = await Booking.find({
        status: 'requested',
        expiresAt: { $lte: now },
      }).limit(BATCH_SIZE);

      if (pendingRequests.length === 0) {
        hasMoreRequests = false;
        break;
      }

      for (const req of pendingRequests) {
        try {
          await runInTransactionWithRetry(async (session) => {
            const freshReq = await Booking.findById(req._id).session(session);
            if (!freshReq || freshReq.status !== 'requested') {
              return;
            }

            const updated = await transitionBookingStatus({
              bookingId: freshReq._id,
              fromStatus: 'requested',
              toStatus: 'expired',
              event: 'EXPIRE_REQUEST',
              actorRole: 'system',
              actorId: null,
              reason: 'Request expired without lender response (24h limit)',
              session,
            });

            if (updated) {
              expiredRequestsCount += 1;
              await emitDomainEvent(
                'booking.expired',
                {
                  bookingId: updated._id,
                  reason: 'request_timeout_24h',
                  borrowerId: updated.borrowerId,
                  lenderId: updated.lenderId,
                },
                { session, bookingId: updated._id, eventKey: `booking_req_expired_${updated._id}` },
              );
            }
          });
          consecutiveFailures = 0;
        } catch (err) {
          consecutiveFailures += 1;
          logger.error(
            { err: err.message, bookingId: req._id, consecutiveFailures },
            'Failed to expire booking request inside transaction',
          );
          if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
            logger.error(
              { consecutiveFailures },
              'Request expiry batch loop terminating early due to consecutive failures',
            );
            hasMoreRequests = false;
            break;
          }
        }
      }

      if (pendingRequests.length < BATCH_SIZE) {
        hasMoreRequests = false;
      }
    }

    // 2. Expire accepted bookings past pickup deadline (end of start date in IST)
    // Runs in batches until empty.
    const todayIST = getTodayIST();
    let hasMorePickups = true;
    while (hasMorePickups) {
      const overdueAccepted = await Booking.find({
        status: 'accepted',
        startDate: { $lt: todayIST },
      }).limit(BATCH_SIZE);

      if (overdueAccepted.length === 0) {
        hasMorePickups = false;
        break;
      }

      for (const booking of overdueAccepted) {
        await runInTransactionWithRetry(async (session) => {
          // Item 1: Re-read the booking INSIDE the transaction BEFORE the transition
          const freshBooking = await Booking.findById(booking._id).session(session);
          if (!freshBooking || freshBooking.status !== 'accepted') {
            return;
          }

          // Take the pending extension list from that fresh read BEFORE the transition
          const pendingExtensions = (freshBooking.extensions || []).filter(
            (ext) => ext.status === 'requested',
          );

          const updated = await transitionBookingStatus({
            bookingId: freshBooking._id,
            fromStatus: 'accepted',
            toStatus: 'expired',
            event: 'EXPIRE_PICKUP',
            actorRole: 'system',
            actorId: null,
            reason: 'Pickup deadline passed (end of start date)',
            session,
          }).catch(() => null);

          if (!updated) {
            // Already updated/cancelled/picked up concurrently; abort cleanly
            return;
          }

          // Refund held funds for any pending extensions on this expired booking using canonical opRef
          for (const ext of pendingExtensions) {
            if (ext.extraRentPaise > 0) {
              await refundCancelledBooking({
                borrowerId: updated.borrowerId,
                bookingId: updated._id,
                totalFrozenPaise: ext.extraRentPaise,
                opRef: `ext_release_${ext.id}`,
                throwOnAlreadyApplied: false,
                session,
              });
            }
          }

          // Release day locks
          await ItemDayLock.deleteMany({ bookingId: updated._id }).session(session);

          // Bug A3 Fix: Refund using amounts re-read inside the transaction!
          const totalFrozenPaise = updated.rentPaise + updated.depositPaise;
          await refundCancelledBooking({
            borrowerId: updated.borrowerId,
            bookingId: updated._id,
            totalFrozenPaise,
            opRef: 'default',
            throwOnAlreadyApplied: false,
            session,
          });

          expiredPickupsCount += 1;
          await emitDomainEvent(
            'booking.expired',
            {
              bookingId: updated._id,
              reason: 'pickup_deadline_passed',
              borrowerId: updated.borrowerId,
              lenderId: updated.lenderId,
            },
            { session, bookingId: updated._id, eventKey: `booking_pickup_expired_${updated._id}` },
          );
          await emitDomainEvent(
            'trust_score.penalty',
            {
              userId: updated.borrowerId,
              delta: BUSINESS_CONFIG.TRUST_SCORE_NO_SHOW_DELTA || -5,
              reason: 'no_show',
              bookingId: updated._id,
            },
            {
              session,
              bookingId: updated._id,
              actorId: updated.borrowerId,
              eventKey: `penalty_noshow_${updated._id}`,
            },
          );
        });
      }

      if (overdueAccepted.length < BATCH_SIZE) {
        hasMorePickups = false;
      }
    }

    // 3. Expire unanswered extensions older than expiresAt (in batches until empty)
    let hasMoreExtensions = true;
    while (hasMoreExtensions) {
      const overdueExtensions = await Booking.find({
        status: { $in: ['accepted', 'picked_up'] },
        'extensions.status': 'requested',
        'extensions.expiresAt': { $lte: now },
      }).limit(BATCH_SIZE);

      if (overdueExtensions.length === 0) {
        hasMoreExtensions = false;
        break;
      }

      for (const booking of overdueExtensions) {
        await runInTransactionWithRetry(async (session) => {
          const fresh = await Booking.findById(booking._id).session(session);
          if (!fresh || !['accepted', 'picked_up'].includes(fresh.status)) {
            return;
          }

          const pendingExt = fresh.extensions?.find(
            (ext) => ext.status === 'requested' && ext.expiresAt && ext.expiresAt <= now,
          );
          if (!pendingExt) {
            return;
          }

          pendingExt.status = 'expired';
          pendingExt.respondedAt = now;
          await fresh.save({ session });

          // Unfreeze the extension hold for the borrower using canonical opRef
          if (pendingExt.extraRentPaise > 0) {
            await refundCancelledBooking({
              borrowerId: fresh.borrowerId,
              bookingId: fresh._id,
              totalFrozenPaise: pendingExt.extraRentPaise,
              opRef: `ext_release_${pendingExt.id}`,
              throwOnAlreadyApplied: false,
              session,
            });
          }

          expiredExtensionsCount += 1;
          await emitDomainEvent(
            'booking.extension_expired',
            {
              bookingId: fresh._id,
              extensionId: pendingExt.id,
              extraRentPaise: pendingExt.extraRentPaise,
            },
            { session, bookingId: fresh._id },
          );
        });
      }

      if (overdueExtensions.length < BATCH_SIZE) {
        hasMoreExtensions = false;
      }
    }

    if (process.env.NODE_ENV === 'test' && typeof testHoldHook === 'function') {
      await testHoldHook();
    }

    logger.info(
      { expiredRequestsCount, expiredPickupsCount, expiredExtensionsCount },
      'Booking expiry job finished successfully',
    );

    return {
      success: true,
      expiredRequestsCount,
      expiredPickupsCount,
      expiredExtensionsCount,
    };
  } finally {
    inProcessExecuting = false;
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
    }
    if (lockAcquired && redis && typeof redis.eval === 'function') {
      try {
        await redis.eval(RELEASE_LOCK_LUA, 1, BOOKING_EXPIRY_LOCK_KEY, lockToken);
      } catch (err) {
        logger.warn({ err: err.message }, 'Failed to release booking expiry lock in Redis');
      }
    }
  }
}

/**
 * Closes the BullMQ queue and worker on shutdown.
 */
export async function closeBookingExpiryScheduler() {
  if (bookingExpiryWorker) {
    await bookingExpiryWorker.close().catch(() => {});
    bookingExpiryWorker = null;
  }
  if (bookingExpiryQueue) {
    await bookingExpiryQueue.close().catch(() => {});
    bookingExpiryQueue = null;
  }
}

export default {
  registerBookingExpiryJob,
  startBookingExpiryWorker,
  executeBookingExpiryJob,
  closeBookingExpiryScheduler,
  __setTestHoldHook,
};
