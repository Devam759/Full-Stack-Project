import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { setupTestDB, teardownTestDB, clearTestDB } from './setup/dbTestHelper.js';
import { createBookingFixtures } from './setup/bookingTestFixture.js';
import app from '../src/app.js';
import Booking from '../src/models/Booking.js';
import Wallet from '../src/models/Wallet.js';
import ItemDayLock from '../src/models/ItemDayLock.js';
import LedgerEntry from '../src/models/LedgerEntry.js';
import LedgerOperation from '../src/models/LedgerOperation.js';

describe('Booking Funds & Escrow Hold', () => {
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

  it('verifies request creates with no money moved, and accept successfully freezes escrow hold', async () => {
    // rentPerDay: 50,000 (₹500), deposit: 100,000 (₹1,000), total for 3 days = 150,000 + 100,000 = 250,000 paise (₹2,500)
    const fixtures = await createBookingFixtures({
      borrowerFundsPaise: 500000,
      rentPerDayPaise: 50000,
      depositPaise: 100000,
    });

    const createRes = await request(app)
      .post('/v1/bookings')
      .set('Authorization', `Bearer ${fixtures.borrowerToken}`)
      .set('Idempotency-Key', 'ik-funds-create-1')
      .send({
        itemId: fixtures.item._id.toString(),
        startDate: '2026-11-20',
        endDate: '2026-11-22',
      });

    expect(createRes.status).toBe(201);
    const booking = createRes.body.booking;
    expect(booking.status).toBe('requested');
    expect(booking.rentPaise).toBe(150000);
    expect(booking.depositPaise).toBe(100000);
    expect(booking.rentPaise + booking.depositPaise).toBe(250000);

    // Verify wallet before accept: still untouched
    let bWallet = await Wallet.findOne({ userId: fixtures.borrower._id });
    expect(bWallet.availablePaise).toBe(500000);
    expect(bWallet.frozenPaise).toBe(0);

    // Lender accepts
    const acceptRes = await request(app)
      .post(`/v1/bookings/${booking._id}/accept`)
      .set('Authorization', `Bearer ${fixtures.lenderToken}`)
      .set('Idempotency-Key', 'ik-funds-accept-1');

    expect(acceptRes.status).toBe(200);
    expect(acceptRes.body.booking.status).toBe('accepted');

    // Verify wallet after accept: funds frozen
    bWallet = await Wallet.findOne({ userId: fixtures.borrower._id });
    expect(bWallet.availablePaise).toBe(250000);
    expect(bWallet.frozenPaise).toBe(250000);

    // Verify LedgerEntries
    const holdEntries = await LedgerEntry.find({
      userId: fixtures.borrower._id,
      type: 'booking_hold',
    });
    expect(holdEntries.length).toBe(2);
    const availableEntry = holdEntries.find((e) => e.account === 'available');
    const frozenEntry = holdEntries.find((e) => e.account === 'frozen');
    expect(availableEntry.amountPaise).toBe(-250000);
    expect(availableEntry.balanceAfterPaise).toBe(250000);
    expect(frozenEntry.amountPaise).toBe(250000);
    expect(frozenEntry.balanceAfterPaise).toBe(250000);

    // Verify settle-once LedgerOperation exists
    const op = await LedgerOperation.findOne({
      bookingId: { $in: [booking._id, new mongoose.Types.ObjectId(booking._id)] },
      operationType: 'booking_hold',
    });
    expect(op).toBeDefined();
    expect(op.opRef).toBe('default');

    // Verify 3 day locks created
    const locks = await ItemDayLock.find({ bookingId: booking._id });
    expect(locks.length).toBe(3);
    const lockedDays = locks.map((l) => l.day).sort();
    expect(lockedDays).toEqual(['2026-11-20', '2026-11-21', '2026-11-22']);
  });

  it('rejects accept if borrower balance became insufficient after request was created', async () => {
    // Total hold required: 250,000 paise. Borrower has 300,000 initially.
    const fixtures = await createBookingFixtures({
      borrowerFundsPaise: 300000,
      rentPerDayPaise: 50000,
      depositPaise: 100000,
    });

    const createRes = await request(app)
      .post('/v1/bookings')
      .set('Authorization', `Bearer ${fixtures.borrowerToken}`)
      .set('Idempotency-Key', 'ik-insufficient-create')
      .send({
        itemId: fixtures.item._id.toString(),
        startDate: '2026-11-20',
        endDate: '2026-11-22',
      });
    expect(createRes.status).toBe(201);
    const bookingId = createRes.body.booking._id;

    // Borrower drains their wallet by withdrawing ₹1,000 (100,000 paise) so balance drops to 200,000 < 250,000
    const withdrawRes = await request(app)
      .post('/v1/wallet/withdraw')
      .set('Authorization', `Bearer ${fixtures.borrowerToken}`)
      .set('Idempotency-Key', 'ik-insufficient-drain')
      .send({ amountPaise: 100000 });
    expect(withdrawRes.status).toBe(200);

    // Now lender attempts to accept
    const acceptRes = await request(app)
      .post(`/v1/bookings/${bookingId}/accept`)
      .set('Authorization', `Bearer ${fixtures.lenderToken}`)
      .set('Idempotency-Key', 'ik-insufficient-accept');

    expect(acceptRes.status).toBe(409);
    expect(acceptRes.body.error.code).toBe('INSUFFICIENT_FUNDS');

    // Verify booking status remains 'requested'
    const booking = await Booking.findById(bookingId);
    expect(booking.status).toBe('requested');

    // Verify NO day locks exist
    const locks = await ItemDayLock.find({ bookingId });
    expect(locks.length).toBe(0);

    // Verify borrower wallet has not been modified by failed accept
    const bWallet = await Wallet.findOne({ userId: fixtures.borrower._id });
    expect(bWallet.availablePaise).toBe(200000);
    expect(bWallet.frozenPaise).toBe(0);
  });
});
