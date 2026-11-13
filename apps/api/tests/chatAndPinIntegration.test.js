import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { createApp } from '../src/app.js';
import { getRedisClient } from '../src/redis.js';
import {
  User,
  Item,
  Booking,
  Community,
  Membership,
  Wallet,
  Conversation,
} from '@borrowloop/server-core';
import { signAccessToken } from '../src/common/jwt.js';

describe('Chat and Map Pin Integration (Phase 6)', () => {
  let app;
  let replSet;
  let redisClient;

  let borrower;
  let lender;
  let outsider;
  let borrowerToken;
  let lenderToken;
  let outsiderToken;
  let item;
  let booking;

  beforeAll(async () => {
    const testUri = process.env.MONGODB_TEST_URI;
    if (testUri) {
      await mongoose.connect(testUri);
    } else {
      replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
      await mongoose.connect(replSet.getUri());
    }
    redisClient = getRedisClient();
    if (redisClient.status !== 'ready' && redisClient.status !== 'connecting') {
      await redisClient.connect().catch(() => {});
    }
    app = createApp();

    // Create users
    borrower = await User.create({
      name: 'Borrower Bob',
      email: 'bob@borrowloop.test',
      emailVerified: true,
      status: 'active',
      passwordHash: 'dummyhash123',
    });
    lender = await User.create({
      name: 'Lender Alice',
      email: 'alice@borrowloop.test',
      emailVerified: true,
      status: 'active',
      passwordHash: 'dummyhash123',
    });
    outsider = await User.create({
      name: 'Outsider Charlie',
      email: 'charlie@borrowloop.test',
      emailVerified: true,
      status: 'active',
      passwordHash: 'dummyhash123',
    });

    borrowerToken = signAccessToken({ sub: borrower._id.toString(), role: borrower.role });
    lenderToken = signAccessToken({ sub: lender._id.toString(), role: lender.role });
    outsiderToken = signAccessToken({ sub: outsider._id.toString(), role: outsider.role });

    // Create community & memberships
    const community = await Community.create({
      name: 'Central Campus Community',
      slug: 'central-campus',
      ownerId: lender._id,
      city: 'Bangalore',
      type: 'public',
      location: { type: 'Point', coordinates: [77.5946, 12.9716] }, // Bangalore
    });

    await Membership.create([
      { communityId: community._id, userId: borrower._id, role: 'member', status: 'active' },
      { communityId: community._id, userId: lender._id, role: 'owner', status: 'active' },
      { communityId: community._id, userId: outsider._id, role: 'member', status: 'active' },
    ]);

    // Create item
    item = await Item.create({
      ownerId: lender._id,
      title: 'Sony Alpha Camera',
      description: 'Professional Mirrorless Camera',
      category: 'electronics_and_gadgets',
      condition: 'good',
      photos: ['https://cdn.borrowloop.test/cam.jpg'],
      rentPerDayPaise: 500_00,
      depositPaise: 2000_00,
      minDays: 1,
      maxDays: 10,
      communityIds: [community._id],
      location: { type: 'Point', coordinates: [77.5946, 12.9716] },
      status: 'active',
    });

    // Create wallets
    await Wallet.create([
      { userId: borrower._id, availablePaise: 5000_00, frozenPaise: 0, pendingPaise: 0 },
      { userId: lender._id, availablePaise: 1000_00, frozenPaise: 0, pendingPaise: 0 },
    ]);

    // Create active booking
    booking = await Booking.create({
      itemId: item._id,
      borrowerId: borrower._id,
      lenderId: lender._id,
      startDate: '2026-11-20',
      endDate: '2026-11-22',
      dueAt: new Date('2026-11-22T23:59:59+05:30'),
      expiresAt: new Date(Date.now() + 86400000),
      days: 3,
      rentPaise: 1500_00,
      depositPaise: 2000_00,
      commissionBps: 1500,
      status: 'requested',
    });
  });

  beforeEach(async () => {
    if (redisClient && redisClient.status === 'ready') {
      const keys = await redisClient.keys('rl:chat:*');
      if (keys.length > 0) {
        await redisClient.del(...keys);
      }
    }
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

  describe('Authorization and Access Control', () => {
    it('allows borrower and lender to access messages, but rejects outsider with 403', async () => {
      // Borrower
      const bobRes = await request(app)
        .get(`/v1/bookings/${booking._id}/messages`)
        .set('Authorization', `Bearer ${borrowerToken}`);
      expect(bobRes.status).toBe(200);
      expect(Array.isArray(bobRes.body.messages)).toBe(true);

      // Lender
      const aliceRes = await request(app)
        .get(`/v1/bookings/${booking._id}/messages`)
        .set('Authorization', `Bearer ${lenderToken}`);
      expect(aliceRes.status).toBe(200);

      // Outsider
      const outsiderRes = await request(app)
        .get(`/v1/bookings/${booking._id}/messages`)
        .set('Authorization', `Bearer ${outsiderToken}`);
      expect(outsiderRes.status).toBe(403);
      expect(outsiderRes.body.error.code).toBe('FORBIDDEN');
    });
  });

  describe('Sending and Reading Messages', () => {
    it('allows borrower to send a text message and sanitizes input', async () => {
      const res = await request(app)
        .post(`/v1/bookings/${booking._id}/messages`)
        .set('Authorization', `Bearer ${borrowerToken}`)
        .send({
          clientMessageId: 'cmsg-bob-initial-msg',
          type: 'text',
          text: '<script>alert("xss")</script>Hi Alice, can we meet near the metro?',
        });

      expect(res.status).toBe(201);
      expect(res.body.message.text).toBe('Hi Alice, can we meet near the metro?');
      expect(res.body.message.senderId).toBe(borrower._id.toString());
      expect(res.body.message.readBy).toContain(borrower._id.toString());
    });

    it('enforces chat message rate limit: 31st message returns 429', async () => {
      for (let i = 1; i <= 30; i++) {
        const r = await request(app)
          .post(`/v1/bookings/${booking._id}/messages`)
          .set('Authorization', `Bearer ${borrowerToken}`)
          .send({
            clientMessageId: `cmsg-rate-limit-${i}`,
            type: 'text',
            text: `Rate limit test message ${i}`,
          });
        expect(r.status).toBe(201);
      }

      const r31 = await request(app)
        .post(`/v1/bookings/${booking._id}/messages`)
        .set('Authorization', `Bearer ${borrowerToken}`)
        .send({
          clientMessageId: 'cmsg-rate-limit-31',
          type: 'text',
          text: 'Rate limit test message 31',
        });
      expect(r31.status).toBe(429);
      expect(r31.body.error.code).toBe('RATE_LIMITED');
    });

    it('allows marking messages as read', async () => {
      // Bob reads messages
      const res = await request(app)
        .post(`/v1/bookings/${booking._id}/messages/read`)
        .set('Authorization', `Bearer ${lenderToken}`)
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.markedCount).toBeGreaterThanOrEqual(1);

      // Verify readBy contains lender ID
      const listRes = await request(app)
        .get(`/v1/bookings/${booking._id}/messages`)
        .set('Authorization', `Bearer ${borrowerToken}`);
      const latestMsg = listRes.body.messages[listRes.body.messages.length - 1];
      expect(latestMsg.readBy).toContain(lender._id.toString());
    });
  });

  describe('Map Pin Propose and Confirm Flow', () => {
    it('rejects pin proposal located > 50km from item location', async () => {
      // Mysore coordinates (140 km from Bangalore)
      const res = await request(app)
        .post(`/v1/bookings/${booking._id}/messages`)
        .set('Authorization', `Bearer ${borrowerToken}`)
        .send({
          clientMessageId: 'cmsg-pin-mysore-1234',
          type: 'pin',
          pin: {
            lat: 12.2958,
            lng: 76.6394,
            label: 'Mysore Palace Gate',
          },
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('PIN_OUT_OF_BOUNDS');
    });

    it('allows proposing pin within 50km from item location', async () => {
      // MG Road Bangalore (~2 km from item)
      const res = await request(app)
        .post(`/v1/bookings/${booking._id}/messages`)
        .set('Authorization', `Bearer ${borrowerToken}`)
        .send({
          clientMessageId: 'cmsg-pin-mgroad-1234',
          type: 'pin',
          pin: {
            lat: 12.9756,
            lng: 77.6066,
            label: 'MG Road Metro Station Exit A',
          },
        });

      expect(res.status).toBe(201);
      expect(res.body.message.type).toBe('pin');
      expect(res.body.message.pin.label).toBe('MG Road Metro Station Exit A');
      expect(res.body.message.pin.status).toBe('proposed');
    });

    it('prevents pin proposer from confirming own pin', async () => {
      // Bob proposed, Bob tries to confirm -> 403
      const res = await request(app)
        .post(`/v1/bookings/${booking._id}/pin/confirm`)
        .set('Authorization', `Bearer ${borrowerToken}`)
        .send({});

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('CANNOT_CONFIRM_OWN_PIN');
    });

    it('allows other party (lender) to confirm proposed pin', async () => {
      // Alice confirms
      const res = await request(app)
        .post(`/v1/bookings/${booking._id}/pin/confirm`)
        .set('Authorization', `Bearer ${lenderToken}`)
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.confirmedPin.label).toBe('MG Road Metro Station Exit A');
      expect(res.body.confirmedPin.confirmedBy).toBe(lender._id.toString());
      expect(res.body.confirmedPin.proposedBy).toBe(borrower._id.toString());

      // Conversation should now have confirmedPin
      const conv = await Conversation.findOne({ bookingId: booking._id });
      expect(conv.confirmedPin.label).toBe('MG Road Metro Station Exit A');
    });

    it('is idempotent when re-confirming already confirmed pin', async () => {
      const res = await request(app)
        .post(`/v1/bookings/${booking._id}/pin/confirm`)
        .set('Authorization', `Bearer ${lenderToken}`)
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.confirmedPin.label).toBe('MG Road Metro Station Exit A');
    });
  });

  describe('Terminal Booking State Chat Restrictions', () => {
    it('verifies chat send allowed or refused across all booking statuses', async () => {
      const allowedStatuses = ['requested', 'accepted', 'picked_up'];
      const terminalStatuses = ['completed', 'cancelled', 'expired'];

      for (const status of allowedStatuses) {
        const testBooking = await Booking.create({
          itemId: item._id,
          borrowerId: borrower._id,
          lenderId: lender._id,
          startDate: '2026-11-25',
          endDate: '2026-11-26',
          dueAt: new Date('2026-11-26T23:59:59+05:30'),
          expiresAt: new Date(Date.now() + 86400000),
          days: 2,
          rentPaise: 1000_00,
          depositPaise: 2000_00,
          status,
        });

        const res = await request(app)
          .post(`/v1/bookings/${testBooking._id}/messages`)
          .set('Authorization', `Bearer ${borrowerToken}`)
          .send({
            clientMessageId: `cmsg-status-${status}-${Date.now()}`,
            type: 'text',
            text: `Message in status ${status}`,
          });

        expect(res.status, `Status ${status} should allow sending messages`).toBe(201);
      }

      for (const status of terminalStatuses) {
        const testBooking = await Booking.create({
          itemId: item._id,
          borrowerId: borrower._id,
          lenderId: lender._id,
          startDate: '2026-11-25',
          endDate: '2026-11-26',
          dueAt: new Date('2026-11-26T23:59:59+05:30'),
          expiresAt: new Date(Date.now() + 86400000),
          days: 2,
          rentPaise: 1000_00,
          depositPaise: 2000_00,
          status,
        });

        const res = await request(app)
          .post(`/v1/bookings/${testBooking._id}/messages`)
          .set('Authorization', `Bearer ${borrowerToken}`)
          .send({
            clientMessageId: `cmsg-terminal-${status}-${Date.now()}`,
            type: 'text',
            text: `Message in terminal ${status}`,
          });

        expect(res.status, `Status ${status} should refuse sending messages`).toBe(409);
        expect(res.body.error.code).toBe('BOOKING_TERMINAL_CHAT_CLOSED');

        // History still readable
        const getRes = await request(app)
          .get(`/v1/bookings/${testBooking._id}/messages`)
          .set('Authorization', `Bearer ${borrowerToken}`);
        expect(getRes.status).toBe(200);
      }
    });

    it('runs send racing with cancel 20 times without inconsistency', async () => {
      for (let i = 0; i < 20; i++) {
        if (redisClient && redisClient.status === 'ready') {
          await redisClient.del(`rl:chat:msg:${borrower._id}`);
        }

        const raceBooking = await Booking.create({
          itemId: item._id,
          borrowerId: borrower._id,
          lenderId: lender._id,
          startDate: '2026-11-28',
          endDate: '2026-11-30',
          dueAt: new Date('2026-11-30T23:59:59+05:30'),
          expiresAt: new Date(Date.now() + 86400000),
          days: 3,
          rentPaise: 1500_00,
          depositPaise: 2000_00,
          status: 'requested',
        });

        const sendPromise = request(app)
          .post(`/v1/bookings/${raceBooking._id}/messages`)
          .set('Authorization', `Bearer ${borrowerToken}`)
          .send({
            clientMessageId: `cmsg-race-${i}-${Date.now()}`,
            type: 'text',
            text: `Racing send ${i}`,
          });

        const cancelPromise = request(app)
          .post(`/v1/bookings/${raceBooking._id}/cancel`)
          .set('Authorization', `Bearer ${borrowerToken}`)
          .set('Idempotency-Key', `idem-race-cancel-${i}-${Date.now()}`)
          .send({ reason: 'Changed mind' });

        const [sendRes, cancelRes] = await Promise.all([sendPromise, cancelPromise]);

        expect([200, 204]).toContain(cancelRes.status);
        expect([201, 409]).toContain(sendRes.status);

        // After cancel completes, chat is strictly read-only
        const postCancelSend = await request(app)
          .post(`/v1/bookings/${raceBooking._id}/messages`)
          .set('Authorization', `Bearer ${borrowerToken}`)
          .send({
            clientMessageId: `cmsg-post-race-${i}`,
            type: 'text',
            text: 'Should be rejected',
          });
        expect(postCancelSend.status).toBe(409);
        expect(postCancelSend.body.error.code).toBe('BOOKING_TERMINAL_CHAT_CLOSED');
      }
    });
  });

  describe('Item 3: clientMessageId and Unique Index Guarantees', () => {
    it('verifies unique index on (conversationId, senderId, clientMessageId) via listIndexes', async () => {
      const { Message } = await import('@borrowloop/server-core');
      const indexes = await Message.collection.listIndexes().toArray();
      const clientMsgIndex = indexes.find(
        (idx) =>
          idx.key.conversationId === 1 && idx.key.senderId === 1 && idx.key.clientMessageId === 1,
      );

      expect(clientMsgIndex).toBeDefined();
      expect(clientMsgIndex.unique).toBe(true);
    });

    it('handles same clientMessageId twice and 20 concurrent sends creating exactly one message', async () => {
      const { Message } = await import('@borrowloop/server-core');
      if (redisClient && redisClient.status === 'ready') {
        await redisClient.del(`rl:chat:msg:${borrower._id}`);
      }
      const clientMessageId = `cmsg-concurrent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      // 20 concurrent sends with identical clientMessageId
      const sends = Array.from({ length: 20 }, () =>
        request(app)
          .post(`/v1/bookings/${booking._id}/messages`)
          .set('Authorization', `Bearer ${borrowerToken}`)
          .send({
            clientMessageId,
            type: 'text',
            text: 'Concurrent idempotent message test',
          }),
      );

      const responses = await Promise.all(sends);
      for (const res of responses) {
        expect(res.status).toBe(201);
        expect(res.body.message.clientMessageId).toBe(clientMessageId);
      }

      // Proves exactly ONE message document was created in MongoDB
      const docCount = await Message.countDocuments({
        bookingId: booking._id,
        senderId: borrower._id,
        clientMessageId,
      });
      expect(docCount).toBe(1);

      // Sending with a DIFFERENT clientMessageId creates a second message
      const differentClientId = `cmsg-different-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const resDiff = await request(app)
        .post(`/v1/bookings/${booking._id}/messages`)
        .set('Authorization', `Bearer ${borrowerToken}`)
        .send({
          clientMessageId: differentClientId,
          type: 'text',
          text: 'Second distinct message',
        });

      expect(resDiff.status).toBe(201);
      expect(resDiff.body.message.clientMessageId).toBe(differentClientId);

      const totalDocs = await Message.countDocuments({
        bookingId: booking._id,
        senderId: borrower._id,
        clientMessageId: { $in: [clientMessageId, differentClientId] },
      });
      expect(totalDocs).toBe(2);
    });
  });
});
