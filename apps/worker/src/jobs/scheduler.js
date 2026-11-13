/**
 * @file apps/worker/src/jobs/scheduler.js
 * Central scheduler managing BullMQ repeatable background jobs from docs/ARCHITECTURE.md Section 8.
 * Replaces in-process setIntervals with BullMQ repeatable jobs with fixed jobIds and stale removal.
 */

import { Queue, Worker } from 'bullmq';
import { startOutboxDispatcher } from './outboxDispatcher.js';
import { sendPickupReminders, sendDueReminders } from './reminderJobs.js';
import { accrueLateChargesJob, autoCompleteReturnsJob, revealRatingsJob } from './deferredJobs.js';
import { runWithRedisLock } from '@borrowloop/server-core';
import { BUSINESS_CONFIG } from '@borrowloop/shared';
import logger from '../logger.js';

export const SCHEDULER_QUEUE_NAME = 'scheduler_lifecycle_queue';

let schedulerQueue = null;
let schedulerWorker = null;
let outboxTimer = null;

const ACTIVE_JOB_IDS = new Set([
  'job:pickup_reminders',
  'job:due_reminders',
  'job:accrue_late_charges',
  'job:auto_complete_returns',
  'job:reveal_ratings',
]);

/**
 * Removes any stale or obsolete BullMQ repeatable jobs from previous deploys.
 *
 * @param {Queue} queue
 */
export async function removeStaleRepeatableJobs(queue) {
  try {
    const repeatableJobs = await queue.getRepeatableJobs();
    for (const job of repeatableJobs) {
      if (!ACTIVE_JOB_IDS.has(job.id)) {
        logger.info({ id: job.id, key: job.key }, 'Removing stale BullMQ repeatable job');
        await queue.removeRepeatableByKey(job.key);
      }
    }
  } catch (err) {
    logger.warn({ err: err.message }, 'Failed to clean stale repeatable jobs');
  }
}

/**
 * Starts all repeatable background jobs via BullMQ and starts the outbox dispatcher.
 * Every interval is derived directly from BUSINESS_CONFIG.BACKGROUND_JOBS.
 *
 * @param {import('ioredis').Redis} redisClient
 */
export async function startScheduler(redisClient) {
  const bgJobs = BUSINESS_CONFIG.BACKGROUND_JOBS;

  // 1. Outbox Dispatcher (Job 8)
  outboxTimer = startOutboxDispatcher(redisClient);

  if (!redisClient) {
    logger.warn('No Redis client available for BullMQ scheduler');
    return;
  }

  const queueConn = redisClient.duplicate
    ? redisClient.duplicate({ maxRetriesPerRequest: null })
    : redisClient;
  const workerConn = redisClient.duplicate
    ? redisClient.duplicate({ maxRetriesPerRequest: null })
    : redisClient;

  schedulerQueue = new Queue(SCHEDULER_QUEUE_NAME, { connection: queueConn });

  // Remove stale repeatables on startup
  await removeStaleRepeatableJobs(schedulerQueue);

  // Register BullMQ repeatable jobs with fixed jobIds
  await schedulerQueue.add(
    'pickup_reminders',
    { scheduledAt: new Date().toISOString() },
    {
      jobId: 'job:pickup_reminders',
      repeat: { every: bgJobs.PICKUP_REMINDERS_MINUTES * 60 * 1000 },
      removeOnComplete: true,
      removeOnFail: 10,
    },
  );

  await schedulerQueue.add(
    'due_reminders',
    { scheduledAt: new Date().toISOString() },
    {
      jobId: 'job:due_reminders',
      repeat: { every: bgJobs.DUE_REMINDERS_MINUTES * 60 * 1000 },
      removeOnComplete: true,
      removeOnFail: 10,
    },
  );

  await schedulerQueue.add(
    'accrue_late_charges',
    { scheduledAt: new Date().toISOString() },
    {
      jobId: 'job:accrue_late_charges',
      repeat: { every: bgJobs.ACCRUE_LATE_CHARGES_MINUTES * 60 * 1000 },
      removeOnComplete: true,
      removeOnFail: 10,
    },
  );

  await schedulerQueue.add(
    'auto_complete_returns',
    { scheduledAt: new Date().toISOString() },
    {
      jobId: 'job:auto_complete_returns',
      repeat: { every: bgJobs.AUTO_COMPLETE_RETURNS_MINUTES * 60 * 1000 },
      removeOnComplete: true,
      removeOnFail: 10,
    },
  );

  await schedulerQueue.add(
    'reveal_ratings',
    { scheduledAt: new Date().toISOString() },
    {
      jobId: 'job:reveal_ratings',
      repeat: { every: bgJobs.REVEAL_RATINGS_HOURS * 60 * 60 * 1000 },
      removeOnComplete: true,
      removeOnFail: 10,
    },
  );

  // Start BullMQ Worker processing repeatable scheduler jobs
  schedulerWorker = new Worker(
    SCHEDULER_QUEUE_NAME,
    async (job) => {
      logger.info({ name: job.name, id: job.id }, 'Executing BullMQ repeatable scheduler job');
      switch (job.name) {
        case 'pickup_reminders':
          return runWithRedisLock({
            name: 'pickup_reminders',
            redisClient,
            handler: () => sendPickupReminders({ redisClient }),
            logger,
          });
        case 'due_reminders':
          return runWithRedisLock({
            name: 'due_reminders',
            redisClient,
            handler: () => sendDueReminders({ redisClient }),
            logger,
          });
        case 'accrue_late_charges':
          return runWithRedisLock({
            name: 'accrue_late_charges',
            redisClient,
            handler: () => accrueLateChargesJob({ redisClient }),
            logger,
          });
        case 'auto_complete_returns':
          return runWithRedisLock({
            name: 'auto_complete_returns',
            redisClient,
            handler: () => autoCompleteReturnsJob({ redisClient }),
            logger,
          });
        case 'reveal_ratings':
          return runWithRedisLock({
            name: 'reveal_ratings',
            redisClient,
            handler: () => revealRatingsJob({ redisClient }),
            logger,
          });
        default:
          logger.warn({ name: job.name }, 'Unknown scheduler job name');
      }
    },
    { connection: workerConn, concurrency: 1 },
  );

  logger.info('Unified BullMQ background scheduler initialized with fixed jobIds');
}

/**
 * Closes all BullMQ queues and workers cleanly.
 */
export async function closeScheduler() {
  if (outboxTimer) {
    clearInterval(outboxTimer);
    outboxTimer = null;
  }
  if (schedulerWorker) {
    await schedulerWorker.close();
    schedulerWorker = null;
  }
  if (schedulerQueue) {
    await schedulerQueue.close();
    schedulerQueue = null;
  }
}
