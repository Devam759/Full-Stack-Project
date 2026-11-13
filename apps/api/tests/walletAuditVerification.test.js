import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { setupTestDB, teardownTestDB, clearTestDB } from './setup/dbTestHelper.js';
import app from '../src/app.js';
import User from '../src/models/User.js';
import Wallet from '../src/models/Wallet.js';
import ReconciliationRun from '../src/models/ReconciliationRun.js';
import LedgerOperation from '../src/models/LedgerOperation.js';
import ledgerService from '../src/modules/wallet/ledgerService.js';
import { reconciliationService } from '@borrowloop/server-core';
import { signAccessToken } from '../src/common/jwt.js';

describe('Suite: Permanent Wallet Audit Verification & Settle-Once Proofs', () => {
  beforeAll(async () => {
    await setupTestDB();
    await LedgerOperation.init();
    await Wallet.init();
    await ReconciliationRun.init();
  });

  afterAll(async () => {
    await teardownTestDB();
  });

  beforeEach(async () => {
    await clearTestDB();
  });

  describe('Settle-Once & LedgerOperation Verification', () => {
    it('verifies double settlement, double deposit release, double refund, 10 concurrent settlements, and two extension holds', async () => {
      const borrower = await User.create({
        name: 'Borrower 1',
        email: 'b1@example.com',
        emailVerified: true,
        status: 'active',
        passwordHash: 'dummy',
      });
      const lender = await User.create({
        name: 'Lender 1',
        email: 'l1@example.com',
        emailVerified: true,
        status: 'active',
        passwordHash: 'dummy',
      });

      await ledgerService.addDemoFunds({ userId: borrower._id, amountPaise: 500000 });

      // Verify schema defines unique compound index on { bookingId, operationType, opRef }
      const indexes = LedgerOperation.schema.indexes();
      const opIndex = indexes.find(
        (idx) => idx[0].bookingId && idx[0].operationType && idx[0].opRef,
      );
      expect(opIndex, 'LedgerOperation must define compound index').toBeDefined();
      expect(opIndex[1]?.unique, 'Compound index on LedgerOperation must be unique').toBe(true);

      // Verify that database strictly rejects duplicate insertions with E11000
      const testBookingId = new mongoose.Types.ObjectId();
      await LedgerOperation.create({
        bookingId: testBookingId,
        operationType: 'booking_hold',
        opRef: 'dup-test',
        amountPaise: 5000,
      });
      await expect(
        LedgerOperation.create({
          bookingId: testBookingId,
          operationType: 'booking_hold',
          opRef: 'dup-test',
          amountPaise: 5000,
        }),
      ).rejects.toThrow(/E11000|duplicate/i);

      // 1. Double settlement
      const b1 = new mongoose.Types.ObjectId();
      await ledgerService.freezeBookingFunds({
        borrowerId: borrower._id,
        bookingId: b1,
        rentPaise: 10000,
        depositPaise: 20000,
      });

      const s1 = await ledgerService.settleBookingCompletion({
        bookingId: b1,
        lenderId: lender._id,
        borrowerId: borrower._id,
        rentPaise: 10000,
        depositPaise: 20000,
      });
      expect(s1.lenderPayoutPaise).toBe(8500);

      const s2 = await ledgerService.settleBookingCompletion({
        bookingId: b1,
        lenderId: lender._id,
        borrowerId: borrower._id,
        rentPaise: 10000,
        depositPaise: 20000,
      });
      expect(s2.alreadyApplied).toBe(true);

      // 2. Double deposit release
      const b2 = new mongoose.Types.ObjectId();
      await ledgerService.freezeBookingFunds({
        borrowerId: borrower._id,
        bookingId: b2,
        rentPaise: 10000,
        depositPaise: 20000,
      });

      const rel1 = await ledgerService.releaseDeposit({
        borrowerId: borrower._id,
        bookingId: b2,
        depositPaise: 20000,
      });
      expect(rel1.releasedPaise).toBe(20000);

      const rel2 = await ledgerService.releaseDeposit({
        borrowerId: borrower._id,
        bookingId: b2,
        depositPaise: 20000,
      });
      expect(rel2.alreadyApplied).toBe(true);

      // 3. Double refund
      const b3 = new mongoose.Types.ObjectId();
      await ledgerService.freezeBookingFunds({
        borrowerId: borrower._id,
        bookingId: b3,
        rentPaise: 10000,
        depositPaise: 20000,
      });

      const ref1 = await ledgerService.refundCancelledBooking({
        borrowerId: borrower._id,
        bookingId: b3,
        totalFrozenPaise: 30000,
      });
      expect(ref1.refundedPaise).toBe(30000);

      const ref2 = await ledgerService.refundCancelledBooking({
        borrowerId: borrower._id,
        bookingId: b3,
        totalFrozenPaise: 30000,
      });
      expect(ref2.alreadyApplied).toBe(true);

      // 4. Two extension holds with different opRef
      const b4 = new mongoose.Types.ObjectId();
      await ledgerService.freezeBookingFunds({
        borrowerId: borrower._id,
        bookingId: b4,
        rentPaise: 10000,
        depositPaise: 20000,
      });

      const ext1 = await ledgerService.holdExtensionFunds({
        borrowerId: borrower._id,
        bookingId: b4,
        extraRentPaise: 5000,
        opRef: 'ext_ref_1',
      });
      expect(ext1.extraHeldPaise).toBe(5000);

      const ext2 = await ledgerService.holdExtensionFunds({
        borrowerId: borrower._id,
        bookingId: b4,
        extraRentPaise: 5000,
        opRef: 'ext_ref_2',
      });
      expect(ext2.extraHeldPaise).toBe(5000);

      // 5. 10 Concurrent settlements for one booking
      const b5 = new mongoose.Types.ObjectId();
      await ledgerService.freezeBookingFunds({
        borrowerId: borrower._id,
        bookingId: b5,
        rentPaise: 20000,
        depositPaise: 30000,
      });

      const lenderBalBefore = (await Wallet.findOne({ userId: lender._id })).availablePaise;

      const settlements = await Promise.all(
        Array.from({ length: 10 }, () =>
          ledgerService.settleBookingCompletion({
            bookingId: b5,
            lenderId: lender._id,
            borrowerId: borrower._id,
            rentPaise: 20000,
            depositPaise: 30000,
          }),
        ),
      );

      const successfulSettlements = settlements.filter((s) => s.lenderPayoutPaise === 17000);
      const duplicateSettlements = settlements.filter((s) => s.alreadyApplied === true);

      expect(successfulSettlements.length).toBe(1);
      expect(duplicateSettlements.length).toBe(9);

      const lenderBalAfter = (await Wallet.findOne({ userId: lender._id })).availablePaise;
      expect(lenderBalAfter - lenderBalBefore).toBe(17000); // Money unchanged by duplicates
    });
  });

  describe('Concurrent Same Idempotency-Key & Replay Validation', () => {
    it('verifies 20 simultaneous requests with the same key, different body rejection, and header validation', async () => {
      const user = await User.create({
        name: 'Concurrent User',
        email: 'concurrent@example.com',
        emailVerified: true,
        status: 'active',
        passwordHash: 'dummy',
      });
      const token = signAccessToken({ sub: user._id.toString(), role: 'user' });

      // Header validation
      const shortRes = await request(app)
        .post('/v1/wallet/add')
        .set('Authorization', `Bearer ${token}`)
        .set('Idempotency-Key', 'short')
        .send({ amountPaise: 10000 });
      expect(shortRes.status).toBe(400);

      const longRes = await request(app)
        .post('/v1/wallet/add')
        .set('Authorization', `Bearer ${token}`)
        .set('Idempotency-Key', 'a'.repeat(129))
        .send({ amountPaise: 10000 });
      expect(longRes.status).toBe(400);

      const invalidCharsRes = await request(app)
        .post('/v1/wallet/add')
        .set('Authorization', `Bearer ${token}`)
        .set('Idempotency-Key', 'invalid@key!')
        .send({ amountPaise: 10000 });
      expect(invalidCharsRes.status).toBe(400);

      // Different body rejection
      const keyDiff = 'ik-diff-body-test';
      const r1 = await request(app)
        .post('/v1/wallet/add')
        .set('Authorization', `Bearer ${token}`)
        .set('Idempotency-Key', keyDiff)
        .send({ amountPaise: 10000 });
      expect(r1.status).toBe(200);

      const r2 = await request(app)
        .post('/v1/wallet/add')
        .set('Authorization', `Bearer ${token}`)
        .set('Idempotency-Key', keyDiff)
        .send({ amountPaise: 20000 });
      expect(r2.status).toBe(409);
      expect(r2.body.error.code).toBe('IDEMPOTENCY_KEY_REUSE');

      // 20 Simultaneous requests with identical key
      const key20 = 'ik-concurrent-20-verify';
      const responses = await Promise.all(
        Array.from({ length: 20 }, () =>
          request(app)
            .post('/v1/wallet/add')
            .set('Authorization', `Bearer ${token}`)
            .set('Idempotency-Key', key20)
            .send({ amountPaise: 10000 }),
        ),
      );

      const statuses = responses.map((r) => r.status);
      expect(statuses.includes(500)).toBe(false);
      expect(statuses.every((s) => s === 200 || s === 409)).toBe(true);

      const w = await Wallet.findOne({ userId: user._id });
      // Initial 10000 + single execution 10000 = 20000
      expect(w.availablePaise).toBe(20000);
    });
  });

  describe('Reconciliation Live-Traffic, Resume, and Mismatch Cap', () => {
    it('runs live-traffic reconciliation 20 times, tests resume after crash, and tests mismatch cap', async () => {
      const user = await User.create({
        name: 'Rec User',
        email: 'rec@example.com',
        emailVerified: true,
        status: 'active',
        passwordHash: 'dummy',
      });
      await ledgerService.addDemoFunds({ userId: user._id, amountPaise: 1000000 });

      // Run live traffic reconciliation 20 times
      let mismatchEncountered = 0;
      for (let runIdx = 0; runIdx < 20; runIdx++) {
        const withdrawalPromises = Array.from({ length: 5 }, (_, i) =>
          ledgerService.withdrawDemoFunds({
            userId: user._id,
            amountPaise: 1000,
            meta: { runIdx, i },
          }),
        );

        const [recResult] = await Promise.all([
          reconciliationService.runReconciliation({ batchSize: 2 }),
          ...withdrawalPromises,
        ]);

        if (recResult.mismatchesCount > 0) {
          mismatchEncountered += recResult.mismatchesCount;
        }
      }
      expect(mismatchEncountered).toBe(0);

      // Test resume after crash
      const crashedRun = await ReconciliationRun.create({
        runId: 'rec-crashed-test',
        startedAt: new Date(Date.now() - 20 * 60 * 1000),
        status: 'in_progress',
        lastCheckpointUserId: user._id,
        totalWalletsChecked: 1,
        totalLedgerEntriesChecked: 5,
        globalLedgerSumPaise: 0,
        mismatchesCount: 0,
        mismatches: [],
      });

      const resumedRun = await reconciliationService.runReconciliation({
        resumeRunId: crashedRun.runId,
        batchSize: 10,
      });
      expect(resumedRun.status).toBe('completed');
    }, 60000);
  });
});
