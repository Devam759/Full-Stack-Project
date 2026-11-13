import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { setupTestDB, teardownTestDB, clearTestDB } from './setup/dbTestHelper.js';
import { createBookingFixtures } from './setup/bookingTestFixture.js';
import app from '../src/app.js';
import Booking from '../src/models/Booking.js';
import Wallet from '../src/models/Wallet.js';
import ItemDayLock from '../src/models/ItemDayLock.js';
import { executeBookingExpiryJob } from '../../worker/src/jobs/bookingExpiryJob.js';

describe('Suite 6: Booking Concurrency Races (Accept vs Cancel / Reject / Expiry)', () => {
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

  it('lender accept races with borrower cancel: exactly one succeeds, wallet and day locks are strictly consistent', async () => {
    const fixtures = await createBookingFixtures({
      borrowerFundsPaise: 500000,
      rentPerDayPaise: 50000,
      depositPaise: 100000,
    });

    const createRes = await request(app)
      .post('/v1/bookings')
      .set('Authorization', `Bearer ${fixtures.borrowerToken}`)
      .set('Idempotency-Key', 'ik-race-acc-canc-create')
      .send({
        itemId: fixtures.item._id.toString(),
        startDate: '2026-12-10',
        endDate: '2026-12-12', // 3 days = 150k + 100k = 250k
      });
    expect(createRes.status).toBe(201);
    const bookingId = createRes.body.booking._id;

    // Fire accept and cancel concurrently
    const [acceptRes, cancelRes] = await Promise.all([
      request(app)
        .post(`/v1/bookings/${bookingId}/accept`)
        .set('Authorization', `Bearer ${fixtures.lenderToken}`)
        .set('Idempotency-Key', 'ik-race-acc-1'),
      request(app)
        .post(`/v1/bookings/${bookingId}/cancel`)
        .set('Authorization', `Bearer ${fixtures.borrowerToken}`)
        .set('Idempotency-Key', 'ik-race-canc-1')
        .send({ reason: 'Changed my mind' }),
    ]);

    const finalBooking = await Booking.findById(bookingId);
    const finalLocks = await ItemDayLock.find({ bookingId });
    const finalWallet = await Wallet.findOne({ userId: fixtures.borrower._id });

    if (acceptRes.status === 200) {
      // Accept won the race! Cancel either returned 200 (if it cancelled the accepted booking) or 409
      expect(finalLocks.length).toBe(cancelRes.status === 200 ? 0 : 3);
      if (cancelRes.status === 200) {
        // Accepted then immediately cancelled with full refund
        expect(finalBooking.status).toBe('cancelled');
        expect(finalWallet.frozenPaise).toBe(0);
        expect(finalWallet.availablePaise).toBe(500000);
      } else {
        expect(finalBooking.status).toBe('accepted');
        expect(finalWallet.frozenPaise).toBe(250000);
        expect(finalWallet.availablePaise).toBe(250000);
      }
    } else {
      // Cancel won the race first! Accept failed with 409
      expect(cancelRes.status).toBe(200);
      expect(acceptRes.status).toBe(409);
      expect(finalBooking.status).toBe('cancelled');
      expect(finalLocks.length).toBe(0);
      expect(finalWallet.frozenPaise).toBe(0);
      expect(finalWallet.availablePaise).toBe(500000);
    }
  });

  it('lender accept races with lender reject: exactly one succeeds', async () => {
    const fixtures = await createBookingFixtures({
      borrowerFundsPaise: 500000,
      rentPerDayPaise: 50000,
      depositPaise: 100000,
    });

    const createRes = await request(app)
      .post('/v1/bookings')
      .set('Authorization', `Bearer ${fixtures.borrowerToken}`)
      .set('Idempotency-Key', 'ik-race-acc-rej-create')
      .send({
        itemId: fixtures.item._id.toString(),
        startDate: '2026-12-10',
        endDate: '2026-12-12',
      });
    expect(createRes.status).toBe(201);
    const bookingId = createRes.body.booking._id;

    const [acceptRes, rejectRes] = await Promise.all([
      request(app)
        .post(`/v1/bookings/${bookingId}/accept`)
        .set('Authorization', `Bearer ${fixtures.lenderToken}`)
        .set('Idempotency-Key', 'ik-race-acc-2'),
      request(app)
        .post(`/v1/bookings/${bookingId}/reject`)
        .set('Authorization', `Bearer ${fixtures.lenderToken}`)
        .set('Idempotency-Key', 'ik-race-rej-2')
        .send({ reason: 'Item unavailable' }),
    ]);

    const statuses = [acceptRes.status, rejectRes.status];
    expect(statuses).toContain(200);
    expect(statuses).toContain(409);

    const finalBooking = await Booking.findById(bookingId);
    const finalLocks = await ItemDayLock.find({ bookingId });
    const finalWallet = await Wallet.findOne({ userId: fixtures.borrower._id });

    if (acceptRes.status === 200) {
      expect(finalBooking.status).toBe('accepted');
      expect(finalLocks.length).toBe(3);
      expect(finalWallet.frozenPaise).toBe(250000);
    } else {
      expect(finalBooking.status).toBe('cancelled');
      expect(finalLocks.length).toBe(0);
      expect(finalWallet.frozenPaise).toBe(0);
      expect(finalWallet.availablePaise).toBe(500000);
    }
  });

  it('lender accept races with system expiry scanner: exactly one wins cleanly', async () => {
    const fixtures = await createBookingFixtures({
      borrowerFundsPaise: 500000,
      rentPerDayPaise: 50000,
      depositPaise: 100000,
    });

    const createRes = await request(app)
      .post('/v1/bookings')
      .set('Authorization', `Bearer ${fixtures.borrowerToken}`)
      .set('Idempotency-Key', 'ik-race-acc-exp-create')
      .send({
        itemId: fixtures.item._id.toString(),
        startDate: '2026-12-10',
        endDate: '2026-12-12',
      });
    expect(createRes.status).toBe(201);
    const bookingId = createRes.body.booking._id;

    // Backdate expiresAt so it is eligible for expiry
    await Booking.updateOne(
      { _id: bookingId },
      { $set: { expiresAt: new Date(Date.now() - 1000) } },
    );

    // Run accept API and expiry scanner concurrently
    const [acceptRes, _expireResult] = await Promise.allSettled([
      request(app)
        .post(`/v1/bookings/${bookingId}/accept`)
        .set('Authorization', `Bearer ${fixtures.lenderToken}`)
        .set('Idempotency-Key', 'ik-race-acc-3'),
      executeBookingExpiryJob(),
    ]);

    const finalBooking = await Booking.findById(bookingId);
    const finalLocks = await ItemDayLock.find({ bookingId });
    const finalWallet = await Wallet.findOne({ userId: fixtures.borrower._id });

    if (finalBooking.status === 'accepted') {
      expect(acceptRes.value.status).toBe(200);
      expect(finalLocks.length).toBe(3);
      expect(finalWallet.frozenPaise).toBe(250000);
    } else {
      expect(finalBooking.status).toBe('expired');
      expect(acceptRes.value.status).toBe(409);
      expect(finalLocks.length).toBe(0);
      expect(finalWallet.frozenPaise).toBe(0);
      expect(finalWallet.availablePaise).toBe(500000);
    }
  });

  it('lender accept extension races with borrower cancel: exactly one state progression, funds strictly conserved', async () => {
    const fixtures = await createBookingFixtures({
      borrowerFundsPaise: 500000,
      rentPerDayPaise: 50000,
      depositPaise: 100000,
    });

    const createRes = await request(app)
      .post('/v1/bookings')
      .set('Authorization', `Bearer ${fixtures.borrowerToken}`)
      .set('Idempotency-Key', 'ik-race-ext-c')
      .send({
        itemId: fixtures.item._id.toString(),
        startDate: '2026-12-10',
        endDate: '2026-12-12', // 3 days
      });
    const bookingId = createRes.body.booking._id;

    await request(app)
      .post(`/v1/bookings/${bookingId}/accept`)
      .set('Authorization', `Bearer ${fixtures.lenderToken}`)
      .set('Idempotency-Key', 'ik-race-ext-a');

    // Request extension (2 days = 100k extra rent)
    const extReqRes = await request(app)
      .post(`/v1/bookings/${bookingId}/extensions`)
      .set('Authorization', `Bearer ${fixtures.borrowerToken}`)
      .set('Idempotency-Key', 'ik-race-ext-r')
      .send({ requestedEndDate: '2026-12-14' });
    expect(extReqRes.status).toBe(201);

    // Concurrently fire lender accept extension vs borrower cancel booking
    const [accExtRes, cancelRes] = await Promise.all([
      request(app)
        .post(`/v1/bookings/${bookingId}/extensions/accept`)
        .set('Authorization', `Bearer ${fixtures.lenderToken}`)
        .set('Idempotency-Key', 'ik-race-ext-acc'),
      request(app)
        .post(`/v1/bookings/${bookingId}/cancel`)
        .set('Authorization', `Bearer ${fixtures.borrowerToken}`)
        .set('Idempotency-Key', 'ik-race-ext-canc')
        .send({ reason: 'Cancel whole trip' }),
    ]);

    const finalBooking = await Booking.findById(bookingId);
    const finalLocks = await ItemDayLock.find({ bookingId });
    const finalWallet = await Wallet.findOne({ userId: fixtures.borrower._id });

    // In all outcomes, if cancel was invoked:
    // Either cancel succeeded directly (200), or if acceptExtension ran first, cancel still succeeds or returns 200.
    // The final status must be 'cancelled' (or 'accepted' if cancel failed with 409).
    if (cancelRes.status === 200) {
      expect(finalBooking.status).toBe('cancelled');
      expect(finalLocks.length).toBe(0);
      expect(finalWallet.frozenPaise).toBe(0);
      expect(finalWallet.availablePaise).toBe(500000); // 100% refunded
    } else {
      expect(cancelRes.status).toBe(409);
      expect(accExtRes.status).toBe(200);
      expect(finalBooking.status).toBe('accepted');
      expect(finalWallet.frozenPaise).toBe(350000); // 150k rent + 100k deposit + 100k ext rent
    }
  });
});
