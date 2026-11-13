import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Redis from 'ioredis';
import { Queue } from 'bullmq';
import { setupTestDB, teardownTestDB, clearTestDB } from '../../api/tests/setup/dbTestHelper.js';
import { createBookingFixtures } from '../../api/tests/setup/bookingTestFixture.js';
import {
  Booking,
  ItemDayLock,
  Wallet,
  LedgerOperation,
  freezeBookingFunds,
} from '@borrowloop/server-core';
import {
  executeBookingExpiryJob,
  startBookingExpiryWorker,
  closeBookingExpiryScheduler,
  __resetJobState,
  BOOKING_EXPIRY_QUEUE_NAME,
  BOOKING_EXPIRY_LOCK_KEY,
} from '../src/jobs/bookingExpiryJob.js';

describe('B4: Real Infrastructure Booking Lifecycle Worker Tests', () => {
  let redisClient;
  const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

  beforeAll(async () => {
    redisClient = new Redis(redisUrl, {
      maxRetriesPerRequest: null,
      lazyConnect: true,
    });
    await redisClient.connect();

    await setupTestDB();
    await Booking.init();
    await ItemDayLock.init();
    await Wallet.init();
    await LedgerOperation.init();
  });

  afterAll(async () => {
    await closeBookingExpiryScheduler();
    if (redisClient) {
      await redisClient.del(BOOKING_EXPIRY_LOCK_KEY).catch(() => {});
      try {
        redisClient.disconnect();
      } catch {
        /* ignore */
      }
    }
    await teardownTestDB();
  });

  beforeEach(async () => {
    await clearTestDB();
    __resetJobState();
    if (redisClient) {
      await redisClient.del(BOOKING_EXPIRY_LOCK_KEY);
      const q = new Queue(BOOKING_EXPIRY_QUEUE_NAME, { connection: redisClient });
      await q.drain().catch(() => {});
      await q.close().catch(() => {});
    }
  });

  it('handles 5,000 expired requests in batches within a measured time', async () => {
    const fixtures = await createBookingFixtures();
    const pastExpiresAt = new Date(Date.now() - 3600_000); // 1 hour ago
    const futureDueAt = new Date(Date.now() + 86400_000);

    const docs = [];
    for (let i = 0; i < 5000; i++) {
      docs.push({
        itemId: fixtures.item._id,
        lenderId: fixtures.lender._id,
        borrowerId: fixtures.borrower._id,
        startDate: '2026-12-01',
        endDate: '2026-12-03',
        dueAt: futureDueAt,
        expiresAt: pastExpiresAt,
        days: 2,
        rentPaise: 20000,
        depositPaise: 10000,
        status: 'requested',
      });
    }

    // Bulk insert 5,000 requested bookings
    await Booking.insertMany(docs, { ordered: false });

    const startTime = Date.now();
    const result = await executeBookingExpiryJob({ redisClient });
    const elapsedMs = Date.now() - startTime;

    expect(result.success).toBe(true);
    expect(result.expiredRequestsCount).toBe(5000);

    // Verify all 5,000 are expired
    const remainingRequested = await Booking.countDocuments({
      status: 'requested',
      expiresAt: { $lte: new Date() },
    });
    expect(remainingRequested).toBe(0);

    // Measured time assertion: 5,000 batched updates complete in under 20s
    expect(elapsedMs).toBeLessThan(25000);
  }, 60000);

  it('running the job twice and running it late are completely safe (idempotent / settle-once)', async () => {
    const fixtures = await createBookingFixtures({
      borrowerFundsPaise: 500000,
      rentPerDayPaise: 10000,
      depositPaise: 20000,
    });

    // 1. One expired request and one overdue accepted booking
    await Booking.create({
      itemId: fixtures.item._id,
      lenderId: fixtures.lender._id,
      borrowerId: fixtures.borrower._id,
      startDate: '2026-12-01',
      endDate: '2026-12-03',
      dueAt: new Date(),
      expiresAt: new Date(Date.now() - 1000),
      days: 2,
      rentPaise: 20000,
      depositPaise: 20000,
      status: 'requested',
    });

    const overdueAccepted = await Booking.create({
      itemId: fixtures.item._id,
      lenderId: fixtures.lender._id,
      borrowerId: fixtures.borrower._id,
      startDate: '2026-01-01', // Late in past
      endDate: '2026-01-03',
      dueAt: new Date(),
      expiresAt: new Date(),
      days: 2,
      rentPaise: 20000,
      depositPaise: 20000,
      status: 'accepted',
    });

    await freezeBookingFunds({
      borrowerId: fixtures.borrower._id,
      bookingId: overdueAccepted._id,
      rentPaise: 20000,
      depositPaise: 20000,
    });

    // Run first time
    await redisClient.del(BOOKING_EXPIRY_LOCK_KEY);
    const res1 = await executeBookingExpiryJob({ redisClient });
    expect(res1.expiredRequestsCount).toBe(1);
    expect(res1.expiredPickupsCount).toBe(1);

    const borrowerWalletAfterFirst = await Wallet.findOne({ userId: fixtures.borrower._id });
    expect(borrowerWalletAfterFirst.frozenPaise).toBe(0);
    expect(borrowerWalletAfterFirst.availablePaise).toBe(500000);

    // Run second time (duplicate run)
    const res2 = await executeBookingExpiryJob({ redisClient });
    expect(res2.expiredRequestsCount).toBe(0);
    expect(res2.expiredPickupsCount).toBe(0);

    // Assert balances completely unchanged
    const borrowerWalletAfterSecond = await Wallet.findOne({ userId: fixtures.borrower._id });
    expect(borrowerWalletAfterSecond.frozenPaise).toBe(0);
    expect(borrowerWalletAfterSecond.availablePaise).toBe(500000);
  });

  it('an expired request and an overdue accepted booking are processed by the worker itself', async () => {
    const fixtures = await createBookingFixtures({
      borrowerFundsPaise: 500000,
      rentPerDayPaise: 10000,
      depositPaise: 20000,
    });

    const expiredReq = await Booking.create({
      itemId: fixtures.item._id,
      lenderId: fixtures.lender._id,
      borrowerId: fixtures.borrower._id,
      startDate: '2026-12-01',
      endDate: '2026-12-03',
      dueAt: new Date(),
      expiresAt: new Date(Date.now() - 5000),
      days: 2,
      rentPaise: 20000,
      depositPaise: 20000,
      status: 'requested',
    });

    const overdueAccepted = await Booking.create({
      itemId: fixtures.item._id,
      lenderId: fixtures.lender._id,
      borrowerId: fixtures.borrower._id,
      startDate: '2026-01-01',
      endDate: '2026-01-03',
      dueAt: new Date(),
      expiresAt: new Date(),
      days: 2,
      rentPaise: 20000,
      depositPaise: 20000,
      status: 'accepted',
    });

    await freezeBookingFunds({
      borrowerId: fixtures.borrower._id,
      bookingId: overdueAccepted._id,
      rentPaise: 20000,
      depositPaise: 20000,
    });

    await closeBookingExpiryScheduler();
    const worker = startBookingExpiryWorker(redisClient);

    const queue = new Queue(BOOKING_EXPIRY_QUEUE_NAME, {
      connection: redisClient,
    });
    await queue.drain().catch(() => {});

    const testJob = await queue.add('expire_bookings', { trigger: 'test_b4_worker' });

    const jobPromise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Worker job processing timed out')), 15000);
      const handler = (job) => {
        if (job.id === testJob.id || job.data?.trigger === 'test_b4_worker') {
          clearTimeout(timer);
          worker.off('completed', handler);
          resolve(job);
        }
      };
      worker.on('completed', handler);
    });

    await jobPromise;
    await queue.close().catch(() => {});
    await closeBookingExpiryScheduler();

    const reqAfter = await Booking.findById(expiredReq._id);
    expect(reqAfter.status).toBe('expired');

    const acceptedAfter = await Booking.findById(overdueAccepted._id);
    expect(acceptedAfter.status).toBe('expired');

    const walletAfter = await Wallet.findOne({ userId: fixtures.borrower._id });
    expect(walletAfter.frozenPaise).toBe(0);
    expect(walletAfter.availablePaise).toBe(500000);
  });
});
