import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { setupTestDB, teardownTestDB, clearTestDB } from './setup/dbTestHelper.js';
import { createBookingFixtures } from './setup/bookingTestFixture.js';
import User from '../src/models/User.js';
import Booking from '../src/models/Booking.js';
import { listBookings } from '../src/modules/bookings/bookingService.js';

describe('Bug A1: listBookings Cross-User Leak Reproduction', () => {
  beforeAll(async () => {
    await setupTestDB();
    await Booking.init();
  });

  afterAll(async () => {
    await teardownTestDB();
  });

  beforeEach(async () => {
    await clearTestDB();
  });

  it('fails prior to fix: page 2 of listBookings leaks other users bookings when role is omitted', async () => {
    const fixtures = await createBookingFixtures({ borrowerFundsPaise: 500000 });
    const userA = fixtures.borrower;

    const userB = await User.create({
      name: 'User B',
      email: `user_b_${Date.now()}@test.com`,
      emailVerified: true,
      status: 'active',
      passwordHash: 'dummyhash',
    });

    const now = Date.now();
    // Create 25 bookings for user A
    for (let i = 0; i < 25; i++) {
      await Booking.create({
        borrowerId: userA._id,
        lenderId: fixtures.lender._id,
        itemId: fixtures.item._id,
        startDate: '2026-12-01',
        endDate: '2026-12-02',
        dueAt: new Date(now + 86400000),
        expiresAt: new Date(now + 86400000),
        days: 1,
        rentPaise: 1000,
        depositPaise: 500,
        status: 'requested',
        createdAt: new Date(now - i * 1000),
      });
    }

    // Create 25 bookings for user B (interleaved timestamps)
    for (let i = 0; i < 25; i++) {
      await Booking.create({
        borrowerId: userB._id,
        lenderId: fixtures.lender._id,
        itemId: fixtures.item._id,
        startDate: '2026-12-01',
        endDate: '2026-12-02',
        dueAt: new Date(now + 86400000),
        expiresAt: new Date(now + 86400000),
        days: 1,
        rentPaise: 1000,
        depositPaise: 500,
        status: 'requested',
        createdAt: new Date(now - i * 1000 - 500),
      });
    }

    // Page 1 for User A (limit 10, role omitted)
    const page1 = await listBookings({ userId: userA._id, limit: 10 });
    expect(page1.items.length).toBe(10);
    expect(page1.nextCursor).toBeTruthy();

    // Page 2 for User A using cursor (role omitted)
    const page2 = await listBookings({
      userId: userA._id,
      limit: 10,
      cursor: page1.nextCursor,
    });

    // Every item in page 2 MUST belong to User A (as borrower or lender)
    for (const item of page2.items) {
      const isParticipant =
        item.borrowerId?._id?.toString() === userA._id.toString() ||
        item.borrowerId?.toString() === userA._id.toString() ||
        item.lenderId?._id?.toString() === userA._id.toString() ||
        item.lenderId?.toString() === userA._id.toString();
      expect(isParticipant).toBe(true);
    }
  });

  it('rejects invalid cursor with 400', async () => {
    const fixtures = await createBookingFixtures();
    await expect(
      listBookings({
        userId: fixtures.borrower._id,
        cursor: 'invalid-not-base64-json',
      }),
    ).rejects.toThrowError();
  });
});
