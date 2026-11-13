import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { setupTestDB, teardownTestDB, clearTestDB } from './setup/dbTestHelper.js';
import User from '../src/models/User.js';
import ledgerService from '../src/modules/wallet/ledgerService.js';
import reconciliationService from '../src/services/reconciliationService.js';

describe('Regression: Reconciliation Cutoff Under Live Traffic', () => {
  beforeAll(async () => {
    await setupTestDB();
  });

  afterAll(async () => {
    await teardownTestDB();
  });

  beforeEach(async () => {
    await clearTestDB();
  });

  it('runs reconciliation while 20 withdrawals are in flight and expects zero mismatches', async () => {
    const user = await User.create({
      name: 'Live User',
      email: 'live@example.com',
      emailVerified: true,
      status: 'active',
      passwordHash: 'dummy',
    });

    await ledgerService.addDemoFunds({ userId: user._id, amountPaise: 500000 });

    // Launch reconciliation concurrently with 20 withdrawals
    const withdrawalPromises = Array.from({ length: 20 }, (_, i) =>
      ledgerService.withdrawDemoFunds({
        userId: user._id,
        amountPaise: 1000,
        meta: { i },
      }),
    );

    const [recResult] = await Promise.all([
      reconciliationService.runReconciliation({ batchSize: 1 }),
      ...withdrawalPromises,
    ]);

    expect(recResult.status).toBe('completed');
    expect(recResult.mismatchesCount).toBe(0);
  }, 30000);
});
