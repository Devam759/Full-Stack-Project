import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { setupTestDB, teardownTestDB, clearTestDB } from '../../api/tests/setup/dbTestHelper.js';
import { createBookingFixtures } from '../../api/tests/setup/bookingTestFixture.js';
import Booking from '../../api/src/models/Booking.js';
import Wallet from '../../api/src/models/Wallet.js';
import ItemDayLock from '../../api/src/models/ItemDayLock.js';
import { executeBookingExpiryJob } from '../src/jobs/bookingExpiryJob.js';
import {
  freezeBookingFunds,
  holdExtensionFunds,
  refundCancelledBooking,
} from '@borrowloop/server-core';

describe('Bug A3: Pickup Expiry Atomic Status Update and Stale Amounts Reproduction', () => {
  beforeAll(async () => {
    await setupTestDB();
    await Booking.init();
    await ItemDayLock.init();
  });

  afterAll(async () => {
    await teardownTestDB();
  });

  beforeEach(async () => {
    await clearTestDB();
  });

  it('fails prior to fix: extension accepted between scan and transaction leaves extraRentPaise frozen forever', async () => {
    const fixtures = await createBookingFixtures({
      borrowerFundsPaise: 500000,
      rentPerDayPaise: 10000,
      depositPaise: 20000,
    });

    const booking = await Booking.create({
      borrowerId: fixtures.borrower._id,
      lenderId: fixtures.lender._id,
      itemId: fixtures.item._id,
      startDate: '2026-01-01',
      endDate: '2026-01-03',
      dueAt: new Date(),
      expiresAt: new Date(Date.now() + 86400000),
      days: 2,
      rentPaise: 20000,
      depositPaise: 20000,
      status: 'accepted',
    });

    // Freeze initial funds (40,000 paise)
    await freezeBookingFunds({
      borrowerId: fixtures.borrower._id,
      bookingId: booking._id,
      rentPaise: 20000,
      depositPaise: 20000,
    });

    // Intercept Booking.find to simulate an extension being accepted immediately after the query
    const originalFind = Booking.find.bind(Booking);
    let intercepted = false;
    Booking.find = function (...args) {
      const query = originalFind(...args);
      query.then = async function (resolve, reject) {
        try {
          const res = await query.exec();
          if (!intercepted && res.some((b) => b._id.toString() === booking._id.toString())) {
            intercepted = true;
            // Concurrently accept extension in DB
            await Booking.updateOne(
              { _id: booking._id },
              { $inc: { rentPaise: 10000, days: 1 }, $set: { endDate: '2026-01-04' } },
            );
            await holdExtensionFunds({
              borrowerId: fixtures.borrower._id,
              bookingId: booking._id,
              extraRentPaise: 10000,
              extensionId: 'ext-concurrent',
            });
          }
          resolve(res);
        } catch (e) {
          reject(e);
        }
      };
      return query;
    };

    try {
      await executeBookingExpiryJob();
    } finally {
      Booking.find = originalFind;
    }

    // Expect that ALL frozen money is refunded (50,000 paise)
    const walletAfter = await Wallet.findOne({ userId: fixtures.borrower._id });
    expect(walletAfter.frozenPaise).toBe(0);
    expect(walletAfter.availablePaise).toBe(500000);
  });

  it('booking cancelled concurrently results in exactly one refund and zero double refunds', async () => {
    const fixtures = await createBookingFixtures({
      borrowerFundsPaise: 500000,
      rentPerDayPaise: 10000,
      depositPaise: 20000,
    });

    const booking = await Booking.create({
      borrowerId: fixtures.borrower._id,
      lenderId: fixtures.lender._id,
      itemId: fixtures.item._id,
      startDate: '2026-01-01',
      endDate: '2026-01-03',
      dueAt: new Date(),
      expiresAt: new Date(Date.now() + 86400000),
      days: 2,
      rentPaise: 20000,
      depositPaise: 20000,
      status: 'accepted',
    });

    await freezeBookingFunds({
      borrowerId: fixtures.borrower._id,
      bookingId: booking._id,
      rentPaise: 20000,
      depositPaise: 20000,
    });

    // Borrower cancels concurrently
    await Booking.updateOne(
      { _id: booking._id, status: 'accepted' },
      { $set: { status: 'cancelled' } },
    );
    await ItemDayLock.deleteMany({ bookingId: booking._id });
    await refundCancelledBooking({
      borrowerId: fixtures.borrower._id,
      bookingId: booking._id,
      totalFrozenPaise: 40000,
      opRef: 'default',
    });

    // Now execute worker job
    const result = await executeBookingExpiryJob();
    expect(result.expiredPickupsCount).toBe(0);

    const walletAfter = await Wallet.findOne({ userId: fixtures.borrower._id });
    expect(walletAfter.frozenPaise).toBe(0);
    expect(walletAfter.availablePaise).toBe(500000);
  });

  it('bookings not in accepted state are untouched by pickup expiry', async () => {
    const fixtures = await createBookingFixtures({
      borrowerFundsPaise: 500000,
      rentPerDayPaise: 10000,
      depositPaise: 20000,
    });

    const activePickedUp = await Booking.create({
      borrowerId: fixtures.borrower._id,
      lenderId: fixtures.lender._id,
      itemId: fixtures.item._id,
      startDate: '2026-01-01',
      endDate: '2026-01-03',
      dueAt: new Date(),
      expiresAt: new Date(Date.now() + 86400000),
      days: 2,
      rentPaise: 20000,
      depositPaise: 20000,
      status: 'picked_up',
    });

    await executeBookingExpiryJob();

    const after = await Booking.findById(activePickedUp._id);
    expect(after.status).toBe('picked_up');
  });

  it('atomic update ensures concurrent cancellation between scan and execution is not overwritten', async () => {
    const fixtures = await createBookingFixtures({
      borrowerFundsPaise: 500000,
      rentPerDayPaise: 10000,
      depositPaise: 20000,
    });

    const booking = await Booking.create({
      borrowerId: fixtures.borrower._id,
      lenderId: fixtures.lender._id,
      itemId: fixtures.item._id,
      startDate: '2026-01-01',
      endDate: '2026-01-03',
      dueAt: new Date(),
      expiresAt: new Date(Date.now() + 86400000),
      days: 2,
      rentPaise: 20000,
      depositPaise: 20000,
      status: 'accepted',
    });

    await freezeBookingFunds({
      borrowerId: fixtures.borrower._id,
      bookingId: booking._id,
      rentPaise: 20000,
      depositPaise: 20000,
    });

    const originalFind = Booking.find.bind(Booking);
    let intercepted = false;
    Booking.find = function (...args) {
      const query = originalFind(...args);
      query.then = async function (resolve, reject) {
        try {
          const res = await query.exec();
          if (!intercepted && res.some((b) => b._id.toString() === booking._id.toString())) {
            intercepted = true;
            // Cancel the booking concurrently in the DB
            await Booking.updateOne({ _id: booking._id }, { $set: { status: 'cancelled' } });
          }
          resolve(res);
        } catch (e) {
          reject(e);
        }
      };
      return query;
    };

    try {
      const result = await executeBookingExpiryJob();
      expect(result.expiredPickupsCount).toBe(0);
    } finally {
      Booking.find = originalFind;
    }

    const docAfter = await Booking.findById(booking._id);
    expect(docAfter.status).toBe('cancelled');
  });
});
