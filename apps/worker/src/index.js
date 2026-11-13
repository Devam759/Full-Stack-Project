import Redis from 'ioredis';
import config from './config/index.js';
import logger from './logger.js';
import { BUSINESS_CONFIG } from '@borrowloop/shared';
import { connectDB, disconnectDB, isDBHealthy } from '@borrowloop/server-core';
import {
  registerReconciliationJob,
  closeReconciliationScheduler,
} from './jobs/reconciliationJob.js';
import { registerBookingExpiryJob, closeBookingExpiryScheduler } from './jobs/bookingExpiryJob.js';
import { startEmailWorker, closeEmailWorker } from './jobs/emailWorker.js';
import { startScheduler, closeScheduler } from './jobs/scheduler.js';

// Production Demo Money Guard (Requirement 10)
if (
  (process.env.NODE_ENV === 'production' || config.NODE_ENV === 'production') &&
  process.env.ALLOW_DEMO_MONEY !== 'true'
) {
  logger.fatal('Refusing to start in production without ALLOW_DEMO_MONEY=true');
  process.exit(1);
}

let redisConnection = null;

export async function startWorker() {
  // Connect to MongoDB on startup; fail fast if connection fails
  try {
    await connectDB(config.MONGODB_URI);
    logger.info(
      { uri: config.MONGODB_URI.replace(/\/\/.*@/, '//<redacted>@') },
      'Worker connected to MongoDB',
    );
  } catch (err) {
    logger.fatal({ err: err.message }, 'Worker failed to connect to MongoDB on startup');
    console.error('Worker failed to connect to MongoDB on startup:', err.message);
    process.exit(1);
  }

  if (
    config.REDIS_URL &&
    (config.NODE_ENV !== 'test' || process.env.FORCE_START_WORKER === 'true')
  ) {
    try {
      redisConnection = new Redis(config.REDIS_URL, {
        maxRetriesPerRequest: null,
        enableOfflineQueue: false,
      });

      const reconCron =
        config.NODE_ENV !== 'production' && process.env.TEST_RECONCILIATION_CRON
          ? process.env.TEST_RECONCILIATION_CRON
          : BUSINESS_CONFIG.BACKGROUND_JOBS.LEDGER_RECONCILIATION_CRON;

      await registerReconciliationJob(redisConnection, { cron: reconCron });
      await registerBookingExpiryJob(redisConnection, {
        cron:
          config.NODE_ENV !== 'production' && process.env.TEST_EXPIRY_CRON
            ? process.env.TEST_EXPIRY_CRON
            : undefined,
      });
      startEmailWorker(redisConnection);
      startScheduler(redisConnection);
    } catch (err) {
      logger.fatal({ err: err.message }, 'Failed to initialize Redis or worker jobs on startup');
      process.exit(1);
    }
  }

  logger.info(
    {
      env: config.NODE_ENV,
      mongoConnected: isDBHealthy(),
      reconciliationCron: BUSINESS_CONFIG.BACKGROUND_JOBS.LEDGER_RECONCILIATION_CRON,
    },
    'BorrowLoop background worker initialized',
  );
}

export function getWorkerStatus() {
  return {
    status: isDBHealthy() ? 'healthy' : 'degraded',
    mongo: isDBHealthy(),
    redis: redisConnection ? redisConnection.status === 'ready' : false,
    env: config.NODE_ENV,
    timestamp: new Date().toISOString(),
  };
}

export async function shutdown(signal) {
  logger.info({ signal }, 'Worker received shutdown signal');
  await closeReconciliationScheduler().catch(() => {});
  await closeBookingExpiryScheduler().catch(() => {});
  await closeEmailWorker().catch(() => {});
  closeScheduler();
  if (redisConnection) {
    await redisConnection.quit().catch(() => {});
  }
  await disconnectDB().catch(() => {});
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

if (process.env.NODE_ENV !== 'test' || process.env.FORCE_START_WORKER === 'true') {
  startWorker();
}
