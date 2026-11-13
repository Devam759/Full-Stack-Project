import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { Queue } from 'bullmq';
import { getWorkerStatus } from '../src/index.js';
import { BUSINESS_CONFIG } from '@borrowloop/shared';
import {
  registerReconciliationJob,
  executeReconciliationJob,
  closeReconciliationScheduler,
  RECONCILIATION_JOB_ID,
} from '../src/jobs/reconciliationJob.js';
import { setupTestDB, teardownTestDB, clearTestDB } from '../../api/tests/setup/dbTestHelper.js';

describe('apps/worker', () => {
  beforeAll(async () => {
    await setupTestDB();
  });

  afterAll(async () => {
    await closeReconciliationScheduler();
    await teardownTestDB();
  });

  it('initializes worker and returns status', () => {
    const status = getWorkerStatus();
    expect(['healthy', 'running']).toContain(status.status);
    expect(status).toHaveProperty('timestamp');
  });

  it('accesses shared business configuration schedules', () => {
    expect(BUSINESS_CONFIG.BACKGROUND_JOBS.EXPIRE_REQUESTS_MINUTES).toBe(5);
    expect(BUSINESS_CONFIG.BACKGROUND_JOBS.ACCRUE_LATE_CHARGES_MINUTES).toBe(60);
    expect(BUSINESS_CONFIG.BACKGROUND_JOBS.LEDGER_RECONCILIATION_CRON).toBe('0 2 * * *');
  });

  it('registers reconciliation job with BullMQ repeatable schedule and fixed jobId', async () => {
    const queueAddSpy = vi
      .spyOn(Queue.prototype, 'add')
      .mockResolvedValue({ id: RECONCILIATION_JOB_ID });

    // Dummy connection for BullMQ initialization
    const mockRedis = {
      status: 'ready',
      options: {},
      on: () => {},
      quit: async () => {},
      duplicate: () => mockRedis,
    };

    const registration = await registerReconciliationJob(mockRedis);
    expect(registration.jobId).toBe(RECONCILIATION_JOB_ID);
    expect(registration.cron).toBe(BUSINESS_CONFIG.BACKGROUND_JOBS.LEDGER_RECONCILIATION_CRON);
    expect(registration.queue).toBeDefined();

    queueAddSpy.mockRestore();
  });

  it('handles running reconciliation job twice at once safely via execution lock', async () => {
    await clearTestDB();

    // Calling executeReconciliationJob concurrently
    const [res1, res2] = await Promise.all([
      executeReconciliationJob(),
      executeReconciliationJob(),
    ]);

    // One of them must be blocked or skipped by the concurrency lock
    const results = [res1, res2];
    const skipped = results.find((r) => r?.skipped === true);
    expect(skipped).toBeDefined();
    expect(
      skipped.reason === 'CONCURRENT_EXECUTION_BLOCKED' ||
        skipped.reason === 'ACTIVE_RUN_IN_PROGRESS',
    ).toBe(true);
  });
});
