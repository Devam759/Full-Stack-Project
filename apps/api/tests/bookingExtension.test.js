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

describe('Suite 11: Booking Extensions (Request, Approval, Rejection, Max Limit & Conflicts)', () => {
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
  });

  it('allows borrower to request extension and lender to accept with funds held and day locks extended', async () => {
    // 500,000 paise initial funds. Rent = 50,000/day, deposit = 100,000.
    const fixtures = await createBookingFixtures({
      borrowerFundsPaise: 500000,
      rentPerDayPaise: 50000,
      depositPaise: 100000,
    });

    // 1. Initial 2-day booking: Dec 1 to Dec 2 (Hold: 100k rent + 100k deposit = 200k)
    const createRes = await request(app)
      .post('/v1/bookings')
      .set('Authorization', `Bearer ${fixtures.borrowerToken}`)
      .set('Idempotency-Key', 'ik-ext-create-1')
      .send({
        itemId: fixtures.item._id.toString(),
        startDate: '2026-12-01',
        endDate: '2026-12-02',
      });
    expect(createRes.status).toBe(201);
    const bookingId = createRes.body.booking._id;

    // Lender accepts
    const acceptRes = await request(app)
      .post(`/v1/bookings/${bookingId}/accept`)
      .set('Authorization', `Bearer ${fixtures.lenderToken}`)
      .set('Idempotency-Key', 'ik-ext-acc-1');
    expect(acceptRes.status).toBe(200);

    // Initial wallet state
    let bWallet = await Wallet.findOne({ userId: fixtures.borrower._id });
    expect(bWallet.availablePaise).toBe(300000);
    expect(bWallet.frozenPaise).toBe(200000);

    // 2. Borrower requests extension by 2 days: to Dec 4 (extraRent = 2 * 50k = 100k)
    const extReqRes = await request(app)
      .post(`/v1/bookings/${bookingId}/extensions`)
      .set('Authorization', `Bearer ${fixtures.borrowerToken}`)
      .set('Idempotency-Key', 'ik-ext-req-1')
      .send({
        newEndDate: '2026-12-04',
      });

    expect(extReqRes.status).toBe(201);
    expect(extReqRes.body.booking.extension.status).toBe('requested');
    expect(extReqRes.body.booking.extension.extraDays).toBe(2);
    expect(extReqRes.body.booking.extension.extraRentPaise).toBe(100000);

    // 3. Lender accepts extension
    const extAcceptRes = await request(app)
      .post(`/v1/bookings/${bookingId}/extensions/accept`)
      .set('Authorization', `Bearer ${fixtures.lenderToken}`)
      .set('Idempotency-Key', 'ik-ext-acc-exec-1');

    expect(extAcceptRes.status).toBe(200);
    const updatedBooking = extAcceptRes.body.booking;
    expect(updatedBooking.endDate).toBe('2026-12-04');
    expect(updatedBooking.days).toBe(4);
    expect(updatedBooking.rentPaise).toBe(200000);
    expect(updatedBooking.extension.status).toBe('accepted');

    // Wallet after extension: extra 100,000 frozen
    bWallet = await Wallet.findOne({ userId: fixtures.borrower._id });
    expect(bWallet.availablePaise).toBe(200000);
    expect(bWallet.frozenPaise).toBe(300000);

    // Day locks now include Dec 1, 2, 3, 4 (4 locks)
    const locks = await ItemDayLock.find({ bookingId });
    expect(locks.length).toBe(4);
    expect(locks.map((l) => l.day).sort()).toEqual([
      '2026-12-01',
      '2026-12-02',
      '2026-12-03',
      '2026-12-04',
    ]);

    // Ledger entries for extension_hold
    const extEntries = await LedgerEntry.find({
      userId: fixtures.borrower._id,
      type: 'extension_hold',
    });
    expect(extEntries.length).toBe(2);
    const frozenExt = extEntries.find((e) => e.account === 'frozen');
    expect(frozenExt.amountPaise).toBe(100000);
  });

  it('rejects extension request if extension days conflict with an existing booking', async () => {
    const fixtures = await createBookingFixtures();

    // Booking 1: Dec 1 to Dec 3
    const b1Res = await request(app)
      .post('/v1/bookings')
      .set('Authorization', `Bearer ${fixtures.borrowerToken}`)
      .set('Idempotency-Key', 'ik-ext-conf-1')
      .send({
        itemId: fixtures.item._id.toString(),
        startDate: '2026-12-01',
        endDate: '2026-12-03',
      });
    const booking1Id = b1Res.body.booking._id;

    await request(app)
      .post(`/v1/bookings/${booking1Id}/accept`)
      .set('Authorization', `Bearer ${fixtures.lenderToken}`)
      .set('Idempotency-Key', 'ik-ext-conf-acc-1');

    // Create a distinct day lock on Dec 5 (e.g. booked by someone else)
    await ItemDayLock.create({
      itemId: fixtures.item._id,
      day: '2026-12-05',
      bookingId: new Booking()._id,
    });

    // Attempt to extend Booking 1 to Dec 6 (covers Dec 4, 5, 6 — but Dec 5 is taken!)
    const conflictExtRes = await request(app)
      .post(`/v1/bookings/${booking1Id}/extensions`)
      .set('Authorization', `Bearer ${fixtures.borrowerToken}`)
      .set('Idempotency-Key', 'ik-ext-conf-req')
      .send({
        newEndDate: '2026-12-06',
      });

    expect(conflictExtRes.status).toBe(409);
    expect(conflictExtRes.body.error.code).toBe('DATES_NOT_AVAILABLE');
  });

  it('lender can reject extension request with no extra money moved', async () => {
    const fixtures = await createBookingFixtures();

    const bRes = await request(app)
      .post('/v1/bookings')
      .set('Authorization', `Bearer ${fixtures.borrowerToken}`)
      .set('Idempotency-Key', 'ik-ext-rej-create')
      .send({
        itemId: fixtures.item._id.toString(),
        startDate: '2026-12-01',
        endDate: '2026-12-03',
      });
    const bookingId = bRes.body.booking._id;

    await request(app)
      .post(`/v1/bookings/${bookingId}/accept`)
      .set('Authorization', `Bearer ${fixtures.lenderToken}`)
      .set('Idempotency-Key', 'ik-ext-rej-acc');

    // Request extension
    await request(app)
      .post(`/v1/bookings/${bookingId}/extensions`)
      .set('Authorization', `Bearer ${fixtures.borrowerToken}`)
      .set('Idempotency-Key', 'ik-ext-rej-req')
      .send({ newEndDate: '2026-12-05' });

    // Lender rejects
    const rejectRes = await request(app)
      .post(`/v1/bookings/${bookingId}/extensions/reject`)
      .set('Authorization', `Bearer ${fixtures.lenderToken}`)
      .set('Idempotency-Key', 'ik-ext-rej-exec')
      .send({ reason: 'Need the item back for another borrower' });

    expect(rejectRes.status).toBe(200);
    expect(rejectRes.body.booking.extension.status).toBe('rejected');
    expect(rejectRes.body.booking.endDate).toBe('2026-12-03'); // Unchanged

    // Day locks remain 3
    expect(await ItemDayLock.countDocuments({ bookingId })).toBe(3);
  });

  it('rejects requesting more than MAX_BOOKING_EXTENSIONS extensions with 409', async () => {
    const fixtures = await createBookingFixtures({ borrowerFundsPaise: 1000000 });

    const createRes = await request(app)
      .post('/v1/bookings')
      .set('Authorization', `Bearer ${fixtures.borrowerToken}`)
      .set('Idempotency-Key', 'ik-ext-max-create')
      .send({
        itemId: fixtures.item._id.toString(),
        startDate: '2026-12-01',
        endDate: '2026-12-02',
      });
    const bookingId = createRes.body.booking._id;

    await request(app)
      .post(`/v1/bookings/${bookingId}/accept`)
      .set('Authorization', `Bearer ${fixtures.lenderToken}`)
      .set('Idempotency-Key', 'ik-ext-max-accept');

    // Simulate 3 already resolved/accepted extensions
    await Booking.updateOne(
      { _id: bookingId },
      {
        $push: {
          extensions: {
            $each: [
              {
                id: 'ext-1',
                requestedEndDate: '2026-12-03',
                extraDays: 1,
                extraRentPaise: 1000,
                status: 'accepted',
              },
              {
                id: 'ext-2',
                requestedEndDate: '2026-12-04',
                extraDays: 1,
                extraRentPaise: 1000,
                status: 'accepted',
              },
              {
                id: 'ext-3',
                requestedEndDate: '2026-12-05',
                extraDays: 1,
                extraRentPaise: 1000,
                status: 'accepted',
              },
            ],
          },
        },
        $set: { endDate: '2026-12-04' },
      },
    );

    // 4th extension request should be rejected by MAX_BOOKING_EXTENSIONS check
    const ext4Res = await request(app)
      .post(`/v1/bookings/${bookingId}/extensions`)
      .set('Authorization', `Bearer ${fixtures.borrowerToken}`)
      .set('Idempotency-Key', 'ik-ext-max-4')
      .send({ requestedEndDate: '2026-12-05' });

    expect(ext4Res.status).toBe(409);
    expect(ext4Res.body.error.message).toContain('Maximum of 3 extensions reached');
  });
});
