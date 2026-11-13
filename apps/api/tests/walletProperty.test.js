import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fc from 'fast-check';
import mongoose from 'mongoose';
import { setupTestDB, teardownTestDB, clearTestDB } from './setup/dbTestHelper.js';
import User from '../src/models/User.js';
import Wallet from '../src/models/Wallet.js';
import LedgerEntry from '../src/models/LedgerEntry.js';
import ledgerService from '../src/modules/wallet/ledgerService.js';

describe('Suite 11: Fast-Check Property Testing (Global Conservation & Invariants)', () => {
  beforeAll(async () => {
    await setupTestDB();
  });

  afterAll(async () => {
    await teardownTestDB();
  });

  it('runs 100 state-aware runs maintaining invariants and executing all 7 financial operations', async () => {
    const executedCounts = {
      add: 0,
      withdraw: 0,
      booking_hold: 0,
      extension_hold: 0,
      deposit_release: 0,
      booking_cancel_refund: 0,
      settlement: 0,
    };

    let totalRunsExecuted = 0;
    const sequenceLengths = [];

    const opArbitrary = fc.record({
      type: fc.constantFrom(
        'add',
        'withdraw',
        'booking_hold',
        'extension_hold',
        'deposit_release',
        'booking_cancel_refund',
        'settlement',
      ),
      user: fc.constantFrom('A', 'B'),
      amount: fc.integer({ min: 100_00, max: 2_000_00 }), // ₹100 to ₹2,000
    });

    await fc.assert(
      fc.asyncProperty(fc.array(opArbitrary, { minLength: 5, maxLength: 30 }), async (actions) => {
        totalRunsExecuted += 1;
        sequenceLengths.push(actions.length);

        // Reset database state between runs
        await clearTestDB();

        const userA = await User.create({
          name: `User A ${totalRunsExecuted}`,
          email: `usera_${totalRunsExecuted}@example.com`,
          emailVerified: true,
          status: 'active',
          passwordHash: 'dummy',
        });

        const userB = await User.create({
          name: `User B ${totalRunsExecuted}`,
          email: `userb_${totalRunsExecuted}@example.com`,
          emailVerified: true,
          status: 'active',
          passwordHash: 'dummy',
        });

        // State-aware hold tracker
        const activeHolds = [];

        for (let i = 0; i < actions.length; i++) {
          const action = actions[i];
          const targetUser = action.user === 'A' ? userA : userB;
          const otherUser = action.user === 'A' ? userB : userA;

          try {
            if (action.type === 'add') {
              await ledgerService.addDemoFunds({
                userId: targetUser._id,
                amountPaise: action.amount,
              });
              executedCounts.add += 1;
            } else if (action.type === 'withdraw') {
              // Ensure sufficient available funds
              await ledgerService.addDemoFunds({
                userId: targetUser._id,
                amountPaise: action.amount + 10000,
              });
              await ledgerService.withdrawDemoFunds({
                userId: targetUser._id,
                amountPaise: action.amount,
              });
              executedCounts.withdraw += 1;
            } else if (action.type === 'booking_hold') {
              const rent = Math.floor(action.amount / 2);
              const deposit = action.amount - rent;
              const totalNeeded = rent + deposit;

              // Fund borrower to ensure hold can be created
              await ledgerService.addDemoFunds({
                userId: targetUser._id,
                amountPaise: totalNeeded + 5000,
              });

              const bookingId = new mongoose.Types.ObjectId();
              await ledgerService.freezeBookingFunds({
                borrowerId: targetUser._id,
                bookingId,
                rentPaise: rent,
                depositPaise: deposit,
              });

              activeHolds.push({
                bookingId,
                borrowerId: targetUser._id,
                lenderId: otherUser._id,
                rentPaise: rent,
                depositPaise: deposit,
                extraRentPaise: 0,
                depositReleased: false,
                settled: false,
                refunded: false,
                extCount: 0,
              });

              executedCounts.booking_hold += 1;
            } else if (action.type === 'extension_hold') {
              const openHold = activeHolds.find((h) => !h.settled && !h.refunded);
              if (openHold) {
                const extraRent = Math.min(action.amount, 5000);
                await ledgerService.addDemoFunds({
                  userId: openHold.borrowerId,
                  amountPaise: extraRent + 2000,
                });
                openHold.extCount += 1;
                await ledgerService.holdExtensionFunds({
                  borrowerId: openHold.borrowerId,
                  bookingId: openHold.bookingId,
                  extraRentPaise: extraRent,
                  opRef: `ext_${openHold.extCount}`,
                });
                openHold.extraRentPaise += extraRent;
                executedCounts.extension_hold += 1;
              } else {
                // Fallback: create hold first
                const bookingId = new mongoose.Types.ObjectId();
                await ledgerService.addDemoFunds({ userId: targetUser._id, amountPaise: 30000 });
                await ledgerService.freezeBookingFunds({
                  borrowerId: targetUser._id,
                  bookingId,
                  rentPaise: 10000,
                  depositPaise: 10000,
                });
                await ledgerService.holdExtensionFunds({
                  borrowerId: targetUser._id,
                  bookingId,
                  extraRentPaise: 2000,
                  opRef: 'ext_init',
                });
                activeHolds.push({
                  bookingId,
                  borrowerId: targetUser._id,
                  lenderId: otherUser._id,
                  rentPaise: 10000,
                  depositPaise: 10000,
                  extraRentPaise: 2000,
                  depositReleased: false,
                  settled: false,
                  refunded: false,
                  extCount: 1,
                });
                executedCounts.extension_hold += 1;
              }
            } else if (action.type === 'deposit_release') {
              let hold = activeHolds.find((h) => !h.depositReleased && !h.settled && !h.refunded);
              if (!hold) {
                // Create one to release
                const bookingId = new mongoose.Types.ObjectId();
                await ledgerService.addDemoFunds({ userId: targetUser._id, amountPaise: 30000 });
                await ledgerService.freezeBookingFunds({
                  borrowerId: targetUser._id,
                  bookingId,
                  rentPaise: 10000,
                  depositPaise: 10000,
                });
                hold = {
                  bookingId,
                  borrowerId: targetUser._id,
                  lenderId: otherUser._id,
                  rentPaise: 10000,
                  depositPaise: 10000,
                  extraRentPaise: 0,
                  depositReleased: false,
                  settled: false,
                  refunded: false,
                  extCount: 0,
                };
                activeHolds.push(hold);
              }

              await ledgerService.releaseDeposit({
                borrowerId: hold.borrowerId,
                bookingId: hold.bookingId,
                depositPaise: hold.depositPaise,
              });
              hold.depositReleased = true;
              executedCounts.deposit_release += 1;
            } else if (action.type === 'booking_cancel_refund') {
              let hold = activeHolds.find((h) => !h.refunded && !h.settled);
              if (!hold) {
                // Create one to cancel and refund
                const bookingId = new mongoose.Types.ObjectId();
                await ledgerService.addDemoFunds({ userId: targetUser._id, amountPaise: 30000 });
                await ledgerService.freezeBookingFunds({
                  borrowerId: targetUser._id,
                  bookingId,
                  rentPaise: 10000,
                  depositPaise: 10000,
                });
                hold = {
                  bookingId,
                  borrowerId: targetUser._id,
                  lenderId: otherUser._id,
                  rentPaise: 10000,
                  depositPaise: 10000,
                  extraRentPaise: 0,
                  depositReleased: false,
                  settled: false,
                  refunded: false,
                  extCount: 0,
                };
                activeHolds.push(hold);
              }

              const totalFrozen =
                (hold.depositReleased ? 0 : hold.depositPaise) +
                hold.rentPaise +
                hold.extraRentPaise;
              await ledgerService.refundCancelledBooking({
                borrowerId: hold.borrowerId,
                bookingId: hold.bookingId,
                totalFrozenPaise: totalFrozen,
              });
              hold.refunded = true;
              executedCounts.booking_cancel_refund += 1;
            } else if (action.type === 'settlement') {
              let hold = activeHolds.find((h) => !h.refunded && !h.settled);
              if (!hold) {
                // Create one to settle
                const bookingId = new mongoose.Types.ObjectId();
                await ledgerService.addDemoFunds({ userId: targetUser._id, amountPaise: 30000 });
                await ledgerService.freezeBookingFunds({
                  borrowerId: targetUser._id,
                  bookingId,
                  rentPaise: 10000,
                  depositPaise: 10000,
                });
                hold = {
                  bookingId,
                  borrowerId: targetUser._id,
                  lenderId: otherUser._id,
                  rentPaise: 10000,
                  depositPaise: 10000,
                  extraRentPaise: 0,
                  depositReleased: false,
                  settled: false,
                  refunded: false,
                  extCount: 0,
                };
                activeHolds.push(hold);
              }

              await ledgerService.settleBookingCompletion({
                bookingId: hold.bookingId,
                lenderId: hold.lenderId,
                borrowerId: hold.borrowerId,
                rentPaise: hold.rentPaise + hold.extraRentPaise,
                depositPaise: hold.depositReleased ? 0 : hold.depositPaise,
                lateChargePaise: 0,
              });
              hold.settled = true;
              executedCounts.settlement += 1;
            }
          } catch {
            // Ignore handled edge cases
          }
        }

        // Invariant Check 1: Global sum across all ledger entries in DB MUST ALWAYS be zero
        const allEntriesAgg = await LedgerEntry.aggregate([
          { $group: { _id: null, sum: { $sum: '$amountPaise' } } },
        ]);
        const globalSum = allEntriesAgg.length > 0 ? allEntriesAgg[0].sum : 0;
        expect(globalSum).toBe(0);

        // Invariant Check 2: No account balance is ever negative
        const wallets = await Wallet.find();
        for (const w of wallets) {
          expect(w.availablePaise).toBeGreaterThanOrEqual(0);
          expect(w.frozenPaise).toBeGreaterThanOrEqual(0);
          expect(w.pendingPaise).toBe(0);
        }

        // Invariant Check 3: Every wallet equals its ledger sums
        const userLedgerSums = await LedgerEntry.aggregate([
          {
            $match: {
              userId: { $in: [userA._id, userB._id] },
              account: { $in: ['available', 'frozen'] },
            },
          },
          {
            $group: {
              _id: { userId: '$userId', account: '$account' },
              sum: { $sum: '$amountPaise' },
            },
          },
        ]);

        const map = new Map();
        for (const s of userLedgerSums) {
          const key = `${s._id.userId.toString()}:${s._id.account}`;
          map.set(key, s.sum);
        }

        for (const w of wallets) {
          const availKey = `${w.userId.toString()}:available`;
          const frozenKey = `${w.userId.toString()}:frozen`;
          expect(w.availablePaise).toBe(map.get(availKey) || 0);
          expect(w.frozenPaise).toBe(map.get(frozenKey) || 0);
        }
      }),
      { numRuns: 100 },
    );

    const minSeq = Math.min(...sequenceLengths);
    const maxSeq = Math.max(...sequenceLengths);
    const avgSeq = sequenceLengths.reduce((a, b) => a + b, 0) / sequenceLengths.length;

    console.info('=== WALLET FAST-CHECK PROPERTY 100 RUNS SUMMARY ===');
    console.info(`numRuns: ${totalRunsExecuted}`);
    console.info(`sequenceLengths: min=${minSeq}, max=${maxSeq}, avg=${avgSeq.toFixed(2)}`);
    console.info('per-operation counts:');
    console.info(JSON.stringify(executedCounts, null, 2));

    // Requirement: FAIL the test if any operation ran fewer than 10 times
    for (const [operation, count] of Object.entries(executedCounts)) {
      expect(
        count,
        `Operation ${operation} must have executed at least 10 times`,
      ).toBeGreaterThanOrEqual(10);
    }
  }, 240000);
});
