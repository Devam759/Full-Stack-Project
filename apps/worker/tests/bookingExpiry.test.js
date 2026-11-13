import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Redis from 'ioredis';
import { Queue } from 'bullmq';
import { setupTestDB, teardownTestDB, clearTestDB } from '../../api/tests/setup/dbTestHelper.js';
import { createBookingFixtures } from '../../api/tests/setup/bookingTestFixture.js';
import {
  Booking,
  Wallet,
  ItemDayLock,
  LedgerOperation,
  getRecordedEvents,
  clearRecordedEvents,
  freezeBookingFunds,
} from '@borrowloop/server-core';
import {
  registerBookingExpiryJob,
  executeBookingExpiryJob,
  closeBookingExpiryScheduler,
  __resetJobState,
  BOOKING_EXPIRY_JOB_ID,
  BOOKING_EXPIRY_LOCK_KEY,
} from '../src/jobs/bookingExpiryJob.js';

describe('Suite 10: Worker Booking Expiry Job & Distributed Lock', () => {
  let redisClient;
  const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

  beforeAll(async () => {
    redisClient = new Redis(redisUrl, {
      maxRetriesPerRequest: null,
      connectTimeout: 3000,
      lazyConnect: true,
    });
    redisClient.on('error', () => {});
    await redisClient.connect().catch(() => {});

    await setupTestDB();
    await Booking.init();
    await ItemDayLock.init();
    await LedgerOperation.init();
  });

  afterAll(async () => {
    await closeBookingExpiryScheduler().catch(() => {});
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
    __resetJobState();
    await clearTestDB();
    clearRecordedEvents();
    if (redisClient) {
      await redisClient.del(BOOKING_EXPIRY_LOCK_KEY);
    }
  });

  it('registers the repeatable BullMQ job with fixed jobId', async () => {
    const reg = await registerBookingExpiryJob(redisClient, { skipWorker: true });
    expect(reg.jobId).toBe(BOOKING_EXPIRY_JOB_ID);
    expect(reg.queue).toBeInstanceOf(Queue);

    const repeatableJobs = await reg.queue.getRepeatableJobs();
    const found = repeatableJobs.find(
      (j) => j.name === 'expire_bookings' && j.pattern === reg.cron,
    );
    expect(found).toBeDefined();

    await reg.queue.close();
  });

  it('expires pending requests older than 24 hours (expiresAt <= now)', async () => {
    const fixtures = await createBookingFixtures();

    // 1. Booking with past expiresAt
    const expiredBooking = await Booking.create({
      itemId: fixtures.item._id,
      lenderId: fixtures.lender._id,
      borrowerId: fixtures.borrower._id,
      startDate: '2026-12-01',
      endDate: '2026-12-03',
      dueAt: new Date(),
      expiresAt: new Date(Date.now() - 1000), // In past
      days: 3,
      rentPaise: 150000,
      depositPaise: 100000,
      status: 'requested',
    });

    // 2. Fresh booking with future expiresAt
    const freshBooking = await Booking.create({
      itemId: fixtures.item._id,
      lenderId: fixtures.lender._id,
      borrowerId: fixtures.borrower._id,
      startDate: '2026-12-05',
      endDate: '2026-12-07',
      dueAt: new Date(),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      days: 3,
      rentPaise: 150000,
      depositPaise: 100000,
      status: 'requested',
    });

    const result = await executeBookingExpiryJob({ redisClient });
    expect(result.success).toBe(true);
    expect(result.expiredRequestsCount).toBe(1);

    const updatedExpired = await Booking.findById(expiredBooking._id);
    expect(updatedExpired.status).toBe('expired');
    expect(updatedExpired.statusHistory[updatedExpired.statusHistory.length - 1].actorRole).toBe(
      'system',
    );

    const updatedFresh = await Booking.findById(freshBooking._id);
    expect(updatedFresh.status).toBe('requested');

    const domainEvents = getRecordedEvents().filter((e) => e.eventName === 'booking.expired');
    expect(domainEvents.length).toBe(1);
    expect(domainEvents[0].payload.bookingId.toString()).toBe(expiredBooking._id.toString());
  });

  it('expires unpicked accepted bookings past the pickup deadline with full refund and no-show penalty', async () => {
    const fixtures = await createBookingFixtures({
      borrowerFundsPaise: 500000,
      rentPerDayPaise: 50000,
      depositPaise: 100000,
    });

    // Create an accepted booking whose start date has passed (e.g. yesterday)
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const dayAfter = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const booking = await Booking.create({
      itemId: fixtures.item._id,
      lenderId: fixtures.lender._id,
      borrowerId: fixtures.borrower._id,
      startDate: yesterday,
      endDate: dayAfter,
      dueAt: new Date(),
      expiresAt: new Date(),
      days: 3,
      rentPaise: 150000,
      depositPaise: 100000,
      status: 'accepted',
    });

    // Freeze borrower wallet funds
    await freezeBookingFunds({
      borrowerId: fixtures.borrower._id,
      bookingId: booking._id,
      rentPaise: 150000,
      depositPaise: 100000,
    });

    // Create day locks
    await ItemDayLock.create([
      { itemId: fixtures.item._id, day: yesterday, bookingId: booking._id },
      { itemId: fixtures.item._id, day: dayAfter, bookingId: booking._id },
    ]);

    let bWallet = await Wallet.findOne({ userId: fixtures.borrower._id });
    expect(bWallet.availablePaise).toBe(250000);
    expect(bWallet.frozenPaise).toBe(250000);

    // Run expiry job
    const result = await executeBookingExpiryJob({ redisClient });
    expect(result.success).toBe(true);
    expect(result.expiredPickupsCount).toBe(1);

    // 1. Status is expired
    const updated = await Booking.findById(booking._id);
    expect(updated.status).toBe('expired');

    // 2. Day locks deleted
    const locks = await ItemDayLock.find({ bookingId: booking._id });
    expect(locks.length).toBe(0);

    // 3. Full refund to borrower available balance
    bWallet = await Wallet.findOne({ userId: fixtures.borrower._id });
    expect(bWallet.availablePaise).toBe(500000);
    expect(bWallet.frozenPaise).toBe(0);

    // 4. No-show penalty emitted (-5)
    const penaltyEvents = getRecordedEvents().filter((e) => e.eventName === 'trust_score.penalty');
    expect(penaltyEvents.length).toBe(1);
    expect(penaltyEvents[0].payload.delta).toBe(-5);
    expect(penaltyEvents[0].payload.reason).toBe('no_show');
  });

  it('proves distributed Redis lock blocks concurrent execution by another worker', async () => {
    // Manually acquire lock token in Redis
    await redisClient.set(BOOKING_EXPIRY_LOCK_KEY, 'foreign-worker-token', 'PX', 10000);

    const result = await executeBookingExpiryJob({ redisClient });
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('DISTRIBUTED_LOCK_ACQUIRED_BY_OTHER_WORKER');
  });
});
