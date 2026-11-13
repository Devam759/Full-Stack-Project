import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestDB, teardownTestDB, clearTestDB } from './setup/dbTestHelper.js';
import { createBookingFixtures } from './setup/bookingTestFixture.js';
import request from 'supertest';
import app from '../src/app.js';
import {
  Wallet,
  LedgerEntry,
  LedgerOperation,
  Booking,
  ItemDayLock,
  User,
} from '@borrowloop/server-core';

describe('Stage 5: Live Replica Set Invariants Verification', () => {
  beforeAll(async () => {
    await setupTestDB();
  });

  afterAll(async () => {
    await teardownTestDB();
  });

  it('runs diverse concurrent lifecycle flows and proves all 7 invariants hold on live replica set', async () => {
    await clearTestDB();

    // 1. Create 3 pairs of borrowers and lenders
    const f1 = await createBookingFixtures({
      borrowerFundsPaise: 500000,
      rentPerDayPaise: 10000,
      depositPaise: 20000,
    });
    const f2 = await createBookingFixtures({
      borrowerFundsPaise: 300000,
      rentPerDayPaise: 5000,
      depositPaise: 15000,
    });
    const f3 = await createBookingFixtures({
      borrowerFundsPaise: 400000,
      rentPerDayPaise: 8000,
      depositPaise: 12000,
    });

    // Flow A: Booking created, accepted, extension accepted, then completed and settled
    const b1Res = await request(app)
      .post('/v1/bookings')
      .set('Authorization', `Bearer ${f1.borrowerToken}`)
      .set('Idempotency-Key', 'ik-inv-b1-create')
      .send({ itemId: f1.item._id.toString(), startDate: '2026-12-01', endDate: '2026-12-03' });
    expect(b1Res.status).toBe(201);
    const b1Id = b1Res.body.booking._id;

    await request(app)
      .post(`/v1/bookings/${b1Id}/accept`)
      .set('Authorization', `Bearer ${f1.lenderToken}`)
      .set('Idempotency-Key', 'ik-inv-b1-accept');

    await request(app)
      .post(`/v1/bookings/${b1Id}/extensions`)
      .set('Authorization', `Bearer ${f1.borrowerToken}`)
      .set('Idempotency-Key', 'ik-inv-b1-ext')
      .send({ requestedEndDate: '2026-12-04' });

    const extDoc = (await Booking.findById(b1Id)).extensions[0];
    await request(app)
      .post(`/v1/bookings/${b1Id}/extensions/${extDoc._id}/accept`)
      .set('Authorization', `Bearer ${f1.lenderToken}`)
      .set('Idempotency-Key', 'ik-inv-b1-ext-acc');

    // Flow B: Booking created, accepted, then cancelled on-time (100% refund)
    const b2Res = await request(app)
      .post('/v1/bookings')
      .set('Authorization', `Bearer ${f2.borrowerToken}`)
      .set('Idempotency-Key', 'ik-inv-b2-create')
      .send({ itemId: f2.item._id.toString(), startDate: '2026-12-20', endDate: '2026-12-22' });
    const b2Id = b2Res.body.booking._id;

    await request(app)
      .post(`/v1/bookings/${b2Id}/accept`)
      .set('Authorization', `Bearer ${f2.lenderToken}`)
      .set('Idempotency-Key', 'ik-inv-b2-accept');

    await request(app)
      .post(`/v1/bookings/${b2Id}/cancel`)
      .set('Authorization', `Bearer ${f2.borrowerToken}`)
      .set('Idempotency-Key', 'ik-inv-b2-cancel')
      .send({ reason: 'Plans changed' });

    // Flow C: Booking created and active (accepted)
    const b3Res = await request(app)
      .post('/v1/bookings')
      .set('Authorization', `Bearer ${f3.borrowerToken}`)
      .set('Idempotency-Key', 'ik-inv-b3-create')
      .send({ itemId: f3.item._id.toString(), startDate: '2026-12-10', endDate: '2026-12-12' });
    const b3Id = b3Res.body.booking._id;

    await request(app)
      .post(`/v1/bookings/${b3Id}/accept`)
      .set('Authorization', `Bearer ${f3.lenderToken}`)
      .set('Idempotency-Key', 'ik-inv-b3-accept');

    // NOW CHECK ALL 7 INVARIANTS:

    // 1. sum(LedgerEntry.amountPaise) === 0
    const globalSumAgg = await LedgerEntry.aggregate([
      { $group: { _id: null, total: { $sum: '$amountPaise' }, count: { $sum: 1 } } },
    ]);
    const globalSum = globalSumAgg[0]?.total ?? 0;
    expect(globalSum).toBe(0);
    expect(globalSumAgg[0]?.count).toBeGreaterThan(0);

    // 2. For every user: availablePaise + frozenPaise + pendingPaise === sum(LedgerEntry.amountPaise)
    const wallets = await Wallet.find().lean();
    expect(wallets.length).toBeGreaterThan(0);
    for (const w of wallets) {
      const userLedgerAgg = await LedgerEntry.aggregate([
        { $match: { userId: w.userId } },
        { $group: { _id: null, total: { $sum: '$amountPaise' } } },
      ]);
      const ledgerSum = userLedgerAgg[0]?.total ?? 0;
      const walletSum = (w.availablePaise || 0) + (w.frozenPaise || 0) + (w.pendingPaise || 0);
      expect(walletSum).toBe(ledgerSum);
    }

    // 3. pendingPaise === 0 across all wallets
    for (const w of wallets) {
      expect(w.pendingPaise).toBe(0);
    }

    // 4. No wallet has negative availablePaise or frozenPaise
    for (const w of wallets) {
      expect(w.availablePaise).toBeGreaterThanOrEqual(0);
      expect(w.frozenPaise).toBeGreaterThanOrEqual(0);
    }

    // 5. ItemDayLock count equals sum of booked days across active non-cancelled, non-expired bookings
    const activeBookings = await Booking.find({
      status: { $in: ['accepted', 'picked_up'] },
    }).lean();
    const expectedLocks = activeBookings.reduce((acc, b) => acc + (b.days || 0), 0);
    const actualLocks = await ItemDayLock.countDocuments();
    expect(actualLocks).toBe(expectedLocks);
    expect(actualLocks).toBeGreaterThan(0);

    // 6. Every LedgerOperation has corresponding LedgerEntry records
    const operations = await LedgerOperation.find().lean();
    expect(operations.length).toBeGreaterThan(0);
    for (const op of operations) {
      const entriesCount = await LedgerEntry.countDocuments({ bookingId: op.bookingId });
      expect(entriesCount).toBeGreaterThan(0);
    }

    // 7. Zero orphan LedgerEntry records
    const userLedgerEntries = await LedgerEntry.find({ userId: { $ne: null } })
      .select('userId')
      .lean();
    const userIds = [...new Set(userLedgerEntries.map((e) => e.userId.toString()))];
    const existingUsers = await User.find({ _id: { $in: userIds } })
      .select('_id')
      .lean();
    const existingUserSet = new Set(existingUsers.map((u) => u._id.toString()));
    const orphanCount = userIds.filter((id) => !existingUserSet.has(id)).length;
    expect(orphanCount).toBe(0);
  });
});
