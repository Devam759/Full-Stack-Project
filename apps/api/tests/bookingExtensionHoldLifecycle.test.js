import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { setupTestDB, teardownTestDB, clearTestDB } from './setup/dbTestHelper.js';
import { createBookingFixtures } from './setup/bookingTestFixture.js';
import app from '../src/app.js';
import Booking from '../src/models/Booking.js';
import Wallet from '../src/models/Wallet.js';
import LedgerEntry from '../src/models/LedgerEntry.js';
import ItemDayLock from '../src/models/ItemDayLock.js';
import { executeBookingExpiryJob } from '../../worker/src/jobs/bookingExpiryJob.js';

describe('Item 2: Extension Hold Timing & Comprehensive Refund Invariants', () => {
  beforeAll(async () => {
    await setupTestDB();
    await Booking.init();
    await Wallet.init();
    await LedgerEntry.init();
    await ItemDayLock.init();
  });

  afterAll(async () => {
    await teardownTestDB();
  });

  beforeEach(async () => {
    await clearTestDB();
  });

  it('1. request extension then cancel: refunds booking hold AND pending extension hold (ledger sum 0, 0 frozen, 0 orphan locks)', async () => {
    const fixtures = await createBookingFixtures({
      borrowerFundsPaise: 500000,
      rentPerDayPaise: 10000,
      depositPaise: 20000,
    });

    // Create 2-day booking: rent 20,000, deposit 20,000 = 40,000 held
    const createRes = await request(app)
      .post('/v1/bookings')
      .set('Authorization', `Bearer ${fixtures.borrowerToken}`)
      .set('Idempotency-Key', 'ik-ext1-c')
      .send({
        itemId: fixtures.item._id.toString(),
        startDate: '2026-12-10',
        endDate: '2026-12-11',
      });
    const bookingId = createRes.body.booking._id;

    await request(app)
      .post(`/v1/bookings/${bookingId}/accept`)
      .set('Authorization', `Bearer ${fixtures.lenderToken}`)
      .set('Idempotency-Key', 'ik-ext1-a');

    // Request 2-day extension: extra rent 20,000 paise held at request time per API_SPEC.md
    const extRes = await request(app)
      .post(`/v1/bookings/${bookingId}/extensions`)
      .set('Authorization', `Bearer ${fixtures.borrowerToken}`)
      .set('Idempotency-Key', 'ik-ext1-r')
      .send({ requestedEndDate: '2026-12-13' });
    expect(extRes.status).toBe(201);

    // Borrower wallet now has 40,000 + 20,000 = 60,000 frozen
    let wallet = await Wallet.findOne({ userId: fixtures.borrower._id });
    expect(wallet.frozenPaise).toBe(60000);

    // Cancel booking before pickup
    const cancelRes = await request(app)
      .post(`/v1/bookings/${bookingId}/cancel`)
      .set('Authorization', `Bearer ${fixtures.borrowerToken}`)
      .set('Idempotency-Key', 'ik-ext1-can')
      .send({ reason: 'Trip cancelled' });
    expect(cancelRes.status).toBe(200);

    // Invariants check:
    wallet = await Wallet.findOne({ userId: fixtures.borrower._id });
    expect(wallet.frozenPaise).toBe(0);
    expect(wallet.availablePaise).toBe(500000);

    const locks = await ItemDayLock.find({ bookingId });
    expect(locks.length).toBe(0);

    const entries = await LedgerEntry.find();
    const sum = entries.reduce((acc, e) => acc + e.amountPaise, 0);
    expect(sum).toBe(0);
  });

  it('2. request extension then pickup expiry: worker refunds booking hold AND pending extension hold (ledger sum 0, 0 frozen, 0 orphan locks)', async () => {
    const fixtures = await createBookingFixtures({
      borrowerFundsPaise: 500000,
      rentPerDayPaise: 10000,
      depositPaise: 20000,
    });

    const createRes = await request(app)
      .post('/v1/bookings')
      .set('Authorization', `Bearer ${fixtures.borrowerToken}`)
      .set('Idempotency-Key', 'ik-ext2-c')
      .send({
        itemId: fixtures.item._id.toString(),
        startDate: '2026-12-10',
        endDate: '2026-12-11',
      });
    const bookingId = createRes.body.booking._id;

    await request(app)
      .post(`/v1/bookings/${bookingId}/accept`)
      .set('Authorization', `Bearer ${fixtures.lenderToken}`)
      .set('Idempotency-Key', 'ik-ext2-a');

    // Request extension (20,000 held)
    await request(app)
      .post(`/v1/bookings/${bookingId}/extensions`)
      .set('Authorization', `Bearer ${fixtures.borrowerToken}`)
      .set('Idempotency-Key', 'ik-ext2-r')
      .send({ requestedEndDate: '2026-12-13' });

    // Age startDate into past so pickup deadline has passed
    await Booking.updateOne({ _id: bookingId }, { $set: { startDate: '2026-01-01' } });

    // Run pickup expiry worker job
    const jobRes = await executeBookingExpiryJob();
    expect(jobRes.expiredPickupsCount).toBe(1);

    // Invariants check:
    const wallet = await Wallet.findOne({ userId: fixtures.borrower._id });
    expect(wallet.frozenPaise).toBe(0);
    expect(wallet.availablePaise).toBe(500000);

    const locks = await ItemDayLock.find({ bookingId });
    expect(locks.length).toBe(0);

    const entries = await LedgerEntry.find();
    const sum = entries.reduce((acc, e) => acc + e.amountPaise, 0);
    expect(sum).toBe(0);
  });

  it('3. accept extension then cancel: refunds entire hold including accepted extension rent (ledger sum 0, 0 frozen, 0 orphan locks)', async () => {
    const fixtures = await createBookingFixtures({
      borrowerFundsPaise: 500000,
      rentPerDayPaise: 10000,
      depositPaise: 20000,
    });

    const createRes = await request(app)
      .post('/v1/bookings')
      .set('Authorization', `Bearer ${fixtures.borrowerToken}`)
      .set('Idempotency-Key', 'ik-ext3-c')
      .send({
        itemId: fixtures.item._id.toString(),
        startDate: '2026-12-10',
        endDate: '2026-12-11', // 2 days: 20k rent + 20k deposit = 40k held
      });
    const bookingId = createRes.body.booking._id;

    await request(app)
      .post(`/v1/bookings/${bookingId}/accept`)
      .set('Authorization', `Bearer ${fixtures.lenderToken}`)
      .set('Idempotency-Key', 'ik-ext3-a');

    // Request extension: extra 2 days = 20k extra rent held
    await request(app)
      .post(`/v1/bookings/${bookingId}/extensions`)
      .set('Authorization', `Bearer ${fixtures.borrowerToken}`)
      .set('Idempotency-Key', 'ik-ext3-r')
      .send({ requestedEndDate: '2026-12-13' });

    // Lender accepts extension
    const acceptExtRes = await request(app)
      .post(`/v1/bookings/${bookingId}/extensions/accept`)
      .set('Authorization', `Bearer ${fixtures.lenderToken}`)
      .set('Idempotency-Key', 'ik-ext3-acc');
    expect(acceptExtRes.status).toBe(200);

    // Booking has now 4 days total rent (40k) + deposit (20k) = 60k held
    let booking = await Booking.findById(bookingId);
    expect(booking.rentPaise).toBe(40000);
    expect(booking.days).toBe(4);

    // Cancel booking before pickup
    const cancelRes = await request(app)
      .post(`/v1/bookings/${bookingId}/cancel`)
      .set('Authorization', `Bearer ${fixtures.borrowerToken}`)
      .set('Idempotency-Key', 'ik-ext3-can')
      .send({ reason: 'Trip cancelled after extension accepted' });
    expect(cancelRes.status).toBe(200);

    // Invariants check:
    const wallet = await Wallet.findOne({ userId: fixtures.borrower._id });
    expect(wallet.frozenPaise).toBe(0);
    expect(wallet.availablePaise).toBe(500000);

    const locks = await ItemDayLock.find({ bookingId });
    expect(locks.length).toBe(0);

    const entries = await LedgerEntry.find();
    const sum = entries.reduce((acc, e) => acc + e.amountPaise, 0);
    expect(sum).toBe(0);
  });

  it('4. extension expiry run twice: unfreezes hold once, second run is idempotent with 0 duplicate refunds', async () => {
    const fixtures = await createBookingFixtures({
      borrowerFundsPaise: 500000,
      rentPerDayPaise: 10000,
      depositPaise: 20000,
    });

    const createRes = await request(app)
      .post('/v1/bookings')
      .set('Authorization', `Bearer ${fixtures.borrowerToken}`)
      .set('Idempotency-Key', 'ik-ext4-c')
      .send({
        itemId: fixtures.item._id.toString(),
        startDate: '2026-12-10',
        endDate: '2026-12-12',
      });
    const bookingId = createRes.body.booking._id;

    await request(app)
      .post(`/v1/bookings/${bookingId}/accept`)
      .set('Authorization', `Bearer ${fixtures.lenderToken}`)
      .set('Idempotency-Key', 'ik-ext4-a');

    // Request extension (20k held)
    await request(app)
      .post(`/v1/bookings/${bookingId}/extensions`)
      .set('Authorization', `Bearer ${fixtures.borrowerToken}`)
      .set('Idempotency-Key', 'ik-ext4-r')
      .send({ requestedEndDate: '2026-12-14' });

    // Age extension expiresAt into past
    await Booking.updateOne(
      { _id: bookingId, 'extensions.status': 'requested' },
      { $set: { 'extensions.$.expiresAt': new Date(Date.now() - 1000) } },
    );

    // Run extension expiry first time
    const run1 = await executeBookingExpiryJob();
    expect(run1.expiredExtensionsCount).toBe(1);

    let wallet = await Wallet.findOne({ userId: fixtures.borrower._id });
    expect(wallet.frozenPaise).toBe(50000); // Only initial 30k rent + 20k deposit remain frozen

    // Run extension expiry second time immediately
    const run2 = await executeBookingExpiryJob();
    expect(run2.expiredExtensionsCount).toBe(0);

    // Invariants check: wallet unchanged, ledger sum strictly 0
    wallet = await Wallet.findOne({ userId: fixtures.borrower._id });
    expect(wallet.frozenPaise).toBe(50000);

    const entries = await LedgerEntry.find();
    const sum = entries.reduce((acc, e) => acc + e.amountPaise, 0);
    expect(sum).toBe(0);
  });
});
