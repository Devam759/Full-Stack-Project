import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { setupTestDB, teardownTestDB, clearTestDB } from './setup/dbTestHelper.js';
import { createBookingFixtures } from './setup/bookingTestFixture.js';
import app from '../src/app.js';
import Booking from '../src/models/Booking.js';
import Wallet from '../src/models/Wallet.js';
import ItemDayLock from '../src/models/ItemDayLock.js';
import LedgerEntry from '../src/models/LedgerEntry.js';
import LedgerOperation from '../src/models/LedgerOperation.js';
import { getRecordedEvents, clearRecordedEvents } from '@borrowloop/server-core';

describe('Suite 9: Booking Cancellation, Refund & Late-Cancel Penalty', () => {
  beforeAll(async () => {
    await setupTestDB();
    await Booking.init();
    await ItemDayLock.init();
    await LedgerOperation.init();
  });

  afterAll(async () => {
    await teardownTestDB();
  });

  beforeEach(async () => {
    await clearTestDB();
    clearRecordedEvents();
  });

  it('cancelling a requested booking moves zero money and deletes zero locks', async () => {
    const fixtures = await createBookingFixtures({
      borrowerFundsPaise: 500000,
    });

    const createRes = await request(app)
      .post('/v1/bookings')
      .set('Authorization', `Bearer ${fixtures.borrowerToken}`)
      .set('Idempotency-Key', 'ik-canc-req-1')
      .send({
        itemId: fixtures.item._id.toString(),
        startDate: '2026-12-10',
        endDate: '2026-12-12',
      });
    expect(createRes.status).toBe(201);
    const bookingId = createRes.body.booking._id;

    // Borrower cancels while still requested
    const cancelRes = await request(app)
      .post(`/v1/bookings/${bookingId}/cancel`)
      .set('Authorization', `Bearer ${fixtures.borrowerToken}`)
      .set('Idempotency-Key', 'ik-canc-req-exec')
      .send({ reason: 'Plans changed' });

    expect(cancelRes.status).toBe(200);
    expect(cancelRes.body.booking.status).toBe('cancelled');

    const bookingDoc = await Booking.findById(bookingId);
    expect(bookingDoc.status).toBe('cancelled');
    expect(bookingDoc.cancelReason).toBe('Plans changed');

    // Wallet is untouched
    const bWallet = await Wallet.findOne({ userId: fixtures.borrower._id });
    expect(bWallet.availablePaise).toBe(500000);
    expect(bWallet.frozenPaise).toBe(0);

    // No refund ledger entries
    const refundEntries = await LedgerEntry.find({ type: 'booking_cancel_refund' });
    expect(refundEntries.length).toBe(0);
  });

  it('cancelling an accepted booking on-time issues a 100% refund, releases locks, and does not penalize trust score', async () => {
    const fixtures = await createBookingFixtures({
      borrowerFundsPaise: 500000,
      rentPerDayPaise: 50000,
      depositPaise: 100000,
    });

    // Date far in future (> 6h ahead of start date)
    const createRes = await request(app)
      .post('/v1/bookings')
      .set('Authorization', `Bearer ${fixtures.borrowerToken}`)
      .set('Idempotency-Key', 'ik-canc-acc-create')
      .send({
        itemId: fixtures.item._id.toString(),
        startDate: '2026-12-25',
        endDate: '2026-12-27', // 3 days = 150k + 100k = 250k
      });
    expect(createRes.status).toBe(201);
    const bookingId = createRes.body.booking._id;

    // Lender accepts
    const acceptRes = await request(app)
      .post(`/v1/bookings/${bookingId}/accept`)
      .set('Authorization', `Bearer ${fixtures.lenderToken}`)
      .set('Idempotency-Key', 'ik-canc-acc-accept');
    expect(acceptRes.status).toBe(200);

    // Wallet is frozen
    let bWallet = await Wallet.findOne({ userId: fixtures.borrower._id });
    expect(bWallet.availablePaise).toBe(250000);
    expect(bWallet.frozenPaise).toBe(250000);

    // Day locks exist
    expect(await ItemDayLock.countDocuments({ bookingId })).toBe(3);

    // Borrower cancels on-time
    const cancelRes = await request(app)
      .post(`/v1/bookings/${bookingId}/cancel`)
      .set('Authorization', `Bearer ${fixtures.borrowerToken}`)
      .set('Idempotency-Key', 'ik-canc-acc-cancel')
      .send({ reason: 'Trip cancelled well in advance' });

    expect(cancelRes.status).toBe(200);
    expect(cancelRes.body.booking.status).toBe('cancelled');
    expect(cancelRes.body.booking.isLateCancel).toBe(false);

    // 1. Locks must be deleted
    expect(await ItemDayLock.countDocuments({ bookingId })).toBe(0);

    // 2. Full refund: frozen back to 0, available back to 500,000
    bWallet = await Wallet.findOne({ userId: fixtures.borrower._id });
    expect(bWallet.availablePaise).toBe(500000);
    expect(bWallet.frozenPaise).toBe(0);

    // 3. LedgerEntry pairs
    const refundEntries = await LedgerEntry.find({
      userId: fixtures.borrower._id,
      type: 'booking_cancel_refund',
    });
    expect(refundEntries.length).toBe(2);
    const frozenEntry = refundEntries.find((e) => e.account === 'frozen');
    const availEntry = refundEntries.find((e) => e.account === 'available');
    expect(frozenEntry.amountPaise).toBe(-250000);
    expect(availEntry.amountPaise).toBe(250000);

    // 4. LedgerOperation recorded
    const op = await LedgerOperation.findOne({
      bookingId,
      operationType: 'booking_cancel_refund',
    });
    expect(op).toBeDefined();

    // 5. No trust score penalty event for on-time cancel
    const penaltyEvents = getRecordedEvents().filter((e) => e.eventName === 'trust_score.penalty');
    expect(penaltyEvents.length).toBe(0);

    // 6. Global ledger sum is strictly 0
    const allEntries = await LedgerEntry.find();
    const globalSum = allEntries.reduce((sum, e) => sum + e.amountPaise, 0);
    expect(globalSum).toBe(0);
  });

  it('cancelling within 6 hours of start date (late cancel) emits trust score penalty event', async () => {
    const fixtures = await createBookingFixtures({
      borrowerFundsPaise: 500000,
      rentPerDayPaise: 50000,
      depositPaise: 100000,
    });

    // Create booking for tomorrow
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const dayAfter = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const createRes = await request(app)
      .post('/v1/bookings')
      .set('Authorization', `Bearer ${fixtures.borrowerToken}`)
      .set('Idempotency-Key', 'ik-late-canc-create')
      .send({
        itemId: fixtures.item._id.toString(),
        startDate: tomorrow,
        endDate: dayAfter,
      });
    expect(createRes.status).toBe(201);
    const bookingId = createRes.body.booking._id;

    await request(app)
      .post(`/v1/bookings/${bookingId}/accept`)
      .set('Authorization', `Bearer ${fixtures.lenderToken}`)
      .set('Idempotency-Key', 'ik-late-canc-accept');

    // Artificially advance time or backdate startDate to today so that current time is within 6 hours
    // (today's start date 00:00:00 IST is already passed or within 6h)
    const today = new Date().toISOString().slice(0, 10);
    await Booking.updateOne({ _id: bookingId }, { $set: { startDate: today } });

    // Borrower cancels late
    const cancelRes = await request(app)
      .post(`/v1/bookings/${bookingId}/cancel`)
      .set('Authorization', `Bearer ${fixtures.borrowerToken}`)
      .set('Idempotency-Key', 'ik-late-canc-exec')
      .send({ reason: 'Emergency cancellation last minute' });

    expect(cancelRes.status).toBe(200);
    expect(cancelRes.body.booking.isLateCancel).toBe(true);

    // Verify trust score penalty event was emitted
    const penaltyEvents = getRecordedEvents().filter((e) => e.eventName === 'trust_score.penalty');
    expect(penaltyEvents.length).toBe(1);
    expect(penaltyEvents[0].payload.delta).toBe(-3);
    expect(penaltyEvents[0].payload.reason).toBe('late_cancel');
    expect(penaltyEvents[0].payload.userId.toString()).toBe(fixtures.borrower._id.toString());
  });
});
