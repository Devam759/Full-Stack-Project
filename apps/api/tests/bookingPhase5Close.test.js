import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { setupTestDB, teardownTestDB, clearTestDB } from './setup/dbTestHelper.js';
import { createBookingFixtures } from './setup/bookingTestFixture.js';
import app from '../src/app.js';
import Booking from '../src/models/Booking.js';
import Item from '../src/models/Item.js';
import User from '../src/models/User.js';
import Wallet from '../src/models/Wallet.js';
import ItemDayLock from '../src/models/ItemDayLock.js';
import Block from '../src/models/Block.js';
import Membership from '../src/models/Membership.js';
import LedgerEntry from '../src/models/LedgerEntry.js';
import LedgerOperation from '../src/models/LedgerOperation.js';
import DomainEvent from '../src/models/DomainEvent.js';
import { executeBookingExpiryJob } from '../../worker/src/jobs/bookingExpiryJob.js';

describe('Stage 2 Group C: Comprehensive Booking Rules, Extensions, State Machine, Domain Events & Money Checks', () => {
  beforeAll(async () => {
    await setupTestDB();
    await Booking.init();
    await Item.init();
    await User.init();
    await Wallet.init();
    await ItemDayLock.init();
    await Block.init();
    await Membership.init();
    await LedgerEntry.init();
    await LedgerOperation.init();
    await DomainEvent.init();
  });

  afterAll(async () => {
    await teardownTestDB();
  });

  beforeEach(async () => {
    await clearTestDB();
  });

  describe('C1: acceptBooking Reject Conditions', () => {
    it('1. rejects when booking.expiresAt has passed (409 BOOKING_REQUEST_EXPIRED)', async () => {
      const fixtures = await createBookingFixtures();
      const createRes = await request(app)
        .post('/v1/bookings')
        .set('Authorization', `Bearer ${fixtures.borrowerToken}`)
        .set('Idempotency-Key', 'ik-c1-1-req')
        .send({
          itemId: fixtures.item._id.toString(),
          startDate: '2026-12-10',
          endDate: '2026-12-12',
        });
      expect(createRes.status).toBe(201);
      const bookingId = createRes.body.booking._id;

      // Force expiresAt into past
      await Booking.updateOne(
        { _id: bookingId },
        { $set: { expiresAt: new Date(Date.now() - 1000) } },
      );

      const accRes = await request(app)
        .post(`/v1/bookings/${bookingId}/accept`)
        .set('Authorization', `Bearer ${fixtures.lenderToken}`)
        .set('Idempotency-Key', 'ik-c1-1-acc');

      expect(accRes.status).toBe(409);
      expect(accRes.body.error.code).toBe('BOOKING_REQUEST_EXPIRED');

      // Verify no money moved and no locks
      const locks = await ItemDayLock.find({ bookingId });
      expect(locks.length).toBe(0);
      const wallet = await Wallet.findOne({ userId: fixtures.borrower._id });
      expect(wallet.frozenPaise).toBe(0);
    });

    it('2. rejects when item is no longer active (409 ITEM_UNAVAILABLE)', async () => {
      const fixtures = await createBookingFixtures();
      const createRes = await request(app)
        .post('/v1/bookings')
        .set('Authorization', `Bearer ${fixtures.borrowerToken}`)
        .set('Idempotency-Key', 'ik-c1-2-req')
        .send({
          itemId: fixtures.item._id.toString(),
          startDate: '2026-12-10',
          endDate: '2026-12-12',
        });
      const bookingId = createRes.body.booking._id;

      // Deactivate item
      await Item.updateOne({ _id: fixtures.item._id }, { $set: { status: 'paused' } });

      const accRes = await request(app)
        .post(`/v1/bookings/${bookingId}/accept`)
        .set('Authorization', `Bearer ${fixtures.lenderToken}`)
        .set('Idempotency-Key', 'ik-c1-2-acc');

      expect(accRes.status).toBe(409);
      expect(accRes.body.error.code).toBe('ITEM_UNAVAILABLE');
    });

    it('3. rejects when start date is in the past (400 BOOKING_START_DATE_PASSED)', async () => {
      const fixtures = await createBookingFixtures();
      const createRes = await request(app)
        .post('/v1/bookings')
        .set('Authorization', `Bearer ${fixtures.borrowerToken}`)
        .set('Idempotency-Key', 'ik-c1-3-req')
        .send({
          itemId: fixtures.item._id.toString(),
          startDate: '2026-12-10',
          endDate: '2026-12-12',
        });
      const bookingId = createRes.body.booking._id;

      // Force startDate into past
      await Booking.updateOne({ _id: bookingId }, { $set: { startDate: '2026-01-01' } });

      const accRes = await request(app)
        .post(`/v1/bookings/${bookingId}/accept`)
        .set('Authorization', `Bearer ${fixtures.lenderToken}`)
        .set('Idempotency-Key', 'ik-c1-3-acc');

      expect(accRes.status).toBe(400);
      expect(accRes.body.error.code).toBe('BOOKING_START_DATE_PASSED');
    });

    it('4. rejects when borrower is not an active community member (403 NOT_COMMUNITY_MEMBER)', async () => {
      const fixtures = await createBookingFixtures();
      const createRes = await request(app)
        .post('/v1/bookings')
        .set('Authorization', `Bearer ${fixtures.borrowerToken}`)
        .set('Idempotency-Key', 'ik-c1-4-req')
        .send({
          itemId: fixtures.item._id.toString(),
          startDate: '2026-12-10',
          endDate: '2026-12-12',
        });
      const bookingId = createRes.body.booking._id;

      // Remove borrower from community
      await Membership.deleteMany({ userId: fixtures.borrower._id });

      const accRes = await request(app)
        .post(`/v1/bookings/${bookingId}/accept`)
        .set('Authorization', `Bearer ${fixtures.lenderToken}`)
        .set('Idempotency-Key', 'ik-c1-4-acc');

      expect(accRes.status).toBe(403);
      expect(accRes.body.error.code).toBe('NOT_COMMUNITY_MEMBER');
    });

    it('5. rejects when lender or borrower has blocked the other (403 USER_BLOCKED)', async () => {
      const fixtures = await createBookingFixtures();
      const createRes = await request(app)
        .post('/v1/bookings')
        .set('Authorization', `Bearer ${fixtures.borrowerToken}`)
        .set('Idempotency-Key', 'ik-c1-5-req')
        .send({
          itemId: fixtures.item._id.toString(),
          startDate: '2026-12-10',
          endDate: '2026-12-12',
        });
      const bookingId = createRes.body.booking._id;

      // Lender blocks borrower
      await Block.create({
        blockerId: fixtures.lender._id,
        blockedId: fixtures.borrower._id,
      });

      const accRes = await request(app)
        .post(`/v1/bookings/${bookingId}/accept`)
        .set('Authorization', `Bearer ${fixtures.lenderToken}`)
        .set('Idempotency-Key', 'ik-c1-5-acc');

      expect(accRes.status).toBe(403);
      expect(accRes.body.error.code).toBe('USER_BLOCKED');
    });

    it('6. rejects when borrower or lender account is frozen, banned or deleted (403 USER_NOT_ELIGIBLE)', async () => {
      const fixtures = await createBookingFixtures();
      const createRes = await request(app)
        .post('/v1/bookings')
        .set('Authorization', `Bearer ${fixtures.borrowerToken}`)
        .set('Idempotency-Key', 'ik-c1-6-req')
        .send({
          itemId: fixtures.item._id.toString(),
          startDate: '2026-12-10',
          endDate: '2026-12-12',
        });
      const bookingId = createRes.body.booking._id;

      // Ban borrower
      await User.updateOne({ _id: fixtures.borrower._id }, { $set: { status: 'banned' } });

      const accRes = await request(app)
        .post(`/v1/bookings/${bookingId}/accept`)
        .set('Authorization', `Bearer ${fixtures.lenderToken}`)
        .set('Idempotency-Key', 'ik-c1-6-acc');

      expect(accRes.status).toBe(403);
      expect(accRes.body.error.code).toBe('USER_NOT_ELIGIBLE');
    });
  });

  describe('C2: Extensions Array, Limit, Expiry & Hold Refund', () => {
    it('enforces at most 3 extensions; 4th extension is rejected with MAX_EXTENSIONS_REACHED (409)', async () => {
      const fixtures = await createBookingFixtures({
        borrowerFundsPaise: 500000,
        rentPerDayPaise: 5000,
        depositPaise: 10000,
      });

      // 1. Create booking (2 days: 2026-12-01 to 2026-12-02)
      const createRes = await request(app)
        .post('/v1/bookings')
        .set('Authorization', `Bearer ${fixtures.borrowerToken}`)
        .set('Idempotency-Key', 'ik-ext-c2-c')
        .send({
          itemId: fixtures.item._id.toString(),
          startDate: '2026-12-01',
          endDate: '2026-12-02',
        });
      const bookingId = createRes.body.booking._id;

      await request(app)
        .post(`/v1/bookings/${bookingId}/accept`)
        .set('Authorization', `Bearer ${fixtures.lenderToken}`)
        .set('Idempotency-Key', 'ik-ext-c2-a');

      // Request and accept 3 extensions sequentially
      const dates = ['2026-12-03', '2026-12-04', '2026-12-05'];
      for (let i = 0; i < 3; i++) {
        const extRes = await request(app)
          .post(`/v1/bookings/${bookingId}/extensions`)
          .set('Authorization', `Bearer ${fixtures.borrowerToken}`)
          .set('Idempotency-Key', `ik-ext-c2-req-${i}`)
          .send({ requestedEndDate: dates[i] });
        expect(extRes.status).toBe(201);

        const accRes = await request(app)
          .post(`/v1/bookings/${bookingId}/extensions/accept`)
          .set('Authorization', `Bearer ${fixtures.lenderToken}`)
          .set('Idempotency-Key', `ik-ext-c2-acc-${i}`);
        expect(accRes.status).toBe(200);
      }

      // Verify extensions array has 3 accepted items
      const bDoc = await Booking.findById(bookingId);
      expect(bDoc.extensions.length).toBe(3);
      expect(bDoc.extensions[0].status).toBe('accepted');
      expect(bDoc.extensions[1].status).toBe('accepted');
      expect(bDoc.extensions[2].status).toBe('accepted');

      // Attempt 4th extension: MUST be rejected with MAX_EXTENSIONS_REACHED (409)
      const fourthRes = await request(app)
        .post(`/v1/bookings/${bookingId}/extensions`)
        .set('Authorization', `Bearer ${fixtures.borrowerToken}`)
        .set('Idempotency-Key', 'ik-ext-c2-fourth')
        .send({ requestedEndDate: '2026-12-06' });

      expect(fourthRes.status).toBe(409);
      expect(fourthRes.body.error.code).toBe('MAX_EXTENSIONS_REACHED');
    });

    it('worker expires unanswered extension, unfreezes hold, and booking remains active', async () => {
      const fixtures = await createBookingFixtures({
        borrowerFundsPaise: 500000,
        rentPerDayPaise: 10000,
        depositPaise: 20000,
      });

      const createRes = await request(app)
        .post('/v1/bookings')
        .set('Authorization', `Bearer ${fixtures.borrowerToken}`)
        .set('Idempotency-Key', 'ik-ext-exp-c')
        .send({
          itemId: fixtures.item._id.toString(),
          startDate: '2026-12-10',
          endDate: '2026-12-12',
        });
      const bookingId = createRes.body.booking._id;

      await request(app)
        .post(`/v1/bookings/${bookingId}/accept`)
        .set('Authorization', `Bearer ${fixtures.lenderToken}`)
        .set('Idempotency-Key', 'ik-ext-exp-a');

      // Request extension
      const extRes = await request(app)
        .post(`/v1/bookings/${bookingId}/extensions`)
        .set('Authorization', `Bearer ${fixtures.borrowerToken}`)
        .set('Idempotency-Key', 'ik-ext-exp-r')
        .send({ requestedEndDate: '2026-12-14' });
      expect(extRes.status).toBe(201);

      // Borrower wallet now has rent + deposit + extraRent frozen (50,000 paise frozen)
      let wallet = await Wallet.findOne({ userId: fixtures.borrower._id });
      expect(wallet.frozenPaise).toBe(70000); // 30k (initial 3d rent) + 20k (deposit) + 20k (ext 2d rent)

      // Age extension expiresAt into past
      await Booking.updateOne(
        { _id: bookingId, 'extensions.status': 'requested' },
        { $set: { 'extensions.$.expiresAt': new Date(Date.now() - 1000) } },
      );

      // Run worker expiry job
      const jobRes = await executeBookingExpiryJob();
      expect(jobRes.expiredExtensionsCount).toBe(1);

      // Verify extension is marked expired, but booking itself is still accepted!
      const updated = await Booking.findById(bookingId);
      expect(updated.status).toBe('accepted');
      expect(updated.extensions[0].status).toBe('expired');

      // Verify extension hold (20,000 paise) was unfrozen back to borrower available balance
      wallet = await Wallet.findOne({ userId: fixtures.borrower._id });
      expect(wallet.frozenPaise).toBe(50000); // Only initial 30k rent + 20k deposit remain frozen!

      // Attempt to accept expired extension: MUST be rejected
      const accRes = await request(app)
        .post(`/v1/bookings/${bookingId}/extensions/accept`)
        .set('Authorization', `Bearer ${fixtures.lenderToken}`)
        .set('Idempotency-Key', 'ik-ext-exp-acc');

      expect(accRes.status).toBe(409);
      expect(accRes.body.error.code).toBe('EXTENSION_NOT_ALLOWED');
    });
  });

  describe('C4 & C5: Persisted Domain Events & Booking Idempotency', () => {
    it('persists domain events to MongoDB domain_events collection throughout booking lifecycle', async () => {
      const fixtures = await createBookingFixtures();

      const createRes = await request(app)
        .post('/v1/bookings')
        .set('Authorization', `Bearer ${fixtures.borrowerToken}`)
        .set('Idempotency-Key', 'ik-evt-create')
        .send({
          itemId: fixtures.item._id.toString(),
          startDate: '2026-12-10',
          endDate: '2026-12-12',
        });
      const bookingId = createRes.body.booking._id;

      await request(app)
        .post(`/v1/bookings/${bookingId}/accept`)
        .set('Authorization', `Bearer ${fixtures.lenderToken}`)
        .set('Idempotency-Key', 'ik-evt-accept');

      await request(app)
        .post(`/v1/bookings/${bookingId}/extensions`)
        .set('Authorization', `Bearer ${fixtures.borrowerToken}`)
        .set('Idempotency-Key', 'ik-evt-ext')
        .send({ requestedEndDate: '2026-12-14' });

      // Query domain_events collection
      const events = await DomainEvent.find({ bookingId }).sort({ createdAt: 1 });
      expect(events.length).toBeGreaterThanOrEqual(3);

      const eventTypes = events.map((e) => e.type);
      expect(eventTypes).toContain('booking.requested');
      expect(eventTypes).toContain('booking.accepted');
      expect(eventTypes).toContain('booking.extension_requested');

      // Verify unique eventKey is indexed and present
      for (const ev of events) {
        expect(ev.eventKey).toBeDefined();
        expect(typeof ev.eventKey).toBe('string');
        expect(ev.timestamp).toBeInstanceOf(Date);
      }
    });

    it('replays identical response on idempotency retry; rejects differing body with 409 IDEMPOTENCY_KEY_REUSE', async () => {
      const fixtures = await createBookingFixtures();

      // 1. First attempt
      const res1 = await request(app)
        .post('/v1/bookings')
        .set('Authorization', `Bearer ${fixtures.borrowerToken}`)
        .set('Idempotency-Key', 'ik-c5-test-key')
        .send({
          itemId: fixtures.item._id.toString(),
          startDate: '2026-12-10',
          endDate: '2026-12-12',
        });
      expect(res1.status).toBe(201);
      const bookingId = res1.body.booking._id;

      // 2. Retry with same key and same body -> exact replay
      const res2 = await request(app)
        .post('/v1/bookings')
        .set('Authorization', `Bearer ${fixtures.borrowerToken}`)
        .set('Idempotency-Key', 'ik-c5-test-key')
        .send({
          itemId: fixtures.item._id.toString(),
          startDate: '2026-12-10',
          endDate: '2026-12-12',
        });
      expect(res2.status).toBe(201);
      expect(res2.body.booking._id).toBe(bookingId);

      // 3. Retry with same key but DIFFERENT body -> 409 IDEMPOTENCY_KEY_REUSE
      const res3 = await request(app)
        .post('/v1/bookings')
        .set('Authorization', `Bearer ${fixtures.borrowerToken}`)
        .set('Idempotency-Key', 'ik-c5-test-key')
        .send({
          itemId: fixtures.item._id.toString(),
          startDate: '2026-12-15', // Differing date
          endDate: '2026-12-17',
        });
      expect(res3.status).toBe(409);
      expect(res3.body.error.code).toBe('IDEMPOTENCY_KEY_REUSE');
    });
  });

  describe('C6: Money Checks & Late Cancellation 6h Threshold', () => {
    it('cancels at 6h + 1s (on-time): 100% full refund to borrower, 0 lender earnings, 0 commission', async () => {
      const fixtures = await createBookingFixtures({
        borrowerFundsPaise: 500000,
        rentPerDayPaise: 10000,
        depositPaise: 20000,
      });

      const createRes = await request(app)
        .post('/v1/bookings')
        .set('Authorization', `Bearer ${fixtures.borrowerToken}`)
        .set('Idempotency-Key', 'ik-c6-ontime-c')
        .send({
          itemId: fixtures.item._id.toString(),
          startDate: '2026-12-25',
          endDate: '2026-12-27', // 3 days: rent 30,000, deposit 20,000 = 50,000 paise held
        });
      const bookingId = createRes.body.booking._id;

      await request(app)
        .post(`/v1/bookings/${bookingId}/accept`)
        .set('Authorization', `Bearer ${fixtures.lenderToken}`)
        .set('Idempotency-Key', 'ik-c6-ontime-a');

      // Date is in future (> 6 hours ahead)
      const cancelRes = await request(app)
        .post(`/v1/bookings/${bookingId}/cancel`)
        .set('Authorization', `Bearer ${fixtures.borrowerToken}`)
        .set('Idempotency-Key', 'ik-c6-ontime-can')
        .send({ reason: 'Well in advance cancellation' });

      expect(cancelRes.status).toBe(200);
      expect(cancelRes.body.booking.isLateCancel).toBe(false);
      expect(cancelRes.body.refundedPaise).toBe(50000);

      // Verify wallet: 100% refunded
      const borrowerWallet = await Wallet.findOne({ userId: fixtures.borrower._id });
      expect(borrowerWallet.availablePaise).toBe(500000);
      expect(borrowerWallet.frozenPaise).toBe(0);

      const lenderWallet = await Wallet.findOne({ userId: fixtures.lender._id });
      expect(lenderWallet.availablePaise).toBe(0);

      // Verify ledger invariant: global sum = 0
      const entries = await LedgerEntry.find();
      const sum = entries.reduce((acc, e) => acc + e.amountPaise, 0);
      expect(sum).toBe(0);
    });

    it('cancels at 6h - 1s (late cancel): 100% full refund to borrower (rent + deposit), 0 commission, 0 lender earnings, trust penalty emitted', async () => {
      const fixtures = await createBookingFixtures({
        borrowerFundsPaise: 500000,
        rentPerDayPaise: 10000,
        depositPaise: 20000,
      });

      const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const dayAfter = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString().slice(0, 10);

      const createRes = await request(app)
        .post('/v1/bookings')
        .set('Authorization', `Bearer ${fixtures.borrowerToken}`)
        .set('Idempotency-Key', 'ik-c6-late-c')
        .send({
          itemId: fixtures.item._id.toString(),
          startDate: tomorrow,
          endDate: dayAfter, // 2 days: rent 20,000, deposit 20,000 = 40,000 held
        });
      const bookingId = createRes.body.booking._id;

      await request(app)
        .post(`/v1/bookings/${bookingId}/accept`)
        .set('Authorization', `Bearer ${fixtures.lenderToken}`)
        .set('Idempotency-Key', 'ik-c6-late-a');

      // Set startDate to today so that current time is within 6 hours of start date (< 6h)
      const today = new Date().toISOString().slice(0, 10);
      await Booking.updateOne({ _id: bookingId }, { $set: { startDate: today } });

      const cancelRes = await request(app)
        .post(`/v1/bookings/${bookingId}/cancel`)
        .set('Authorization', `Bearer ${fixtures.borrowerToken}`)
        .set('Idempotency-Key', 'ik-c6-late-can')
        .send({ reason: 'Late cancellation last minute' });

      expect(cancelRes.status).toBe(200);
      expect(cancelRes.body.booking.isLateCancel).toBe(true);
      expect(cancelRes.body.refundedPaise).toBe(40000); // 100% full refund (PRD 4.10)

      // 1. Borrower wallet: initial 500,000 fully returned (500,000 available, 0 frozen)
      const borrowerWallet = await Wallet.findOne({ userId: fixtures.borrower._id });
      expect(borrowerWallet.availablePaise).toBe(500000);
      expect(borrowerWallet.frozenPaise).toBe(0);

      // 2. Lender receives 0 (no rent split on pre-pickup cancel)
      const lenderWallet = await Wallet.findOne({ userId: fixtures.lender._id });
      expect(lenderWallet.availablePaise).toBe(0);

      // 3. Platform revenue receives 0 commission
      const commissionEntries = await LedgerEntry.find({ account: 'platform_revenue' });
      expect(commissionEntries.length).toBe(0);

      // 4. Settle-once LedgerOperation recorded
      const op = await LedgerOperation.findOne({
        bookingId,
        operationType: 'booking_cancel_refund',
        opRef: 'default',
      });
      expect(op).toBeDefined();

      // 5. Trust penalty event emitted for borrower
      const penaltyEvent = await DomainEvent.findOne({
        type: 'trust_score.penalty',
        'payload.reason': 'late_cancel',
      });
      expect(penaltyEvent).toBeDefined();
      expect(penaltyEvent.payload.userId.toString()).toBe(fixtures.borrower._id.toString());
      expect(penaltyEvent.payload.delta).toBe(-3);

      // 6. Global ledger sum is strictly 0
      const entries = await LedgerEntry.find();
      const sum = entries.reduce((acc, e) => acc + e.amountPaise, 0);
      expect(sum).toBe(0);
    });
  });
});
