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

describe('Suite 4: Overlapping Date Acceptance Race (Real Replica Set Concurrency)', () => {
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

  it('20 concurrent accept calls for overlapping dates on the same item: exactly 1 wins, zero duplicate locks, money conserved', async () => {
    const fixtures = await createBookingFixtures({
      borrowerFundsPaise: 500000,
      rentPerDayPaise: 40000,
      depositPaise: 100000,
    });

    const numBorrowers = 20;
    const bookingIds = [];
    const borrowerIds = [fixtures.borrower._id];

    // Create 19 additional distinct borrowers with funded wallets and memberships
    for (let i = 2; i <= numBorrowers; i++) {
      const u = await User.create({
        name: `Borrower ${i}`,
        email: `borrower_${i}_${Date.now()}@test.com`,
        emailVerified: true,
        status: 'active',
        passwordHash: 'dummyhash',
      });
      borrowerIds.push(u._id);

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
          idempotencyKey: `init_funding_b_${i}`,
        },
        {
          txnId: new User()._id,
          userId: null,
          account: 'demo_funding',
          amountPaise: -500000,
          type: 'deposit_funds',
          idempotencyKey: `init_funding_demo_${i}`,
        },
      ]);

      const token = signAccessToken({ sub: u._id.toString(), role: 'user' });

      // Create booking request for each borrower on overlapping dates
      const reqRes = await request(app)
        .post('/v1/bookings')
        .set('Authorization', `Bearer ${token}`)
        .set('Idempotency-Key', `ik-race-req-${i}`)
        .send({
          itemId: fixtures.item._id.toString(),
          startDate: '2026-12-01',
          endDate: '2026-12-05', // 5 days
        });

      expect(reqRes.status).toBe(201);
      bookingIds.push(reqRes.body.booking._id);
    }

    // First borrower also creates booking request
    const firstReq = await request(app)
      .post('/v1/bookings')
      .set('Authorization', `Bearer ${fixtures.borrowerToken}`)
      .set('Idempotency-Key', 'ik-race-req-1')
      .send({
        itemId: fixtures.item._id.toString(),
        startDate: '2026-12-01',
        endDate: '2026-12-05',
      });
    expect(firstReq.status).toBe(201);
    bookingIds.unshift(firstReq.body.booking._id);

    expect(bookingIds.length).toBe(20);

    // Concurrently fire 20 accept requests from the lender
    const acceptPromises = bookingIds.map((bId, idx) =>
      request(app)
        .post(`/v1/bookings/${bId}/accept`)
        .set('Authorization', `Bearer ${fixtures.lenderToken}`)
        .set('Idempotency-Key', `ik-race-accept-${idx}-${bId}`),
    );

    const results = await Promise.all(acceptPromises);

    // Tally successes (200) vs failures (409)
    const successes = results.filter((r) => r.status === 200);
    const conflicts = results.filter((r) => r.status === 409);

    expect(successes.length).toBe(1);
    expect(conflicts.length).toBe(19);

    const winningBookingId = successes[0].body.booking._id;

    // Verify exactly 5 day locks exist for this item
    const allLocks = await ItemDayLock.find({ itemId: fixtures.item._id });
    expect(allLocks.length).toBe(5);
    for (const lock of allLocks) {
      expect(lock.bookingId.toString()).toBe(winningBookingId.toString());
    }

    // Verify wallets: exactly 1 borrower has 300,000 paise frozen (5 days * 40,000 rent + 100,000 deposit = 300,000 paise)
    const winningBooking = await Booking.findById(winningBookingId);
    expect(winningBooking.status).toBe('accepted');

    const winningBorrowerWallet = await Wallet.findOne({ userId: winningBooking.borrowerId });
    expect(winningBorrowerWallet.availablePaise).toBe(200000);
    expect(winningBorrowerWallet.frozenPaise).toBe(300000);

    // Other 19 borrowers must have 0 frozen funds and full available balance
    const otherWallets = await Wallet.find({
      userId: {
        $in: borrowerIds.filter((id) => id.toString() !== winningBooking.borrowerId.toString()),
      },
    });
    expect(otherWallets.length).toBe(19);
    for (const w of otherWallets) {
      expect(w.frozenPaise).toBe(0);
      expect(w.availablePaise).toBe(500000);
    }
  }, 30000);
});
