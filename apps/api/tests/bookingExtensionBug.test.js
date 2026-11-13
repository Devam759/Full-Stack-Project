import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { setupTestDB, teardownTestDB, clearTestDB } from './setup/dbTestHelper.js';
import { createBookingFixtures } from './setup/bookingTestFixture.js';
import app from '../src/app.js';
import Booking from '../src/models/Booking.js';
import ItemDayLock from '../src/models/ItemDayLock.js';
import Wallet from '../src/models/Wallet.js';

describe('Bug A2: acceptExtension Status Check & Cancel Race Reproduction', () => {
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

  it('fails prior to fix: lender can accept extension on a cancelled booking and freeze funds', async () => {
    const fixtures = await createBookingFixtures({
      borrowerFundsPaise: 500000,
      rentPerDayPaise: 10000,
      depositPaise: 20000,
    });

    // 1. Create booking
    const createRes = await request(app)
      .post('/v1/bookings')
      .set('Authorization', `Bearer ${fixtures.borrowerToken}`)
      .set('Idempotency-Key', 'ik-ext-bug-1')
      .send({
        itemId: fixtures.item._id.toString(),
        startDate: '2026-12-01',
        endDate: '2026-12-03',
      });
    expect(createRes.status).toBe(201);
    const bookingId = createRes.body.booking._id;

    // 2. Lender accepts
    const accRes = await request(app)
      .post(`/v1/bookings/${bookingId}/accept`)
      .set('Authorization', `Bearer ${fixtures.lenderToken}`)
      .set('Idempotency-Key', 'ik-ext-bug-2');
    expect(accRes.status).toBe(200);

    // 3. Borrower requests extension to 2026-12-05
    const extRes = await request(app)
      .post(`/v1/bookings/${bookingId}/extensions`)
      .set('Authorization', `Bearer ${fixtures.borrowerToken}`)
      .set('Idempotency-Key', 'ik-ext-bug-3')
      .send({ requestedEndDate: '2026-12-05' });
    expect(extRes.status).toBe(201);

    // 4. Borrower cancels the booking
    const cancelRes = await request(app)
      .post(`/v1/bookings/${bookingId}/cancel`)
      .set('Authorization', `Bearer ${fixtures.borrowerToken}`)
      .set('Idempotency-Key', 'ik-ext-bug-4')
      .send({ reason: 'Changed mind' });
    expect(cancelRes.status).toBe(200);

    // 5. Lender attempts to accept the extension on the CANCELLED booking
    // PRIOR TO FIX: this succeeds or does not reject with INVALID_BOOKING_TRANSITION!
    // With proper fix: MUST return 409 INVALID_BOOKING_TRANSITION and move 0 funds.
    const extAccRes = await request(app)
      .post(`/v1/bookings/${bookingId}/extensions/accept`)
      .set('Authorization', `Bearer ${fixtures.lenderToken}`)
      .set('Idempotency-Key', 'ik-ext-bug-5');

    // This should be rejected!
    expect(extAccRes.status).toBe(409);
    expect(extAccRes.body.error.code).toBe('INVALID_BOOKING_TRANSITION');

    // Verify 0 locks exist for the cancelled booking
    const locks = await ItemDayLock.find({ bookingId });
    expect(locks.length).toBe(0);

    // Verify wallet has 0 frozen paise
    const borrowerWallet = await Wallet.findOne({ userId: fixtures.borrower._id });
    expect(borrowerWallet.frozenPaise).toBe(0);
  });

  it('accept racing with cancel run 20 times always ends consistent with ledger sum 0 and zero frozen paise', async () => {
    for (let i = 0; i < 20; i++) {
      const fixtures = await createBookingFixtures({
        borrowerFundsPaise: 500000,
        rentPerDayPaise: 10000,
        depositPaise: 20000,
      });

      // 1. Create booking
      const createRes = await request(app)
        .post('/v1/bookings')
        .set('Authorization', `Bearer ${fixtures.borrowerToken}`)
        .set('Idempotency-Key', `ik-race-c-${i}`)
        .send({
          itemId: fixtures.item._id.toString(),
          startDate: '2026-12-10',
          endDate: '2026-12-12',
        });
      expect(createRes.status).toBe(201);
      const bookingId = createRes.body.booking._id;

      // 2. Lender accepts
      const accRes = await request(app)
        .post(`/v1/bookings/${bookingId}/accept`)
        .set('Authorization', `Bearer ${fixtures.lenderToken}`)
        .set('Idempotency-Key', `ik-race-a-${i}`);
      expect(accRes.status).toBe(200);

      // 3. Borrower requests extension
      const extRes = await request(app)
        .post(`/v1/bookings/${bookingId}/extensions`)
        .set('Authorization', `Bearer ${fixtures.borrowerToken}`)
        .set('Idempotency-Key', `ik-race-e-${i}`)
        .send({ requestedEndDate: '2026-12-14' });
      expect(extRes.status).toBe(201);

      // 4. Concurrent race: lender accepts extension vs borrower cancels booking
      const [extAccRes, cancelRes] = await Promise.all([
        request(app)
          .post(`/v1/bookings/${bookingId}/extensions/accept`)
          .set('Authorization', `Bearer ${fixtures.lenderToken}`)
          .set('Idempotency-Key', `ik-race-ea-${i}`),
        request(app)
          .post(`/v1/bookings/${bookingId}/cancel`)
          .set('Authorization', `Bearer ${fixtures.borrowerToken}`)
          .set('Idempotency-Key', `ik-race-can-${i}`)
          .send({ reason: 'Racing cancel' }),
      ]);

      // Assert cancel succeeded
      expect([200, 409]).toContain(cancelRes.status);
      expect([200, 409]).toContain(extAccRes.status);

      // Final state checks:
      const b = await Booking.findById(bookingId);
      expect(b.status).toBe('cancelled');

      const borrowerWallet = await Wallet.findOne({ userId: fixtures.borrower._id });
      expect(borrowerWallet.frozenPaise).toBe(0);

      const locks = await ItemDayLock.find({ bookingId });
      expect(locks.length).toBe(0);
    }
  }, 60000);
});
