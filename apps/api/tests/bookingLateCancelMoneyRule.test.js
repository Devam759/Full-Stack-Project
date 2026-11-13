import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { setupTestDB, teardownTestDB, clearTestDB } from './setup/dbTestHelper.js';
import { createBookingFixtures } from './setup/bookingTestFixture.js';
import app from '../src/app.js';
import Booking from '../src/models/Booking.js';
import Wallet from '../src/models/Wallet.js';
import LedgerEntry from '../src/models/LedgerEntry.js';
import DomainEvent from '../src/models/DomainEvent.js';
import * as bookingService from '../src/modules/bookings/bookingService.js';

describe('Item 1: Late Cancel Money Rule & Trust Penalty Invariant', () => {
  beforeAll(async () => {
    await setupTestDB();
    await Booking.init();
    await Wallet.init();
    await LedgerEntry.init();
    await DomainEvent.init();
  });

  afterAll(async () => {
    await teardownTestDB();
  });

  beforeEach(async () => {
    await clearTestDB();
  });

  it('late cancel by borrower at 6h - 1s: refunds 100% rent + deposit to borrower, 0 commission, platform_revenue unchanged, emits trust_score.penalty for borrower', async () => {
    const fixtures = await createBookingFixtures({
      borrowerFundsPaise: 500000,
      rentPerDayPaise: 10000,
      depositPaise: 20000,
    });

    const createRes = await request(app)
      .post('/v1/bookings')
      .set('Authorization', `Bearer ${fixtures.borrowerToken}`)
      .set('Idempotency-Key', 'ik-lc-b-create')
      .send({
        itemId: fixtures.item._id.toString(),
        startDate: '2026-12-10',
        endDate: '2026-12-12', // 2 days: rent 20,000, deposit 20,000 = 40,000 held
      });
    expect(createRes.status).toBe(201);
    const bookingId = createRes.body.booking._id;

    await request(app)
      .post(`/v1/bookings/${bookingId}/accept`)
      .set('Authorization', `Bearer ${fixtures.lenderToken}`)
      .set('Idempotency-Key', 'ik-lc-b-accept');

    // 6h - 1s means 1 second past threshold into late territory
    const thresholdMs = bookingService.calculateLateCancelThresholdMs('2026-12-10');
    const lateTime = thresholdMs + 1000;

    const cancelRes = await bookingService.cancelBooking({
      bookingId,
      userId: fixtures.borrower._id,
      reason: 'Late cancellation by borrower',
      now: lateTime,
    });

    expect(cancelRes.booking.isLateCancel).toBe(true);
    expect(cancelRes.refundedPaise).toBe(50000); // 100% full refund (30k rent + 20k deposit)

    // Borrower wallet must have full 500,000 paise available, 0 frozen
    const borrowerWallet = await Wallet.findOne({ userId: fixtures.borrower._id });
    expect(borrowerWallet.availablePaise).toBe(500000);
    expect(borrowerWallet.frozenPaise).toBe(0);

    // Lender wallet must be unchanged (0 paise)
    const lenderWallet = await Wallet.findOne({ userId: fixtures.lender._id });
    expect(lenderWallet.availablePaise).toBe(0);

    // Platform revenue must have received 0 commission
    const commissionEntries = await LedgerEntry.find({ account: 'platform_revenue' });
    expect(commissionEntries.length).toBe(0);

    // Trust penalty emitted for borrower
    const penaltyEvent = await DomainEvent.findOne({
      type: 'trust_score.penalty',
      'payload.userId': fixtures.borrower._id,
      'payload.reason': 'late_cancel',
    });
    expect(penaltyEvent).toBeDefined();
    expect(penaltyEvent.payload.delta).toBe(-3);

    // Global ledger sum strictly 0
    const allEntries = await LedgerEntry.find();
    const globalSum = allEntries.reduce((acc, e) => acc + e.amountPaise, 0);
    expect(globalSum).toBe(0);
  });

  it('late cancel by lender at 6h - 1s: refunds 100% rent + deposit to borrower, 0 commission, platform_revenue unchanged, emits trust_score.penalty for lender', async () => {
    const fixtures = await createBookingFixtures({
      borrowerFundsPaise: 500000,
      rentPerDayPaise: 10000,
      depositPaise: 20000,
    });

    const createRes = await request(app)
      .post('/v1/bookings')
      .set('Authorization', `Bearer ${fixtures.borrowerToken}`)
      .set('Idempotency-Key', 'ik-lc-l-create')
      .send({
        itemId: fixtures.item._id.toString(),
        startDate: '2026-12-10',
        endDate: '2026-12-12',
      });
    const bookingId = createRes.body.booking._id;

    await request(app)
      .post(`/v1/bookings/${bookingId}/accept`)
      .set('Authorization', `Bearer ${fixtures.lenderToken}`)
      .set('Idempotency-Key', 'ik-lc-l-accept');

    const thresholdMs = bookingService.calculateLateCancelThresholdMs('2026-12-10');
    const lateTime = thresholdMs + 1000;

    const cancelRes = await bookingService.cancelBooking({
      bookingId,
      userId: fixtures.lender._id,
      reason: 'Lender damaged item',
      now: lateTime,
    });

    expect(cancelRes.booking.isLateCancel).toBe(true);
    expect(cancelRes.refundedPaise).toBe(50000);

    const borrowerWallet = await Wallet.findOne({ userId: fixtures.borrower._id });
    expect(borrowerWallet.availablePaise).toBe(500000);
    expect(borrowerWallet.frozenPaise).toBe(0);

    // Trust penalty emitted for LENDER
    const penaltyEvent = await DomainEvent.findOne({
      type: 'trust_score.penalty',
      'payload.userId': fixtures.lender._id,
      'payload.reason': 'late_cancel',
    });
    expect(penaltyEvent).toBeDefined();
    expect(penaltyEvent.payload.delta).toBe(-3);

    // Platform revenue unchanged
    const commissionEntries = await LedgerEntry.find({ account: 'platform_revenue' });
    expect(commissionEntries.length).toBe(0);

    const allEntries = await LedgerEntry.find();
    expect(allEntries.reduce((acc, e) => acc + e.amountPaise, 0)).toBe(0);
  });

  it('boundary test at exactly 6 hours (on-time) vs 6 hours minus 1 second (late cancel)', async () => {
    const fixtures = await createBookingFixtures({
      borrowerFundsPaise: 500000,
      rentPerDayPaise: 10000,
      depositPaise: 20000,
    });

    const startDate = '2026-12-15';
    const endDate = '2026-12-17';
    const thresholdMs = bookingService.calculateLateCancelThresholdMs(startDate);

    // 1. Boundary: exactly 6 hours before start date (on-time boundary)
    // Date.now() < thresholdMs is on-time
    const create1 = await request(app)
      .post('/v1/bookings')
      .set('Authorization', `Bearer ${fixtures.borrowerToken}`)
      .set('Idempotency-Key', 'ik-bnd-1')
      .send({ itemId: fixtures.item._id.toString(), startDate, endDate });
    const b1Id = create1.body.booking._id;

    await request(app)
      .post(`/v1/bookings/${b1Id}/accept`)
      .set('Authorization', `Bearer ${fixtures.lenderToken}`)
      .set('Idempotency-Key', 'ik-bnd-1-acc');

    // Exactly 6h ahead (thresholdMs - 1ms, still on time)
    const cancel1 = await bookingService.cancelBooking({
      bookingId: b1Id,
      userId: fixtures.borrower._id,
      reason: 'On-time boundary',
      now: thresholdMs - 1,
    });

    expect(cancel1.booking.isLateCancel).toBe(false);
    expect(cancel1.refundedPaise).toBe(50000);

    // No penalty event for on-time
    const penalty1 = await DomainEvent.findOne({
      type: 'trust_score.penalty',
      bookingId: b1Id,
    });
    expect(penalty1).toBeNull();

    // 2. Boundary: exactly 6 hours minus 1 second (within 6h, thresholdMs + 1000ms): IS late cancel
    const create2 = await request(app)
      .post('/v1/bookings')
      .set('Authorization', `Bearer ${fixtures.borrowerToken}`)
      .set('Idempotency-Key', 'ik-bnd-2')
      .send({
        itemId: fixtures.item._id.toString(),
        startDate: '2026-12-20',
        endDate: '2026-12-22',
      });
    const b2Id = create2.body.booking._id;

    await request(app)
      .post(`/v1/bookings/${b2Id}/accept`)
      .set('Authorization', `Bearer ${fixtures.lenderToken}`)
      .set('Idempotency-Key', 'ik-bnd-2-acc');

    const threshold2Ms = bookingService.calculateLateCancelThresholdMs('2026-12-20');
    const cancel2 = await bookingService.cancelBooking({
      bookingId: b2Id,
      userId: fixtures.borrower._id,
      reason: 'Late boundary',
      now: threshold2Ms + 1000,
    });

    expect(cancel2.booking.isLateCancel).toBe(true);
    expect(cancel2.refundedPaise).toBe(50000);

    const penalty2 = await DomainEvent.findOne({
      type: 'trust_score.penalty',
      bookingId: b2Id,
    });
    expect(penalty2).toBeDefined();
    expect(penalty2.payload.userId.toString()).toBe(fixtures.borrower._id.toString());
  });
});
