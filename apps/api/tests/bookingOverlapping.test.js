import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { setupTestDB, teardownTestDB, clearTestDB } from './setup/dbTestHelper.js';
import { createBookingFixtures } from './setup/bookingTestFixture.js';
import app from '../src/app.js';
import Booking from '../src/models/Booking.js';
import Wallet from '../src/models/Wallet.js';
import ItemDayLock from '../src/models/ItemDayLock.js';
import User from '../src/models/User.js';
import Membership from '../src/models/Membership.js';
import LedgerEntry from '../src/models/LedgerEntry.js';
import { signAccessToken } from '../src/common/jwt.js';

describe('Suite 5: Auto-Rejection of Overlapping Pending Requests', () => {
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

  it('accepting a booking auto-rejects pending overlapping requests while leaving non-overlapping requests untouched', async () => {
    const fixtures = await createBookingFixtures({
      borrowerFundsPaise: 500000,
      rentPerDayPaise: 50000,
      depositPaise: 100000,
    });

    // Helper to create an extra borrower
    async function createBorrower(num) {
      const u = await User.create({
        name: `Borrower ${num}`,
        email: `borrower_${num}@test.com`,
        emailVerified: true,
        status: 'active',
        passwordHash: 'dummyhash',
      });
      await Membership.create({
        communityId: fixtures.community._id,
        userId: u._id,
        role: 'member',
        status: 'active',
      });
      await Wallet.create({
        userId: u._id,
        availablePaise: 500000,
        frozenPaise: 0,
        pendingPaise: 0,
      });
      await LedgerEntry.create([
        {
          txnId: new User()._id,
          userId: u._id,
          account: 'available',
          amountPaise: 500000,
          balanceAfterPaise: 500000,
          type: 'deposit_funds',
          idempotencyKey: `init_funding_b_${num}`,
        },
        {
          txnId: new User()._id,
          userId: null,
          account: 'demo_funding',
          amountPaise: -500000,
          type: 'deposit_funds',
          idempotencyKey: `init_funding_demo_${num}`,
        },
      ]);
      const token = signAccessToken({ sub: u._id.toString(), role: 'user' });
      return { user: u, token };
    }

    const b2 = await createBorrower(2);
    const b3 = await createBorrower(3);
    const b4 = await createBorrower(4);

    // Request 1: 2026-12-05 to 2026-12-08 (Winner)
    const req1 = await request(app)
      .post('/v1/bookings')
      .set('Authorization', `Bearer ${fixtures.borrowerToken}`)
      .set('Idempotency-Key', 'ik-over-req-1')
      .send({
        itemId: fixtures.item._id.toString(),
        startDate: '2026-12-05',
        endDate: '2026-12-08',
      });
    expect(req1.status).toBe(201);
    const booking1Id = req1.body.booking._id;

    // Request 2: 2026-12-07 to 2026-12-10 (Overlaps on Dec 7, 8)
    const req2 = await request(app)
      .post('/v1/bookings')
      .set('Authorization', `Bearer ${b2.token}`)
      .set('Idempotency-Key', 'ik-over-req-2')
      .send({
        itemId: fixtures.item._id.toString(),
        startDate: '2026-12-07',
        endDate: '2026-12-10',
      });
    expect(req2.status).toBe(201);
    const booking2Id = req2.body.booking._id;

    // Request 3: 2026-12-04 to 2026-12-06 (Overlaps on Dec 5, 6)
    const req3 = await request(app)
      .post('/v1/bookings')
      .set('Authorization', `Bearer ${b3.token}`)
      .set('Idempotency-Key', 'ik-over-req-3')
      .send({
        itemId: fixtures.item._id.toString(),
        startDate: '2026-12-04',
        endDate: '2026-12-06',
      });
    expect(req3.status).toBe(201);
    const booking3Id = req3.body.booking._id;

    // Request 4: 2026-12-15 to 2026-12-18 (Non-overlapping! Later dates)
    const req4 = await request(app)
      .post('/v1/bookings')
      .set('Authorization', `Bearer ${b4.token}`)
      .set('Idempotency-Key', 'ik-over-req-4')
      .send({
        itemId: fixtures.item._id.toString(),
        startDate: '2026-12-15',
        endDate: '2026-12-18',
      });
    expect(req4.status).toBe(201);
    const booking4Id = req4.body.booking._id;

    // Lender accepts Request 1
    const acceptRes = await request(app)
      .post(`/v1/bookings/${booking1Id}/accept`)
      .set('Authorization', `Bearer ${fixtures.lenderToken}`)
      .set('Idempotency-Key', 'ik-over-accept-1');
    expect(acceptRes.status).toBe(200);

    // Verify Request 1 is accepted
    const b1 = await Booking.findById(booking1Id);
    expect(b1.status).toBe('accepted');

    // Verify Request 2 was auto-rejected
    const b2Doc = await Booking.findById(booking2Id);
    expect(b2Doc.status).toBe('cancelled');
    expect(b2Doc.cancelReason).toContain('Overlapping booking was accepted');
    const b2LastEntry = b2Doc.statusHistory[b2Doc.statusHistory.length - 1];
    expect(b2LastEntry.actorRole).toBe('system');

    // Verify Request 3 was auto-rejected
    const b3Doc = await Booking.findById(booking3Id);
    expect(b3Doc.status).toBe('cancelled');
    expect(b3Doc.cancelReason).toContain('Overlapping booking was accepted');

    // Verify Request 4 is UNTOUCHED and still 'requested'
    const b4Doc = await Booking.findById(booking4Id);
    expect(b4Doc.status).toBe('requested');

    // Verify zero funds frozen for auto-rejected borrowers
    const w2 = await Wallet.findOne({ userId: b2.user._id });
    expect(w2.frozenPaise).toBe(0);
    expect(w2.availablePaise).toBe(500000);

    const w3 = await Wallet.findOne({ userId: b3.user._id });
    expect(w3.frozenPaise).toBe(0);
    expect(w3.availablePaise).toBe(500000);
  });
});
