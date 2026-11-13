import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import Redis from 'ioredis';
import ReconciliationRun from '../../api/src/models/ReconciliationRun.js';
import User from '../../api/src/models/User.js';
import Wallet from '../../api/src/models/Wallet.js';
import LedgerEntry from '../../api/src/models/LedgerEntry.js';
import { setupTestDB, teardownTestDB } from '../../api/tests/setup/dbTestHelper.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

describe('Stage 1.1: Worker MongoDB Connection & Scheduled Reconciliation Execution', () => {
  let redis;
  let mongoUri;

  beforeAll(async () => {
    const dbInfo = await setupTestDB();
    mongoUri = dbInfo.uri;
    await ReconciliationRun.init();
    await Wallet.init();
    await LedgerEntry.init();

    redis = new Redis(REDIS_URL, {
      maxRetriesPerRequest: null,
      lazyConnect: true,
    });
    await redis.connect().catch(() => {});
    const keys = await redis.keys('bull:ledger_reconciliation_queue:*').catch(() => []);
    if (keys.length > 0) {
      await redis.del(...keys).catch(() => {});
    }
    await redis.del('lock:reconciliation').catch(() => {});
  }, 30000);

  afterAll(async () => {
    if (redis) {
      try {
        redis.disconnect();
      } catch {
        /* ignore */
      }
    }
    await teardownTestDB();
  });

  it('starts the real worker process against Docker Mongo & Redis, executes scheduled job, and writes ReconciliationRun', async () => {
    // 1. Seed data that needs reconciliation
    const user = await User.create({
      name: 'Recon Test User',
      email: `recon_${Date.now()}@test.com`,
      emailVerified: true,
      status: 'active',
      passwordHash: 'dummyhash',
    });

    await Wallet.create({
      userId: user._id,
      availablePaise: 10000,
      frozenPaise: 0,
    });

    await LedgerEntry.create([
      {
        txnId: new mongoose.Types.ObjectId(),
        type: 'deposit_funds',
        account: 'demo_funding',
        amountPaise: -10000,
        userId: null,
      },
      {
        txnId: new mongoose.Types.ObjectId(),
        type: 'deposit_funds',
        account: 'available',
        amountPaise: 10000,
        userId: user._id,
        balanceAfterPaise: 10000,
      },
    ]);

    // 2. Clear any lingering Redis locks and spawn real worker process with test cron override every second
    await redis.del('lock:reconciliation', 'lock:job:booking_lifecycle_expiry').catch(() => {});
    const workerPath = path.resolve(__dirname, '../src/index.js');
    const child = spawn(process.execPath, [workerPath], {
      env: {
        ...process.env,
        NODE_ENV: 'development',
        FORCE_START_WORKER: 'true',
        MONGODB_URI: mongoUri,
        REDIS_URL: REDIS_URL,
        TEST_RECONCILIATION_CRON: '1000', // every 1000ms
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let childLogs = '';
    child.stdout.on('data', (d) => {
      childLogs += d.toString();
    });
    child.stderr.on('data', (d) => {
      childLogs += d.toString();
    });

    // 3. Poll for the worker process to create a ReconciliationRun document in MongoDB
    const startTime = Date.now();
    let completedRun = null;

    while (Date.now() - startTime < 25000) {
      const run = await ReconciliationRun.findOne({ status: 'completed' });
      if (run) {
        completedRun = run;
        break;
      }
      await new Promise((r) => setTimeout(r, 500));
    }

    // 4. Terminate the worker child process gracefully
    if (process.platform === 'win32') {
      try {
        spawnSync('taskkill', ['/F', '/T', '/PID', child.pid.toString()]);
      } catch {
        /* ignore error if already killed */
      }
    } else {
      child.kill('SIGKILL');
    }
    await new Promise((r) => setTimeout(r, 1000));
    await redis.del('lock:reconciliation', 'lock:job:booking_lifecycle_expiry').catch(() => {});

    if (!completedRun) {
      console.info('WORKER LOGS:', childLogs);
    }

    expect(completedRun).toBeTruthy();
    expect(completedRun.status).toBe('completed');
    expect(completedRun.totalWalletsChecked).toBeGreaterThanOrEqual(1);
    expect(completedRun.globalLedgerSumPaise).toBe(0);
  }, 35000);
});
