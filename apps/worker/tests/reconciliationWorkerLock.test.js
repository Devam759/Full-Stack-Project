import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Redis from 'ioredis';
import { Queue } from 'bullmq';
import { BUSINESS_CONFIG } from '@borrowloop/shared';
import {
  registerReconciliationJob,
  closeReconciliationScheduler,
  RECONCILIATION_JOB_ID,
  RECONCILIATION_QUEUE_NAME,
  RECONCILIATION_LOCK_KEY,
} from '../src/jobs/reconciliationJob.js';
import { setupTestDB, teardownTestDB, clearTestDB } from '../../api/tests/setup/dbTestHelper.js';
import ReconciliationRun from '../../api/src/models/ReconciliationRun.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cliScript = path.resolve(__dirname, '../src/reconciliationCli.js');

describe('Suite 8: Worker Distributed Lock & Real Redis BullMQ Registration', () => {
  let redisClient;
  let mongoUri;
  const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

  beforeAll(async () => {
    // 1. Verify Real Redis availability - fail loudly if unavailable
    redisClient = new Redis(redisUrl, {
      maxRetriesPerRequest: null,
      connectTimeout: 3000,
      lazyConnect: true,
    });

    try {
      await redisClient.connect();
      redisClient.on('error', () => {}); // swallow connection close notices during teardown
      const pong = await redisClient.ping();
      if (pong !== 'PONG') {
        throw new Error('Redis ping response was not PONG');
      }
    } catch (err) {
      throw new Error(
        `[CRITICAL: REDIS UNAVAILABLE] Real Redis is required for worker distributed lock testing but could not connect at ${redisUrl}. Error: ${err.message}. Start Redis via 'docker compose up -d redis'.`,
      );
    }

    const dbInfo = await setupTestDB();
    mongoUri = dbInfo.uri;
  });

  afterAll(async () => {
    await closeReconciliationScheduler();
    if (redisClient) {
      await redisClient.del(RECONCILIATION_LOCK_KEY).catch(() => {});
      try {
        redisClient.disconnect();
      } catch {
        /* ignore */
      }
    }
    await teardownTestDB();
  });

  beforeEach(async () => {
    await clearTestDB();
    if (redisClient) {
      await redisClient.del(RECONCILIATION_LOCK_KEY);
    }
  });

  it('registers repeatable BullMQ job with fixed jobId and cron from BUSINESS_CONFIG', async () => {
    const reg = await registerReconciliationJob(redisClient);

    expect(reg.jobId).toBe(RECONCILIATION_JOB_ID);
    expect(reg.cron).toBe(BUSINESS_CONFIG.BACKGROUND_JOBS.LEDGER_RECONCILIATION_CRON);

    const qConn = redisClient.duplicate();
    qConn.on('error', () => {});
    const queue = new Queue(RECONCILIATION_QUEUE_NAME, { connection: qConn });
    const repeatableJobs = await queue.getRepeatableJobs();
    const registered = repeatableJobs.find(
      (j) =>
        j.name === 'run_reconciliation' &&
        j.pattern === BUSINESS_CONFIG.BACKGROUND_JOBS.LEDGER_RECONCILIATION_CRON,
    );

    expect(registered).toBeDefined();
    expect(registered.pattern).toBe(BUSINESS_CONFIG.BACKGROUND_JOBS.LEDGER_RECONCILIATION_CRON);
    await queue.close();
    await closeReconciliationScheduler();
  });

  it('executes exactly one run when two worker child processes trigger at the same instant', async () => {
    function spawnWorker() {
      return new Promise((resolve, reject) => {
        const proc = spawn(process.execPath, [cliScript], {
          env: {
            ...process.env,
            NODE_ENV: 'test',
            ALLOW_DEMO_MONEY: 'true',
            MONGODB_URI: mongoUri,
            REDIS_URL: redisUrl,
            TEST_HOLD_MS: '2500',
          },
          stdio: 'pipe',
        });

        let stdout = '';
        let stderr = '';

        proc.stdout.on('data', (d) => {
          stdout += d.toString();
        });
        proc.stderr.on('data', (d) => {
          stderr += d.toString();
        });

        proc.on('close', (code) => {
          if (code !== 0) {
            return reject(new Error(`Worker exited with code ${code}: ${stderr || stdout}`));
          }
          const match = stdout.match(/WORKER_RESULT:(.+)/);
          if (!match) {
            return reject(new Error(`Worker output missing WORKER_RESULT: ${stdout}`));
          }
          try {
            resolve(JSON.parse(match[1]));
          } catch (e) {
            reject(e);
          }
        });
      });
    }

    const runsBefore = await ReconciliationRun.countDocuments({ status: 'completed' });

    // Trigger both worker processes concurrently at the same millisecond
    const [resultA, resultB] = await Promise.all([spawnWorker(), spawnWorker()]);

    const results = [resultA, resultB];
    const completed = results.filter((r) => r.status === 'completed');
    const skipped = results.filter((r) => r.skipped === true);

    expect(completed.length).toBe(1);
    expect(skipped.length).toBe(1);

    // Exactly one new ReconciliationRun record should have completed
    const runsAfter = await ReconciliationRun.countDocuments({ status: 'completed' });
    expect(runsAfter - runsBefore).toBe(1);
  }, 30000);

  it('allows new run to resume when a crashed worker lock expires in Redis', async () => {
    await clearTestDB();
    await redisClient.del(RECONCILIATION_LOCK_KEY);

    // 1. Simulate a crashed holder holding the distributed lock with short TTL of 500ms
    const crashedToken = 'crashed-worker-token';
    await redisClient.set(RECONCILIATION_LOCK_KEY, crashedToken, 'PX', 500, 'NX');

    // Lock is held
    const lockValBefore = await redisClient.get(RECONCILIATION_LOCK_KEY);
    expect(lockValBefore).toBe(crashedToken);

    // 2. Wait 600ms for TTL to expire without heartbeat (simulating process crash)
    await new Promise((r) => setTimeout(r, 600));

    const lockValAfter = await redisClient.get(RECONCILIATION_LOCK_KEY);
    expect(lockValAfter).toBeNull();

    // 3. New execution acquires the released lock smoothly
    const newWorkerScript = spawn(process.execPath, [cliScript], {
      env: {
        ...process.env,
        NODE_ENV: 'test',
        ALLOW_DEMO_MONEY: 'true',
        MONGODB_URI: mongoUri,
        REDIS_URL: redisUrl,
      },
      stdio: 'pipe',
    });

    const res = await new Promise((resolve, reject) => {
      let stdout = '';
      let stderr = '';
      newWorkerScript.stdout.on('data', (d) => {
        stdout += d.toString();
      });
      newWorkerScript.stderr.on('data', (d) => {
        stderr += d.toString();
      });
      newWorkerScript.on('close', (code) => {
        if (code !== 0) return reject(new Error(`Worker exit code ${code}: ${stderr || stdout}`));
        const match = stdout.match(/WORKER_RESULT:(.+)/);
        if (!match) return reject(new Error(`Worker output missing WORKER_RESULT: ${stdout}`));
        try {
          resolve(JSON.parse(match[1]));
        } catch (e) {
          reject(e);
        }
      });
    });

    expect(res.status, JSON.stringify(res)).toBe('completed');
  }, 20000);
});
