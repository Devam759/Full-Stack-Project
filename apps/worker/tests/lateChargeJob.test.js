import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { setupTestDB, teardownTestDB, clearTestDB } from '../../api/tests/setup/dbTestHelper.js';
import { createBookingFixtures } from '../../api/tests/setup/bookingTestFixture.js';
import {
  Booking,
  User,
  Notification,
  DomainEvent,
  clearRecordedEvents,
} from '@borrowloop/server-core';
import { accrueLateChargesJob } from '../src/jobs/lateChargeJob.js';

describe('Phase 7d: Late Charges and Not-Returned Dispute Job Tests', () => {
  beforeAll(async () => {
    await setupTestDB();
    await Booking.init();
    await User.init();
    await Notification.init();
    await DomainEvent.init();
  });

  afterAll(async () => {
    await teardownTestDB();
  });

  beforeEach(async () => {
    await clearTestDB();
    clearRecordedEvents();
  });

  // Helper to create a picked_up booking directly in database
  async function createOverduePickedUpBooking({
    daysOverdue = 1,
    lateFeePerDayPaise = 20000,
    depositPaise = 50000,
  }) {
    const fixtures = await createBookingFixtures({
      borrowerFundsPaise: 500000,
      rentPerDayPaise: 10000,
      depositPaise,
    });

    const now = new Date();
    const dueAt = new Date(now.getTime() - daysOverdue * 24 * 60 * 60 * 1000);
    const startDate = '2026-12-01';
    const endDate = '2026-12-03';

    const booking = await Booking.create({
      itemId: fixtures.item._id,
      borrowerId: fixtures.borrower._id,
      lenderId: fixtures.lender._id,
      communityId: fixtures.community._id,
      startDate,
      endDate,
      startDay: startDate,
      endDay: endDate,
      days: 3,
      expiresAt: new Date(Date.now() + 86400000),
      dueAt,
      pickupAt: new Date(dueAt.getTime() - 2 * 24 * 60 * 60 * 1000),
      rentPaise: 30000,
      depositPaise,
      lateFeePerDayPaise,
      status: 'picked_up',
      itemSnapshot: {
        title: fixtures.item.title,
        depositPaise,
        lateFeePerDayPaise,
      },
      statusHistory: [
        {
          fromStatus: 'accepted',
          toStatus: 'picked_up',
          actorId: fixtures.borrower._id,
          actorRole: 'borrower',
          timestamp: new Date(),
        },
      ],
    });

    return { ...fixtures, booking };
  }

  it('1. Overdue accrues and caps at the deposit', async () => {
    // 5 days overdue with late fee 20,000 paise/day = 100,000 paise, but deposit is 50,000 paise
    const { booking } = await createOverduePickedUpBooking({
      daysOverdue: 2, // under 3-day dispute
      lateFeePerDayPaise: 60000, // 2 days * 60,000 = 120,000 > 50,000 cap
      depositPaise: 50000,
    });

    const res = await accrueLateChargesJob();
    expect(res.success).toBe(true);

    const updated = await Booking.findById(booking._id);
    expect(updated.lateChargePaise).toBe(50000); // Capped at deposit
    expect(updated.status).toBe('picked_up');
  });

  it('2. Fee 0 still opens the dispute when past 3 days', async () => {
    const { booking, borrower } = await createOverduePickedUpBooking({
      daysOverdue: 3.2, // past 3-day threshold
      lateFeePerDayPaise: 0,
      depositPaise: 50000,
    });

    const res = await accrueLateChargesJob();
    expect(res.success).toBe(true);
    expect(res.disputesOpened).toBe(1);

    const updatedBooking = await Booking.findById(booking._id);
    expect(updatedBooking.status).toBe('disputed');
    expect(updatedBooking.disputeReason).toBe('not_returned');
    expect(updatedBooking.disputeOpenedAt).toBeTruthy();

    // Borrower account must be frozen
    const updatedBorrower = await User.findById(borrower._id);
    expect(updatedBorrower.status).toBe('frozen');

    // dispute.requested event emitted
    const events = await DomainEvent.find({ bookingId: booking._id, type: 'dispute.requested' });
    expect(events.length).toBe(1);
    expect(events[0].payload.disputeReason).toBe('not_returned');
  });

  it('3. Dispute opens exactly at 3 days and not before', async () => {
    // Booking A: 2.8 days overdue -> stays picked_up
    const { booking: bookingA, borrower: borrowerA } = await createOverduePickedUpBooking({
      daysOverdue: 2.8,
      lateFeePerDayPaise: 10000,
      depositPaise: 50000,
    });

    // Booking B: 3.1 days overdue -> opens dispute
    const { booking: bookingB, borrower: borrowerB } = await createOverduePickedUpBooking({
      daysOverdue: 3.1,
      lateFeePerDayPaise: 10000,
      depositPaise: 50000,
    });

    await accrueLateChargesJob();

    const updatedA = await Booking.findById(bookingA._id);
    expect(updatedA.status).toBe('picked_up');
    const userA = await User.findById(borrowerA._id);
    expect(userA.status).toBe('active'); // Not frozen

    const updatedB = await Booking.findById(bookingB._id);
    expect(updatedB.status).toBe('disputed');
    expect(updatedB.disputeReason).toBe('not_returned');
    const userB = await User.findById(borrowerB._id);
    expect(userB.status).toBe('frozen'); // Frozen
  });

  it('4. Rerunning the job does not change the charge (idempotent absolute assignment f(now))', async () => {
    const { booking } = await createOverduePickedUpBooking({
      daysOverdue: 1.5, // 2 days late
      lateFeePerDayPaise: 15000,
      depositPaise: 50000,
    });

    await accrueLateChargesJob();
    const firstRun = await Booking.findById(booking._id);
    const charge1 = firstRun.lateChargePaise;
    expect(charge1).toBe(30000); // 2 days * 15,000

    // Run again immediately
    await accrueLateChargesJob();
    const secondRun = await Booking.findById(booking._id);
    expect(secondRun.lateChargePaise).toBe(charge1); // Does not increment
  });

  it('5. Concurrent job execution produces exactly one dispute without duplicate events', async () => {
    const { booking } = await createOverduePickedUpBooking({
      daysOverdue: 4,
      lateFeePerDayPaise: 10000,
      depositPaise: 50000,
    });

    // Run two executions concurrently
    await Promise.all([accrueLateChargesJob(), accrueLateChargesJob()]);

    const updated = await Booking.findById(booking._id);
    expect(updated.status).toBe('disputed');

    const disputeEvents = await DomainEvent.find({
      bookingId: booking._id,
      type: 'dispute.requested',
    });
    expect(disputeEvents.length).toBe(1);
  });
});
