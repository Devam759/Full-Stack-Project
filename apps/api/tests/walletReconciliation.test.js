import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { setupTestDB, teardownTestDB, clearTestDB } from './setup/dbTestHelper.js';
import User from '../src/models/User.js';
import Wallet from '../src/models/Wallet.js';
import LedgerEntry from '../src/models/LedgerEntry.js';
import ReconciliationRun from '../src/models/ReconciliationRun.js';
import ledgerService from '../src/modules/wallet/ledgerService.js';
import { reconciliationService } from '@borrowloop/server-core';

describe('Suite 10: Batched Reconciliation Audit & Mismatch Detection', () => {
  let user1;
  let user2;
  let user3;

  beforeAll(async () => {
    await setupTestDB();
  });

  afterAll(async () => {
    await teardownTestDB();
  });

  beforeEach(async () => {
    await clearTestDB();

    user1 = await User.create({
      name: 'User One',
      email: 'u1@example.com',
      emailVerified: true,
      status: 'active',
      passwordHash: 'dummyhash',
    });

    user2 = await User.create({
      name: 'User Two',
      email: 'u2@example.com',
      emailVerified: true,
      status: 'active',
      passwordHash: 'dummyhash',
    });

    user3 = await User.create({
      name: 'User Three',
      email: 'u3@example.com',
      emailVerified: true,
      status: 'active',
      passwordHash: 'dummyhash',
    });

    // Legitimate transactions
    await ledgerService.addDemoFunds({ userId: user1._id, amountPaise: 50000 });
    await ledgerService.addDemoFunds({ userId: user2._id, amountPaise: 30000 });
    await ledgerService.addDemoFunds({ userId: user3._id, amountPaise: 20000 });
  });

  it('runs batched reconciliation successfully with zero mismatches', async () => {
    // Run with small batchSize of 2 to exercise checkpointing loop across 3 users
    const result = await reconciliationService.runReconciliation({ batchSize: 2 });

    expect(result.status).toBe('completed');
    expect(result.totalWalletsChecked).toBe(3);
    expect(result.mismatchesCount).toBe(0);
    expect(result.globalLedgerSumPaise).toBe(0);
    expect(result.lastCheckpointUserId).toBeDefined();

    // Verify record in reconciliation_runs collection
    const saved = await ReconciliationRun.findOne({ runId: result.runId });
    expect(saved).not.toBeNull();
    expect(saved.status).toBe('completed');
  });

  it('detects an artificially modified wallet balance and records mismatch in reconciliation_runs', async () => {
    // Artificially tamper with user2's wallet directly via raw MongoDB driver
    await Wallet.collection.updateOne(
      { userId: user2._id },
      { $set: { availablePaise: 999999 } }, // Corrupted balance!
    );

    const result = await reconciliationService.runReconciliation({ batchSize: 2 });

    expect(result.status).toBe('failed');
    expect(result.mismatchesCount).toBe(1);

    const mismatch = result.mismatches[0];
    expect(mismatch.userId.toString()).toBe(user2._id.toString());
    expect(mismatch.walletAvailablePaise).toBe(999999);
    expect(mismatch.ledgerAvailableSumPaise).toBe(30000);
    expect(mismatch.diffPaise).toBe(999999 - 30000);

    // Verify database record
    const savedRun = await ReconciliationRun.findOne({ runId: result.runId });
    expect(savedRun.status).toBe('failed');
    expect(savedRun.mismatchesCount).toBe(1);
  });

  it('caps stored mismatches at configured limit and preserves accurate mismatchesCount', async () => {
    // Create 15 users with corrupted balances
    const corruptUsers = [];
    for (let i = 0; i < 15; i++) {
      const u = await User.create({
        name: `Corrupt User ${i}`,
        email: `corrupt${i}@example.com`,
        emailVerified: true,
        status: 'active',
        passwordHash: 'dummyhash',
      });
      await Wallet.collection.insertOne({
        userId: u._id,
        availablePaise: 50000,
        frozenPaise: 0,
        pendingPaise: 0,
        updatedAt: new Date(),
      });
      corruptUsers.push(u);
    }

    // Run reconciliation with maxStoredMismatches capped at 5
    const result = await reconciliationService.runReconciliation({
      batchSize: 5,
      maxStoredMismatches: 5,
    });

    expect(result.status).toBe('failed');
    // Actual mismatches count is at least 15
    expect(result.mismatchesCount).toBeGreaterThanOrEqual(15);
    // But stored array must not exceed cap of 5
    expect(result.mismatches.length).toBe(5);

    const saved = await ReconciliationRun.findOne({ runId: result.runId });
    expect(saved.mismatches.length).toBe(5);
    expect(saved.mismatchesCount).toBe(result.mismatchesCount);
  });

  it('supports resuming from lastCheckpointUserId on simulated crash between batches', async () => {
    // Phase 1: create a run document that "crashed" after checking user1
    const runDoc = new ReconciliationRun({
      runId: 'rec-simulated-crash-1',
      startedAt: new Date(Date.now() - 20 * 60 * 1000), // 20 mins ago (stale)
      status: 'in_progress',
      totalWalletsChecked: 1,
      totalLedgerEntriesChecked: 3,
      globalLedgerSumPaise: 0,
      mismatchesCount: 0,
      mismatches: [],
      lastCheckpointUserId: user1._id,
    });
    await runDoc.save();

    // Phase 2: Resume reconciliation from that runId
    const resumedResult = await reconciliationService.runReconciliation({
      batchSize: 1,
      resumeRunId: runDoc.runId,
    });

    expect(resumedResult.runId).toBe(runDoc.runId);
    expect(resumedResult.status).toBe('completed');
    expect(resumedResult.totalWalletsChecked).toBe(3); // continued and checked remaining 2 users
    expect(resumedResult.mismatchesCount).toBe(0);
  });

  it('detects and flags an injected orphan ledger entry with no associated user or wallet', async () => {
    const orphanUserId = new mongoose.Types.ObjectId();

    // Inject orphan ledger entry
    await LedgerEntry.create({
      txnId: 'txn-orphan-test',
      account: 'available',
      userId: orphanUserId,
      amountPaise: 5000,
      balanceAfterPaise: 5000,
      type: 'deposit_funds',
    });

    const result = await reconciliationService.runReconciliation({ batchSize: 2 });

    expect(result.status).toBe('failed');
    expect(result.mismatchesCount).toBeGreaterThanOrEqual(1);
    const orphanMismatch = result.mismatches.find((m) => m.type === 'ORPHAN_LEDGER_USER');
    expect(orphanMismatch).toBeDefined();
    expect(orphanMismatch.userId.toString()).toBe(orphanUserId.toString());
  });

  it('detects and flags a wallet with balance but no ledger entries and confirms only it is flagged', async () => {
    const ghostUser = await User.create({
      name: 'Ghost Wallet User',
      email: 'ghost@example.com',
      emailVerified: true,
      status: 'active',
      passwordHash: 'dummy',
    });
    // Create wallet directly with 25000 paise but ZERO ledger entries
    await Wallet.collection.insertOne({
      userId: ghostUser._id,
      availablePaise: 25000,
      frozenPaise: 0,
      pendingPaise: 0,
      updatedAt: new Date(),
    });

    const result = await reconciliationService.runReconciliation({ batchSize: 2 });

    expect(result.status).toBe('failed');
    expect(result.mismatchesCount).toBe(1);
    expect(result.mismatches[0].userId.toString()).toBe(ghostUser._id.toString());
    expect(result.mismatches[0].walletAvailablePaise).toBe(25000);
    expect(result.mismatches[0].ledgerAvailableSumPaise).toBe(0);
    expect(result.mismatches[0].diffPaise).toBe(25000);
  });

  it('reconciles consistently with zero mismatches during live traffic across 20 repetitions', async () => {
    // Repeat live traffic reconciliation 20 times to prove deterministic consistency
    for (let iteration = 1; iteration <= 20; iteration++) {
      // 20 parallel withdrawals in flight
      const withdrawals = Array.from({ length: 20 }, async (_, idx) => {
        const u = idx % 2 === 0 ? user1 : user2;
        try {
          return await ledgerService.withdrawDemoFunds({
            userId: u._id,
            amountPaise: 100, // Rs 1
          });
        } catch {
          // Ignore balance errors
          return null;
        }
      });

      // Run reconciliation concurrently with the active withdrawals
      const [reconResult] = await Promise.all([
        reconciliationService.runReconciliation({ batchSize: 2 }),
        ...withdrawals,
      ]);

      expect(reconResult.status).toBe('completed');
      expect(reconResult.mismatchesCount).toBe(0);
    }
  }, 60000);
});
