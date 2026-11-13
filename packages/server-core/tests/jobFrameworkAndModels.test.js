import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import IORedis from 'ioredis';
import {
  Conversation,
  Message,
  Notification,
  DomainEvent,
  runWithRedisLock,
} from '../src/index.js';

describe('Server-Core Models and Job Framework (Phase 6)', () => {
  let replSet;
  let redisClient;

  beforeAll(async () => {
    const testUri = process.env.MONGODB_TEST_URI;
    if (testUri) {
      await mongoose.connect(testUri);
    } else {
      replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
      await mongoose.connect(replSet.getUri());
    }
    redisClient = new IORedis({ host: '127.0.0.1', port: 6379, maxRetriesPerRequest: null });
  });

  afterAll(async () => {
    if (mongoose.connection.readyState !== 0) {
      try {
        if (mongoose.connection.db) {
          await mongoose.connection.db.dropDatabase();
        }
      } catch {
        // Ignore drop error
      }
      await mongoose.disconnect();
    }
    if (replSet) await replSet.stop({ force: true });
    if (redisClient) redisClient.disconnect();
  });

  describe('Conversation and Message Models', () => {
    it('creates a conversation with participants and updates lastMessageAt', async () => {
      const bookingId = new mongoose.Types.ObjectId();
      const user1 = new mongoose.Types.ObjectId();
      const user2 = new mongoose.Types.ObjectId();

      const conv = await Conversation.create({
        bookingId,
        participantIds: [user1, user2],
      });

      expect(conv.bookingId.toString()).toBe(bookingId.toString());
      expect(conv.participantIds).toHaveLength(2);
      expect(conv.lastMessageAt).toBeInstanceOf(Date);
      expect(conv.confirmedPin).toBeNull();

      // Create a message in the conversation
      const msg = await Message.create({
        conversationId: conv._id,
        bookingId,
        senderId: user1,
        type: 'text',
        text: 'Hello from borrower',
        readBy: [user1],
      });

      expect(msg.text).toBe('Hello from borrower');
      expect(msg.type).toBe('text');
      expect(msg.readBy).toHaveLength(1);
      expect(msg.readBy[0].toString()).toBe(user1.toString());
    });

    it('creates and confirms a map pin in conversation', async () => {
      const bookingId = new mongoose.Types.ObjectId();
      const borrower = new mongoose.Types.ObjectId();
      const lender = new mongoose.Types.ObjectId();

      const conv = await Conversation.create({
        bookingId,
        participantIds: [borrower, lender],
      });

      const pinMsg = await Message.create({
        conversationId: conv._id,
        bookingId,
        senderId: borrower,
        type: 'pin',
        pin: {
          lat: 12.9716,
          lng: 77.5946,
          label: 'Metro Station Exit B',
          status: 'proposed',
        },
      });

      expect(pinMsg.pin.status).toBe('proposed');

      // Update conversation with confirmed pin
      conv.confirmedPin = {
        lat: pinMsg.pin.lat,
        lng: pinMsg.pin.lng,
        label: pinMsg.pin.label,
        proposedBy: borrower,
        confirmedBy: lender,
        confirmedAt: new Date(),
      };
      await conv.save();

      const fetched = await Conversation.findById(conv._id);
      expect(fetched.confirmedPin.label).toBe('Metro Station Exit B');
      expect(fetched.confirmedPin.confirmedBy.toString()).toBe(lender.toString());
    });
  });

  describe('Notification Model', () => {
    it('creates notification and enforces dedupeKey uniqueness', async () => {
      await Notification.syncIndexes();
      const userId = new mongoose.Types.ObjectId();
      const dedupeKey = `notif:test:${Date.now()}`;

      const notif1 = await Notification.create({
        userId,
        type: 'booking_accepted',
        title: 'Booking Accepted',
        body: 'Your booking has been accepted',
        link: '/bookings/123',
        dedupeKey,
      });

      expect(notif1.title).toBe('Booking Accepted');
      expect(notif1.readAt).toBeNull();

      // Duplicate dedupeKey should throw mongo duplicate key error (11000)
      await expect(
        Notification.create({
          userId,
          type: 'booking_accepted',
          title: 'Duplicate',
          body: 'Duplicate body',
          dedupeKey,
        }),
      ).rejects.toThrow();
    });
  });

  describe('DomainEvent Outbox Fields', () => {
    it('persists outbox status defaults and allows transitions', async () => {
      const eventKey = `evt:test:${Date.now()}`;
      const evt = await DomainEvent.create({
        eventKey,
        type: 'booking.requested',
        payload: { itemTitle: 'Camera' },
      });

      expect(evt.status).toBe('pending');
      expect(evt.retryCount).toBe(0);
      expect(evt.nextRetryAt).toBeNull();
      expect(evt.processedAt).toBeNull();

      // Update to processed
      evt.status = 'processed';
      evt.processedAt = new Date();
      await evt.save();

      const updated = await DomainEvent.findOne({ eventKey });
      expect(updated.status).toBe('processed');
      expect(updated.processedAt).toBeInstanceOf(Date);
    });
  });

  describe('Job Framework Distributed Lock', () => {
    it('executes job within Redis lock and prevents concurrent run with same lock', async () => {
      const lockName = `test_job_${Date.now()}`;
      let executedFirst = false;
      let executedSecond = false;

      const firstPromise = runWithRedisLock({
        name: lockName,
        lockTtlMs: 2000,
        redisClient,
        handler: async () => {
          executedFirst = true;
          // Hold lock for 200ms
          await new Promise((resolve) => setTimeout(resolve, 200));
          return 'first_done';
        },
      });

      // Try running second immediately while first holds lock
      const secondResult = await runWithRedisLock({
        name: lockName,
        lockTtlMs: 2000,
        redisClient,
        handler: async () => {
          executedSecond = true;
          return 'second_done';
        },
      });

      const firstResult = await firstPromise;
      expect(firstResult.success).toBe(true);
      expect(firstResult.result).toBe('first_done');
      expect(executedFirst).toBe(true);

      // Second run should be skipped because lock was held
      expect(secondResult.success).toBe(false);
      expect(secondResult.skipped).toBe(true);
      expect(executedSecond).toBe(false);
    });
  });
});
