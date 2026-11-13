import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import { setupTestDB, teardownTestDB, clearTestDB } from './setup/dbTestHelper.js';
import User from '../src/models/User.js';
import Wallet from '../src/models/Wallet.js';
import LedgerEntry from '../src/models/LedgerEntry.js';
import ReconciliationRun from '../src/models/ReconciliationRun.js';
import reconciliationService from '../src/services/reconciliationService.js';

describe('Suite 11: Reconciliation Scale Benchmark (10,000 Seeded Users)', () => {
  beforeAll(async () => {
    await setupTestDB();
    await ReconciliationRun.init();
    await Wallet.init();
    await LedgerEntry.init();
    await User.init();
  });

  afterAll(async () => {
    await teardownTestDB();
  });

  it('reconciles a seeded dataset of 10,000 users in batched snapshot transactions and measures duration', async () => {
    await clearTestDB();

    const NUM_USERS = 10000;
    const now = new Date();
    const users = [];
    const wallets = [];
    const ledgerEntries = [];

    // System accounts funding entry
    const fundingTxnId = new mongoose.Types.ObjectId();
    const totalFundsPaise = NUM_USERS * 10000;
    ledgerEntries.push({
      txnId: fundingTxnId,
      account: 'demo_funding',
      userId: null,
      amountPaise: -totalFundsPaise,
      balanceAfterPaise: null,
      type: 'deposit_funds',
      createdAt: now,
    });

    for (let i = 0; i < NUM_USERS; i++) {
      const userId = new mongoose.Types.ObjectId();
      users.push({
        _id: userId,
        name: `Benchmark User ${i}`,
        email: `bench_${i}_${Date.now()}@example.com`,
        emailVerified: true,
        status: 'active',
        passwordHash: 'dummy',
        createdAt: now,
        updatedAt: now,
      });

      wallets.push({
        userId,
        availablePaise: 10000,
        frozenPaise: 0,
        pendingPaise: 0,
        updatedAt: now,
      });

      ledgerEntries.push({
        txnId: fundingTxnId,
        account: 'available',
        userId,
        amountPaise: 10000,
        balanceAfterPaise: 10000,
        type: 'deposit_funds',
        createdAt: now,
      });
    }

    // Fast bulk insertion
    await User.collection.insertMany(users, { ordered: false });
    await Wallet.collection.insertMany(wallets, { ordered: false });
    await LedgerEntry.collection.insertMany(ledgerEntries, { ordered: false });

    // Measure reconciliation duration
    const startTime = Date.now();
    const result = await reconciliationService.runReconciliation({ batchSize: 500 });
    const durationMs = Date.now() - startTime;

    console.info(`=== 10,000 USERS RECONCILIATION BENCHMARK RESULT ===`);
    console.info(`Total wallets audited: ${result.totalWalletsChecked}`);
    console.info(`Mismatches: ${result.mismatchesCount}`);
    console.info(`Global sum: ${result.globalLedgerSumPaise} paise`);
    console.info(`Duration: ${durationMs} ms (${(durationMs / 1000).toFixed(2)} seconds)`);

    expect(result.status).toBe('completed');
    expect(result.totalWalletsChecked).toBe(NUM_USERS);
    expect(result.mismatchesCount).toBe(0);
    expect(result.globalLedgerSumPaise).toBe(0);
  }, 90000);
});
