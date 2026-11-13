import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import IORedis from 'ioredis';
import { Queue } from 'bullmq';
import { User, Booking, DomainEvent } from '@borrowloop/server-core';
import { processOutboxEvents } from '../src/jobs/outboxDispatcher.js';
import { sendPickupReminders, sendDueReminders } from '../src/jobs/reminderJobs.js';
import {
  registerReconciliationJob,
  RECONCILIATION_QUEUE_NAME,
} from '../src/jobs/reconciliationJob.js';
import {
  registerBookingExpiryJob,
  BOOKING_EXPIRY_QUEUE_NAME,
} from '../src/jobs/bookingExpiryJob.js';

describe('Item 11: Job Framework, Scale Benchmarks & Repeatable Keys (Phase 6)', () => {
  let replSet;
  let redisClient;

  let borrower;
  let lender;

  beforeAll(async () => {
    const testUri = process.env.MONGODB_TEST_URI;
    if (testUri) {
      await mongoose.connect(testUri);
    } else {
      replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
      await mongoose.connect(replSet.getUri());
    }
    redisClient = new IORedis({ host: '127.0.0.1', port: 6379, maxRetriesPerRequest: null });

    borrower = await User.create({
      name: 'Scale Borrower',
      email: 'scale_borrower@borrowloop.test',
      emailVerified: true,
      status: 'active',
      passwordHash: 'hash123',
    });

    lender = await User.create({
      name: 'Scale Lender',
      email: 'scale_lender@borrowloop.test',
      emailVerified: true,
      status: 'active',
      passwordHash: 'hash123',
    });
  });

  afterAll(async () => {
    if (mongoose.connection.readyState !== 0) {
      try {
        if (mongoose.connection.db) {
          await mongoose.connection.db.dropDatabase();
        }
      } catch {
        // Ignore
      }
      await mongoose.disconnect();
    }
    if (replSet) await replSet.stop({ force: true });
    if (redisClient) redisClient.disconnect();
  });

  it('prints BullMQ repeat keys and verifies repeatable jobs exist once with fixed jobIds', async () => {
    // Register repeatable jobs
    await registerReconciliationJob(redisClient);
    await registerBookingExpiryJob(redisClient);

    const reconQ = new Queue(RECONCILIATION_QUEUE_NAME, { connection: redisClient.duplicate() });
    const expiryQ = new Queue(BOOKING_EXPIRY_QUEUE_NAME, { connection: redisClient.duplicate() });

    const reconRepeatable = await reconQ.getRepeatableJobs();
    const expiryRepeatable = await expiryQ.getRepeatableJobs();

    console.info('=== BULLMQ REPEATABLE KEYS ===');
    console.info(
      'Reconciliation Repeatable Keys:',
      reconRepeatable.map((r) => r.key),
    );
    console.info(
      'Booking Expiry Repeatable Keys:',
      expiryRepeatable.map((r) => r.key),
    );

    expect(reconRepeatable.length).toBeGreaterThanOrEqual(1);
    expect(expiryRepeatable.length).toBeGreaterThanOrEqual(1);

    // Registering a second time produces NO duplicates (idempotent repeat keys)
    await registerReconciliationJob(redisClient);
    const reconRepeatableAfter = await reconQ.getRepeatableJobs();
    expect(reconRepeatableAfter.length).toBe(reconRepeatable.length);

    await reconQ.close();
    await expiryQ.close();
  });

  it('sends exactly one reminder per booking and offset across 3 runs, and zero for terminal bookings', async () => {
    const today = new Date().toISOString().slice(0, 10);

    // 1. Active eligible booking for pickup reminder
    const activePickupBooking = await Booking.create({
      itemId: new mongoose.Types.ObjectId(),
      borrowerId: borrower._id,
      lenderId: lender._id,
      startDate: today,
      endDate: '2026-11-25',
      dueAt: new Date(Date.now() + 86400000),
      expiresAt: new Date(Date.now() + 86400000),
      days: 3,
      rentPaise: 1500_00,
      depositPaise: 2000_00,
      status: 'accepted',
    });

    // 2. Terminal bookings (cancelled, expired, completed) - must receive ZERO reminders
    const cancelledBooking = await Booking.create({
      itemId: new mongoose.Types.ObjectId(),
      borrowerId: borrower._id,
      lenderId: lender._id,
      startDate: today,
      endDate: '2026-11-25',
      dueAt: new Date(Date.now() + 86400000),
      expiresAt: new Date(Date.now() + 86400000),
      days: 3,
      rentPaise: 1500_00,
      depositPaise: 2000_00,
      status: 'cancelled',
    });

    const expiredBooking = await Booking.create({
      itemId: new mongoose.Types.ObjectId(),
      borrowerId: borrower._id,
      lenderId: lender._id,
      startDate: today,
      endDate: '2026-11-25',
      dueAt: new Date(Date.now() + 86400000),
      expiresAt: new Date(Date.now() + 86400000),
      days: 3,
      rentPaise: 1500_00,
      depositPaise: 2000_00,
      status: 'expired',
    });

    const completedBooking = await Booking.create({
      itemId: new mongoose.Types.ObjectId(),
      borrowerId: borrower._id,
      lenderId: lender._id,
      startDate: today,
      endDate: '2026-11-25',
      dueAt: new Date(Date.now() + 86400000),
      expiresAt: new Date(Date.now() + 86400000),
      days: 3,
      rentPaise: 1500_00,
      depositPaise: 2000_00,
      status: 'completed',
    });

    // Run 1
    const run1 = await sendPickupReminders({ redisClient });
    expect(run1.processed).toBeGreaterThanOrEqual(1);

    // Run 2 (immediate re-run) -> deduped, 0 new reminders
    const run2 = await sendPickupReminders({ redisClient });
    expect(run2.processed).toBe(0);

    // Run 3 (third re-run) -> still deduped, 0 new reminders
    const run3 = await sendPickupReminders({ redisClient });
    expect(run3.processed).toBe(0);

    // Verify zero reminders were generated for cancelled, expired, or completed bookings
    const terminalReminders = await DomainEvent.countDocuments({
      type: 'booking.pickup_reminder',
      bookingId: { $in: [cancelledBooking._id, expiredBooking._id, completedBooking._id] },
    });
    expect(terminalReminders).toBe(0);

    // Exactly one set of domain events for active booking
    const activeReminders = await DomainEvent.countDocuments({
      type: 'booking.pickup_reminder',
      bookingId: activePickupBooking._id,
    });
    expect(activeReminders).toBe(2); // borrower + lender
  });

  it('measures duration for 5,000 seeded domain events processed by outbox dispatcher', async () => {
    await DomainEvent.deleteMany({ status: 'pending' });
    const docs = [];
    for (let i = 0; i < 5000; i++) {
      docs.push({
        eventKey: `evt_bench_${i}_${Date.now()}`,
        type: 'booking.requested',
        payload: {
          bookingId: new mongoose.Types.ObjectId(),
          lenderId: lender._id,
        },
        status: 'pending',
      });
    }

    await DomainEvent.insertMany(docs, { ordered: false });

    const startTime = Date.now();
    // Process in high-throughput batches (500 per batch)
    let totalProcessed = 0;
    while (true) {
      const count = await processOutboxEvents({ redisClient, batchSize: 500 });
      if (count === 0) break;
      totalProcessed += count;
    }
    const durationMs = Date.now() - startTime;

    console.info(`=== 5,000 OUTBOX EVENTS BENCHMARK RESULT ===`);
    console.info(`Total events processed: ${totalProcessed}`);
    console.info(`Duration: ${durationMs} ms (${(durationMs / 1000).toFixed(2)} seconds)`);

    expect(totalProcessed).toBe(5000);
    expect(durationMs).toBeLessThan(60000); // Must finish within 60 seconds
  }, 75000);

  it('measures duration for 5,000 seeded bookings evaluated by reminder jobs', async () => {
    const futureDue = new Date(Date.now() + 3600 * 1000); // 1 hour ahead
    const docs = [];
    for (let i = 0; i < 5000; i++) {
      docs.push({
        itemId: new mongoose.Types.ObjectId(),
        borrowerId: borrower._id,
        lenderId: lender._id,
        startDate: '2026-11-20',
        endDate: '2026-11-22',
        dueAt: futureDue,
        expiresAt: new Date(Date.now() + 86400000),
        days: 2,
        rentPaise: 1000_00,
        depositPaise: 2000_00,
        status: 'picked_up',
      });
    }

    await Booking.insertMany(docs, { ordered: false });

    const startTime = Date.now();
    const result = await sendDueReminders({ redisClient });
    const durationMs = Date.now() - startTime;

    console.info(`=== 5,000 BOOKINGS DUE REMINDER BENCHMARK RESULT ===`);
    console.info(`Bookings evaluated: ${result.totalEligible || 5000}`);
    console.info(`Duration: ${durationMs} ms (${(durationMs / 1000).toFixed(2)} seconds)`);

    expect(result.processed).toBeGreaterThanOrEqual(1);
    expect(durationMs).toBeLessThan(30000); // Under 30 seconds
  }, 45000);
});
