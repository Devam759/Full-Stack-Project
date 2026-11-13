import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fc from 'fast-check';
import { setupTestDB, teardownTestDB, clearTestDB } from './setup/dbTestHelper.js';
import User from '../src/models/User.js';
import Community from '../src/models/Community.js';
import Membership from '../src/models/Membership.js';
import Item from '../src/models/Item.js';
import Wallet from '../src/models/Wallet.js';
import Booking from '../src/models/Booking.js';
import ItemDayLock from '../src/models/ItemDayLock.js';
import LedgerEntry from '../src/models/LedgerEntry.js';
import LedgerOperation from '../src/models/LedgerOperation.js';
import * as bookingService from '../src/modules/bookings/bookingService.js';
import * as ledgerService from '../src/modules/wallet/ledgerService.js';
import { executeBookingExpiryJob } from '../../worker/src/jobs/bookingExpiryJob.js';

describe('Suite 14: Fast-Check Property Testing (Booking Invariants & Financial Safety)', () => {
  beforeAll(async () => {
    await setupTestDB();
    await Booking.init();
    await ItemDayLock.init();
    await LedgerOperation.init();
  }, 60000);

  afterAll(async () => {
    await teardownTestDB();
  });

  it('runs 100 stateful randomized lifecycle action sequences verifying 0 global ledger sum, non-negative wallets, and zero day lock collisions', async () => {
    let totalRunsExecuted = 0;
    const sequenceLengths = [];
    const executedCounts = {
      create_request: 0,
      accept: 0,
      reject: 0,
      cancel: 0,
      request_extension: 0,
      accept_extension: 0,
      reject_extension: 0,
      expiry: 0,
    };

    const actionArbitrary = fc.record({
      type: fc.constantFrom(
        'create_request',
        'accept',
        'reject',
        'cancel',
        'request_extension',
        'accept_extension',
        'reject_extension',
        'expiry',
      ),
      startOffset: fc.integer({ min: 1, max: 10 }),
      duration: fc.integer({ min: 1, max: 4 }),
      reason: fc.constantFrom('User choice', 'Schedule conflict', 'Trip aborted'),
    });

    await fc.assert(
      fc.asyncProperty(
        fc.array(actionArbitrary, { minLength: 5, maxLength: 20 }),
        async (actions) => {
          totalRunsExecuted += 1;
          sequenceLengths.push(actions.length);
          await clearTestDB();

          // 1. Setup entities for this run
          const lender = await User.create({
            name: `Lender ${totalRunsExecuted}`,
            email: `lender_${totalRunsExecuted}_${Date.now()}@test.com`,
            emailVerified: true,
            status: 'active',
            passwordHash: 'dummy',
          });

          const borrower = await User.create({
            name: `Borrower ${totalRunsExecuted}`,
            email: `borrower_${totalRunsExecuted}_${Date.now()}@test.com`,
            emailVerified: true,
            status: 'active',
            passwordHash: 'dummy',
          });

          const community = await Community.create({
            name: `Comm ${totalRunsExecuted}_${Date.now()}`,
            slug: `comm-${totalRunsExecuted}-${Date.now()}`,
            ownerId: lender._id,
            city: 'Jaipur',
            type: 'public',
            location: { type: 'Point', coordinates: [75.8, 26.9] },
          });

          await Membership.create([
            { communityId: community._id, userId: lender._id, role: 'owner', status: 'active' },
            { communityId: community._id, userId: borrower._id, role: 'member', status: 'active' },
          ]);

          const item = await Item.create({
            ownerId: lender._id,
            communityIds: [community._id],
            title: `Item ${totalRunsExecuted}`,
            description: 'Item for property testing bookings',
            category: 'tools_and_diy',
            condition: 'good',
            photos: ['https://example.com/p.jpg'],
            rentPerDayPaise: 50000,
            depositPaise: 100000,
            minDays: 1,
            maxDays: 30,
            location: { type: 'Point', coordinates: [75.8, 26.9] },
            status: 'active',
          });

          // Fund borrower with ₹10,000 (1,000,000 paise)
          await ledgerService.addDemoFunds({
            userId: borrower._id,
            amountPaise: 1000000,
          });

          const createdBookingIds = [];

          // 2. Execute actions
          for (const action of actions) {
            try {
              if (action.type === 'create_request') {
                const baseDate = new Date();
                baseDate.setDate(baseDate.getDate() + action.startOffset);
                const startStr = baseDate.toISOString().slice(0, 10);
                baseDate.setDate(baseDate.getDate() + action.duration);
                const endStr = baseDate.toISOString().slice(0, 10);

                const res = await bookingService.createBookingRequest({
                  borrowerId: borrower._id,
                  itemId: item._id,
                  startDate: startStr,
                  endDate: endStr,
                  idempotency: {
                    key: `prop-req-${totalRunsExecuted}-${Math.random()}`,
                    requestHash: 'hash',
                  },
                });
                if (res?.booking?._id) {
                  createdBookingIds.push(res.booking._id);
                  executedCounts.create_request += 1;
                }
              } else if (action.type === 'accept') {
                let b = null;
                for (let i = createdBookingIds.length - 1; i >= 0; i--) {
                  const candidate = await Booking.findById(createdBookingIds[i]);
                  if (candidate && candidate.status === 'requested') {
                    b = candidate;
                    break;
                  }
                }
                if (!b) {
                  const baseDate = new Date();
                  baseDate.setDate(baseDate.getDate() + 30 + createdBookingIds.length * 3);
                  const s = baseDate.toISOString().slice(0, 10);
                  baseDate.setDate(baseDate.getDate() + 2);
                  const e = baseDate.toISOString().slice(0, 10);
                  const res = await bookingService.createBookingRequest({
                    borrowerId: borrower._id,
                    itemId: item._id,
                    startDate: s,
                    endDate: e,
                    idempotency: {
                      key: `prop-req-acc-${totalRunsExecuted}-${Math.random()}`,
                      requestHash: 'hash',
                    },
                  });
                  if (res?.booking) {
                    b = res.booking;
                    createdBookingIds.push(b._id);
                  }
                }
                if (b) {
                  await bookingService.acceptBooking({
                    bookingId: b._id,
                    lenderId: lender._id,
                    idempotency: {
                      key: `prop-acc-${totalRunsExecuted}-${Math.random()}`,
                      requestHash: 'hash',
                    },
                  });
                  executedCounts.accept += 1;
                }
              } else if (action.type === 'reject') {
                let b = null;
                for (let i = createdBookingIds.length - 1; i >= 0; i--) {
                  const candidate = await Booking.findById(createdBookingIds[i]);
                  if (candidate && candidate.status === 'requested') {
                    b = candidate;
                    break;
                  }
                }
                if (!b) {
                  const baseDate = new Date();
                  baseDate.setDate(baseDate.getDate() + 30 + createdBookingIds.length * 3);
                  const s = baseDate.toISOString().slice(0, 10);
                  baseDate.setDate(baseDate.getDate() + 2);
                  const e = baseDate.toISOString().slice(0, 10);
                  const res = await bookingService.createBookingRequest({
                    borrowerId: borrower._id,
                    itemId: item._id,
                    startDate: s,
                    endDate: e,
                    idempotency: {
                      key: `prop-req-rej-${totalRunsExecuted}-${Math.random()}`,
                      requestHash: 'hash',
                    },
                  });
                  if (res?.booking) {
                    b = res.booking;
                    createdBookingIds.push(b._id);
                  }
                }
                if (b) {
                  await bookingService.rejectBooking({
                    bookingId: b._id,
                    lenderId: lender._id,
                    reason: action.reason,
                    idempotency: {
                      key: `prop-rej-${totalRunsExecuted}-${Math.random()}`,
                      requestHash: 'hash',
                    },
                  });
                  executedCounts.reject += 1;
                }
              } else if (action.type === 'cancel') {
                let b = null;
                for (let i = createdBookingIds.length - 1; i >= 0; i--) {
                  const candidate = await Booking.findById(createdBookingIds[i]);
                  if (
                    candidate &&
                    (candidate.status === 'requested' || candidate.status === 'accepted')
                  ) {
                    b = candidate;
                    break;
                  }
                }
                if (b) {
                  await bookingService.cancelBooking({
                    bookingId: b._id,
                    userId: borrower._id,
                    reason: action.reason,
                    idempotency: {
                      key: `prop-canc-${totalRunsExecuted}-${Math.random()}`,
                      requestHash: 'hash',
                    },
                  });
                  executedCounts.cancel += 1;
                }
              } else if (action.type === 'request_extension' && createdBookingIds.length > 0) {
                // Find an accepted booking or accept the latest requested one
                let targetId = createdBookingIds[createdBookingIds.length - 1];
                let b = await Booking.findById(targetId);
                if (b && b.status === 'requested') {
                  await bookingService.acceptBooking({
                    bookingId: targetId,
                    lenderId: lender._id,
                    idempotency: {
                      key: `prop-preacc-${totalRunsExecuted}-${Math.random()}`,
                      requestHash: 'hash',
                    },
                  });
                  b = await Booking.findById(targetId);
                }

                if (b && b.status === 'accepted') {
                  const hasPending = b.extensions?.some((e) => e.status === 'requested');
                  if (!hasPending && (b.extensions?.length || 0) < 3) {
                    const end = new Date(b.endDate);
                    end.setDate(end.getDate() + 2);
                    await bookingService.requestExtension({
                      bookingId: b._id,
                      borrowerId: borrower._id,
                      newEndDate: end.toISOString().slice(0, 10),
                      idempotency: {
                        key: `prop-extreq-${totalRunsExecuted}-${Math.random()}`,
                        requestHash: 'hash',
                      },
                    });
                    executedCounts.request_extension += 1;
                  }
                }
              } else if (action.type === 'accept_extension' && createdBookingIds.length > 0) {
                let targetId = createdBookingIds[createdBookingIds.length - 1];
                let b = await Booking.findById(targetId);
                if (b && b.status === 'requested') {
                  await bookingService.acceptBooking({
                    bookingId: targetId,
                    lenderId: lender._id,
                    idempotency: {
                      key: `prop-preacc2-${totalRunsExecuted}-${Math.random()}`,
                      requestHash: 'hash',
                    },
                  });
                  b = await Booking.findById(targetId);
                }

                if (b && b.status === 'accepted') {
                  const hasPending = b.extensions?.some((e) => e.status === 'requested');
                  if (!hasPending && (b.extensions?.length || 0) < 3) {
                    const end = new Date(b.endDate);
                    end.setDate(end.getDate() + 2);
                    await bookingService.requestExtension({
                      bookingId: b._id,
                      borrowerId: borrower._id,
                      newEndDate: end.toISOString().slice(0, 10),
                      idempotency: {
                        key: `prop-extpre-acc-${totalRunsExecuted}-${Math.random()}`,
                        requestHash: 'hash',
                      },
                    });
                    b = await Booking.findById(targetId);
                  }
                  if (b?.extensions?.some((e) => e.status === 'requested')) {
                    await bookingService.acceptExtension({
                      bookingId: b._id,
                      lenderId: lender._id,
                      idempotency: {
                        key: `prop-extacc-${totalRunsExecuted}-${Math.random()}`,
                        requestHash: 'hash',
                      },
                    });
                    executedCounts.accept_extension += 1;
                  }
                }
              } else if (action.type === 'reject_extension' && createdBookingIds.length > 0) {
                let targetId = createdBookingIds[createdBookingIds.length - 1];
                let b = await Booking.findById(targetId);
                if (b && b.status === 'requested') {
                  await bookingService.acceptBooking({
                    bookingId: targetId,
                    lenderId: lender._id,
                    idempotency: {
                      key: `prop-preacc3-${totalRunsExecuted}-${Math.random()}`,
                      requestHash: 'hash',
                    },
                  });
                  b = await Booking.findById(targetId);
                }

                if (b && (b.status === 'accepted' || b.status === 'picked_up')) {
                  const hasPending = b.extensions?.some((e) => e.status === 'requested');
                  if (!hasPending && (b.extensions?.length || 0) < 3) {
                    const end = new Date(b.endDate);
                    end.setDate(end.getDate() + 2);
                    await bookingService.requestExtension({
                      bookingId: b._id,
                      borrowerId: borrower._id,
                      newEndDate: end.toISOString().slice(0, 10),
                      idempotency: {
                        key: `prop-extpre-${totalRunsExecuted}-${Math.random()}`,
                        requestHash: 'hash',
                      },
                    });
                  }
                  await bookingService.rejectExtension({
                    bookingId: b._id,
                    lenderId: lender._id,
                    reason: action.reason,
                    idempotency: {
                      key: `prop-extrej-${totalRunsExecuted}-${Math.random()}`,
                      requestHash: 'hash',
                    },
                  });
                  executedCounts.reject_extension += 1;
                }
              } else if (action.type === 'expiry') {
                // If there's an active booking, age it to exercise expiry paths
                if (createdBookingIds.length > 0) {
                  const bId = createdBookingIds[createdBookingIds.length - 1];
                  await Booking.updateOne(
                    { _id: bId, status: 'requested' },
                    { $set: { expiresAt: new Date(Date.now() - 1000) } },
                  );
                  await Booking.updateOne(
                    { _id: bId, status: 'accepted' },
                    { $set: { startDate: '2026-01-01' } },
                  );
                }
                await executeBookingExpiryJob();
                executedCounts.expiry += 1;
              }
            } catch {
              // Ignore expected business rule conflicts
            }
          }

          // Invariant 1: Global sum across all ledger entries in DB MUST ALWAYS be 0
          const sumAgg = await LedgerEntry.aggregate([
            { $group: { _id: null, sum: { $sum: '$amountPaise' } } },
          ]);
          const globalSum = sumAgg.length > 0 ? sumAgg[0].sum : 0;
          expect(globalSum).toBe(0);

          // Invariant 2: No account balance is ever negative
          const wallets = await Wallet.find();
          for (const w of wallets) {
            expect(w.availablePaise).toBeGreaterThanOrEqual(0);
            expect(w.frozenPaise).toBeGreaterThanOrEqual(0);
            expect(w.pendingPaise).toBe(0);
          }

          // Invariant 3: Wallet balances equal sum of their ledger entries
          const ledgerAgg = await LedgerEntry.aggregate([
            { $match: { userId: borrower._id } },
            { $group: { _id: '$account', sum: { $sum: '$amountPaise' } } },
          ]);
          const bWallet = await Wallet.findOne({ userId: borrower._id });
          const availSum = ledgerAgg.find((a) => a._id === 'available')?.sum || 0;
          const frozenSum = ledgerAgg.find((a) => a._id === 'frozen')?.sum || 0;
          expect(bWallet.availablePaise).toBe(availSum);
          expect(bWallet.frozenPaise).toBe(frozenSum);

          // Invariant 4: No two active bookings of the same item overlap
          const activeBookings = await Booking.find({
            itemId: item._id,
            status: { $in: ['accepted', 'picked_up', 'returned', 'disputed'] },
          }).sort({ startDate: 1 });

          for (let i = 0; i < activeBookings.length - 1; i++) {
            const b1 = activeBookings[i];
            const b2 = activeBookings[i + 1];
            expect(
              b1.endDate < b2.startDate,
              `Active bookings must not overlap: [${b1.startDate}, ${b1.endDate}] vs [${b2.startDate}, ${b2.endDate}]`,
            ).toBe(true);
          }

          // Invariant 5: ItemDayLock equals booked days of active bookings
          const allLocks = await ItemDayLock.find({ itemId: item._id });
          const lockDays = allLocks.map((l) => l.day).sort();

          const expectedDays = [];
          for (const b of activeBookings) {
            const start = new Date(b.startDate + 'T00:00:00Z');
            const end = new Date(b.endDate + 'T00:00:00Z');
            const cur = new Date(start);
            while (cur <= end) {
              expectedDays.push(cur.toISOString().slice(0, 10));
              cur.setUTCDate(cur.getUTCDate() + 1);
            }
          }
          expectedDays.sort();
          expect(lockDays).toEqual(expectedDays);

          // Invariant 6: Each booking refunded or settled at most once
          const allOps = await LedgerOperation.find({
            operationType: { $in: ['settlement', 'booking_cancel_refund'] },
            opRef: 'default',
          });
          const seenBookings = new Set();
          for (const op of allOps) {
            const bId = op.bookingId.toString();
            expect(seenBookings.has(bId), `Booking ${bId} refunded or settled more than once`).toBe(
              false,
            );
            seenBookings.add(bId);
          }
        },
      ),
      { numRuns: 100 },
    );

    const minSeq = Math.min(...sequenceLengths);
    const maxSeq = Math.max(...sequenceLengths);
    const avgSeq = sequenceLengths.reduce((a, b) => a + b, 0) / sequenceLengths.length;

    console.info('=== BOOKING FAST-CHECK PROPERTY 100 RUNS SUMMARY ===');
    console.info(`numRuns: ${totalRunsExecuted}`);
    console.info(`sequenceLengths: min=${minSeq}, max=${maxSeq}, avg=${avgSeq.toFixed(2)}`);
    console.info('per-operation counts:');
    console.info(JSON.stringify(executedCounts, null, 2));

    // Confirm that every operation ran at least 10 times across the 100 runs
    for (const [op, count] of Object.entries(executedCounts)) {
      expect(count, `Operation ${op} must execute at least 10 times`).toBeGreaterThanOrEqual(10);
    }
  }, 240000);
});
