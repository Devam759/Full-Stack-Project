import { describe, it, expect } from 'vitest';
import { getWorkerStatus } from '../src/index.js';
import { BUSINESS_CONFIG } from '@borrowloop/shared';

describe('apps/worker', () => {
  it('initializes worker and returns status', () => {
    const status = getWorkerStatus();
    expect(status.status).toBe('running');
    expect(status).toHaveProperty('timestamp');
  });

  it('accesses shared business configuration schedules', () => {
    expect(BUSINESS_CONFIG.BACKGROUND_JOBS.EXPIRE_REQUESTS_MINUTES).toBe(5);
    expect(BUSINESS_CONFIG.BACKGROUND_JOBS.ACCRUE_LATE_CHARGES_MINUTES).toBe(60);
    expect(BUSINESS_CONFIG.BACKGROUND_JOBS.LEDGER_RECONCILIATION_CRON).toBe('0 2 * * *');
  });
});
