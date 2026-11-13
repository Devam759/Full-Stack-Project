/**
 * @file apps/worker/src/reconciliationCli.js
 * CLI entrypoint for child worker processes running the reconciliation job.
 */

import Redis from 'ioredis';
import { connectDB, disconnectDB } from '@borrowloop/server-core';
import { executeReconciliationJob, __setTestHoldHook } from './jobs/reconciliationJob.js';

async function main() {
  if (process.env.NODE_ENV === 'test' && process.env.TEST_HOLD_MS) {
    const ms = parseInt(process.env.TEST_HOLD_MS, 10);
    __setTestHoldHook(async () => {
      await new Promise((r) => setTimeout(r, ms));
    });
  }
  const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
  const mongoUri =
    process.env.MONGODB_URI ||
    'mongodb://127.0.0.1:27018/borrowloop_test?replicaSet=rs0&directConnection=true';

  const redis = new Redis(redisUrl, {
    maxRetriesPerRequest: null,
  });

  await connectDB(mongoUri);
  try {
    const res = await executeReconciliationJob({ redisClient: redis });
    console.info('WORKER_RESULT:' + JSON.stringify(res));
  } finally {
    try {
      redis.disconnect();
    } catch {
      /* ignore */
    }
    await disconnectDB().catch(() => {});
  }
}

main().catch((err) => {
  console.error('WORKER_ERROR:', err);
  process.exit(1);
});
