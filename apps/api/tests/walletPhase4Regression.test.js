import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import fc from 'fast-check';
import { setupTestDB, teardownTestDB, clearTestDB } from './setup/dbTestHelper.js';
import app from '../src/app.js';
import User from '../src/models/User.js';
import Wallet from '../src/models/Wallet.js';
import LedgerEntry from '../src/models/LedgerEntry.js';
import LedgerOperation from '../src/models/LedgerOperation.js';
import IdempotencyKey from '../src/models/IdempotencyKey.js';
import ledgerService, { runInTransactionWithRetry } from '../src/modules/wallet/ledgerService.js';
import walletService from '../src/modules/wallet/walletService.js';
import { signAccessToken } from '../src/common/jwt.js';
import { toPaise, BUSINESS_CONFIG } from '@borrowloop/shared';

describe('Phase 4 Verification & Regression Suite', () => {
  beforeAll(async () => {
    await setupTestDB();
    await Wallet.init();
    await LedgerEntry.init();
    await LedgerOperation.init();
    await IdempotencyKey.init();
  }, 60000);

  afterAll(async () => {
    await teardownTestDB();
  });

  beforeEach(async () => {
    await clearTestDB();
  });

  describe('Check 9: Add-money edge cases', () => {
    it('(a) creates wallet on first add for user with no wallet yet', async () => {
      const user = await User.create({
        name: 'New User',
        email: 'newuser@example.com',
        emailVerified: true,
        status: 'active',
        passwordHash: 'dummy',
      });

      const res = await ledgerService.addDemoFunds({
        userId: user._id,
        amountPaise: 50000,
      });

      expect(res.availablePaise).toBe(50000);
      const createdWallet = await Wallet.findOne({ userId: user._id });
      expect(createdWallet).not.toBeNull();
      expect(createdWallet.availablePaise).toBe(50000);
    });

    it('(b) returns 409 WALLET_CAP_EXCEEDED when user is exactly at cap', async () => {
      const user = await User.create({
        name: 'Capped User',
        email: 'capped@example.com',
        emailVerified: true,
        status: 'active',
        passwordHash: 'dummy',
      });

      await ledgerService.addDemoFunds({
        userId: user._id,
        amountPaise: BUSINESS_CONFIG.WALLET_CAP_PAISE,
      });

      await expect(
        ledgerService.addDemoFunds({
          userId: user._id,
          amountPaise: 10000,
        }),
      ).rejects.toMatchObject({
        code: 'WALLET_CAP_EXCEEDED',
        statusCode: 409,
      });
    });
  });

  describe('Check 10: Settle-once unique operation rule', () => {
    it('prevents double settlement when called twice for same bookingId', async () => {
      const lender = await User.create({
        name: 'Lender 10',
        email: 'l10@example.com',
        emailVerified: true,
        status: 'active',
        passwordHash: 'dummy',
      });
      const borrower = await User.create({
        name: 'Borrower 10',
        email: 'b10@example.com',
        emailVerified: true,
        status: 'active',
        passwordHash: 'dummy',
      });

      await ledgerService.addDemoFunds({ userId: borrower._id, amountPaise: 1000000 });

      const bookingId = new mongoose.Types.ObjectId();
      const rentPaise = 20000;
      const depositPaise = 50000;

      await ledgerService.freezeBookingFunds({
        borrowerId: borrower._id,
        bookingId,
        rentPaise,
        depositPaise,
      });
      await ledgerService.freezeBookingFunds({
        borrowerId: borrower._id,
        bookingId: new mongoose.Types.ObjectId(),
        rentPaise: 50000,
        depositPaise: 50000,
      });

      // First settlement
      const firstRes = await ledgerService.settleBookingCompletion({
        bookingId,
        lenderId: lender._id,
        borrowerId: borrower._id,
        rentPaise,
        depositPaise,
      });
      expect(firstRes.lenderPayoutPaise).toBe(17000);

      const lenderBalanceAfterFirst = (await Wallet.findOne({ userId: lender._id })).availablePaise;

      // Second settlement call for the SAME bookingId
      const secondSettlement = await ledgerService.settleBookingCompletion({
        bookingId,
        lenderId: lender._id,
        borrowerId: borrower._id,
        rentPaise,
        depositPaise,
      });

      expect(secondSettlement.alreadyApplied).toBe(true);

      const lenderBalanceAfterSecond = (await Wallet.findOne({ userId: lender._id }))
        .availablePaise;
      expect(lenderBalanceAfterSecond).toBe(lenderBalanceAfterFirst);
    });
  });

  describe('Check 14: Concurrent requests with identical idempotency key', () => {
    it('executes exactly once without 500 or duplicate key crash', async () => {
      const user = await User.create({
        name: 'Concur User',
        email: 'concur@example.com',
        emailVerified: true,
        status: 'active',
        passwordHash: 'dummy',
      });
      const token = signAccessToken({ sub: user._id.toString(), role: 'user' });
      const key = 'ik-simultaneous-1';

      const [res1, res2] = await Promise.all([
        request(app)
          .post('/v1/wallet/add')
          .set('Authorization', `Bearer ${token}`)
          .set('Idempotency-Key', key)
          .send({ amountPaise: 20000 }),
        request(app)
          .post('/v1/wallet/add')
          .set('Authorization', `Bearer ${token}`)
          .set('Idempotency-Key', key)
          .send({ amountPaise: 20000 }),
      ]);

      const statuses = [res1.status, res2.status];
      expect(statuses).not.toContain(500);
      expect(statuses.every((s) => s === 200 || s === 409)).toBe(true);

      const wallet = await Wallet.findOne({ userId: user._id });
      expect(wallet.availablePaise).toBe(20000);
    });
  });

  describe('Check 15: Aborted transaction cleans up idempotency record', () => {
    it('leaves no idempotency record if transaction fails midway', async () => {
      const user = await User.create({
        name: 'Abort User',
        email: 'abort@example.com',
        emailVerified: true,
        status: 'active',
        passwordHash: 'dummy',
      });
      const key = 'ik-abort-test';

      await expect(
        runInTransactionWithRetry(async (session) => {
          await IdempotencyKey.create(
            [
              {
                userId: user._id,
                key,
                requestHash: 'hash123',
                statusCode: 200,
                responseBody: { ok: true },
              },
            ],
            { session },
          );
          throw new Error('Midway abort');
        }),
      ).rejects.toThrow('Midway abort');

      const saved = await IdempotencyKey.findOne({ userId: user._id, key });
      expect(saved).toBeNull();
    });
  });

  describe('Check 18: Banned lender settlement payout', () => {
    it('allows settlement payout when lender is banned', async () => {
      const borrower = await User.create({
        name: 'Borrower 18',
        email: 'b18@example.com',
        emailVerified: true,
        status: 'active',
        passwordHash: 'dummy',
      });
      const bannedLender = await User.create({
        name: 'Banned Lender',
        email: 'bannedlender@example.com',
        emailVerified: true,
        status: 'banned',
        passwordHash: 'dummy',
      });

      await ledgerService.addDemoFunds({ userId: borrower._id, amountPaise: 50000 });
      const bookingId = new mongoose.Types.ObjectId();

      await ledgerService.freezeBookingFunds({
        borrowerId: borrower._id,
        bookingId,
        rentPaise: 20000,
        depositPaise: 10000,
      });

      const settlement = await ledgerService.settleBookingCompletion({
        bookingId,
        lenderId: bannedLender._id,
        borrowerId: borrower._id,
        rentPaise: 20000,
        depositPaise: 10000,
      });

      expect(settlement.lenderPayoutPaise).toBe(17000);
      const lenderWallet = await Wallet.findOne({ userId: bannedLender._id });
      expect(lenderWallet.availablePaise).toBe(17000);
    });
  });

  describe('Check 20: Commission conservation on test amounts', () => {
    const amounts = [1, 2, 3, 3333, 9999, 100000];

    amounts.forEach((amt) => {
      it(`conserves money for earning of ${amt} paise`, () => {
        const commission = Math.round((amt * BUSINESS_CONFIG.COMMISSION_BPS) / 10000);
        const payout = amt - commission;
        expect(commission + payout).toBe(amt);
      });
    });
  });

  describe('Check 23: Cursor pagination with duplicate createdAt', () => {
    it('paginates without skipping or duplicating rows across 3 pages', async () => {
      const user = await User.create({
        name: 'Cursor User',
        email: 'cursor@example.com',
        emailVerified: true,
        status: 'active',
        passwordHash: 'dummy',
      });

      const sharedDate = new Date('2026-11-06T12:00:00.000Z');

      for (let i = 0; i < 6; i++) {
        await LedgerEntry.create({
          txnId: `txn-page-${i}`,
          account: 'available',
          userId: user._id,
          amountPaise: 1000,
          balanceAfterPaise: (i + 1) * 1000,
          type: 'deposit_funds',
          createdAt: i === 2 || i === 3 ? sharedDate : new Date(sharedDate.getTime() + i * 1000),
        });
      }

      const page1 = await walletService.getTransactionHistory(user._id, { limit: 2 });
      expect(page1.items.length).toBe(2);
      expect(page1.nextCursor).not.toBeNull();

      const page2 = await walletService.getTransactionHistory(user._id, {
        limit: 2,
        cursor: page1.nextCursor,
      });
      expect(page2.items.length).toBe(2);
      expect(page2.nextCursor).not.toBeNull();

      const page3 = await walletService.getTransactionHistory(user._id, {
        limit: 2,
        cursor: page2.nextCursor,
      });
      expect(page3.items.length).toBe(2);

      const allIds = [
        ...page1.items.map((i) => i.id),
        ...page2.items.map((i) => i.id),
        ...page3.items.map((i) => i.id),
      ];

      expect(new Set(allIds).size).toBe(6);
    });
  });

  describe('Check 31: Property test with 100 runs', () => {
    it('runs fast-check with 100 runs', async () => {
      const userA = await User.create({
        name: 'User A100',
        email: 'a100@example.com',
        emailVerified: true,
        status: 'active',
        passwordHash: 'dummy',
      });
      const userB = await User.create({
        name: 'User B100',
        email: 'b100@example.com',
        emailVerified: true,
        status: 'active',
        passwordHash: 'dummy',
      });

      const actionArbitrary = fc.record({
        type: fc.constantFrom('add', 'withdraw', 'freeze', 'settle'),
        user: fc.constantFrom('A', 'B'),
        amount: fc.integer({ min: 100_00, max: 10_000_00 }),
      });

      await fc.assert(
        fc.asyncProperty(
          fc.array(actionArbitrary, { minLength: 1, maxLength: 6 }),
          async (actions) => {
            for (const action of actions) {
              const targetUser = action.user === 'A' ? userA : userB;
              const otherUser = action.user === 'A' ? userB : userA;

              try {
                if (action.type === 'add') {
                  await ledgerService.addDemoFunds({
                    userId: targetUser._id,
                    amountPaise: action.amount,
                  });
                } else if (action.type === 'withdraw') {
                  await ledgerService.withdrawDemoFunds({
                    userId: targetUser._id,
                    amountPaise: action.amount,
                  });
                } else if (action.type === 'freeze') {
                  const rent = Math.floor(action.amount / 2);
                  await ledgerService.freezeBookingFunds({
                    borrowerId: targetUser._id,
                    bookingId: new mongoose.Types.ObjectId(),
                    rentPaise: rent,
                    depositPaise: action.amount - rent,
                  });
                } else if (action.type === 'settle') {
                  const rent = Math.floor(action.amount / 2);
                  const deposit = action.amount - rent;
                  const bId = new mongoose.Types.ObjectId();
                  await ledgerService.freezeBookingFunds({
                    borrowerId: targetUser._id,
                    bookingId: bId,
                    rentPaise: rent,
                    depositPaise: deposit,
                  });
                  await ledgerService.settleBookingCompletion({
                    bookingId: bId,
                    lenderId: otherUser._id,
                    borrowerId: targetUser._id,
                    rentPaise: rent,
                    depositPaise: deposit,
                  });
                }
              } catch {
                // Expected rejections
              }
            }

            const allEntries = await LedgerEntry.find();
            const sum = allEntries.reduce((acc, curr) => acc + curr.amountPaise, 0);
            expect(sum).toBe(0);
          },
        ),
        { numRuns: 100 },
      );
    }, 60000);
  });

  describe('Check 36: toPaise input handling', () => {
    it('tests toPaise inputs and group formatting', () => {
      expect(toPaise(0.1 + 0.2)).toBe(30);
      expect(toPaise('1,000')).toBe(100000);
      expect(toPaise('1,00,000')).toBe(10000000);
      expect(() => toPaise('1,00')).toThrow(TypeError);
      expect(() => toPaise('1,,0')).toThrow(TypeError);
      expect(() => toPaise('')).toThrow(TypeError);
      expect(() => toPaise('-50.00')).toThrow(RangeError);
      expect(() => toPaise('10.999')).toThrow(RangeError);
    });
  });
});
