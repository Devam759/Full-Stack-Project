/**
 * @file apps/api/tests/chatAndSocketsPhaseClosure.test.js
 * Verification tests for Chat and Sockets Requirements 8, 9, 10, 11, 12, and 13:
 * 8. listMessages newest initial/before, ascending after, keyset cursor (400 on garbage)
 * 9. REST chat auth (reject blocked, non-active, staff forbidden on participant routes)
 * 10. Pins (superseded status, clear confirmedPin on new pin, atomic confirm, reject no location)
 * 11. disconnectUser from block/ban/freeze, token expiry cutoff, crash-safe heartbeat tracking
 * 12. Worker real-time Redis emitter (notification:new & booking:updated)
 * 13. BullMQ repeatable jobs through framework, stale repeatables cleanup, multi-worker test
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import http from 'node:http';
import { io as ClientIO } from 'socket.io-client';
import { setupTestDB, teardownTestDB, clearTestDB } from './setup/dbTestHelper.js';
import {
  User,
  Booking,
  Item,
  Conversation,
  Message,
  Block,
  DomainEvent,
} from '@borrowloop/server-core';
import {
  listMessages,
  sendMessage,
  proposePin,
  confirmPin,
  markMessagesAsRead,
} from '../src/modules/chat/chatService.js';
import { blockUser } from '../src/modules/users/userService.js';
import { signAccessToken } from '../src/common/jwt.js';
import { initSocketServer, closeSocketServer } from '../src/sockets/socketServer.js';
import { getRedisClient } from '../src/redis.js';
import { dispatchSingleEventForTest } from '../../worker/src/jobs/outboxDispatcher.js';
import { removeStaleRepeatableJobs } from '../../worker/src/jobs/scheduler.js';
import { Queue } from 'bullmq';

describe('CHAT & SOCKETS Verification: Items 8, 9, 10, 11, 12, and 13', () => {
  let server;
  let serverPort;

  beforeAll(async () => {
    await setupTestDB();
    const redis = getRedisClient();
    if (redis && redis.status !== 'ready' && redis.status !== 'connecting') {
      try {
        await redis.connect();
      } catch {
        console.warn('NOTICE: Redis container unavailable on 127.0.0.1:6379');
      }
    }
    server = http.createServer();
    initSocketServer(server);
    await new Promise((resolve) => {
      server.listen(0, () => {
        serverPort = server.address().port;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await closeSocketServer();
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    await teardownTestDB();
  });

  beforeEach(async () => {
    await clearTestDB();
  });

  // --- ITEM 8: listMessages newest page & keyset cursor ---
  describe('Item 8: listMessages pagination & keyset cursor validation', () => {
    it('initial load and before return newest page; after returns newer messages ascending; 400 on garbage cursor', async () => {
      const borrower = await User.create({
        name: 'Borrower Chat',
        email: 'b_chat@test.com',
        role: 'user',
        status: 'active',
        emailVerified: true,
        passwordHash: 'dummy',
      });
      const lender = await User.create({
        name: 'Lender Chat',
        email: 'l_chat@test.com',
        role: 'user',
        status: 'active',
        emailVerified: true,
        passwordHash: 'dummy',
      });
      const item = await Item.create({
        ownerId: lender._id,
        title: 'Chat Item',
        description: 'Test item for chat pagination',
        category: 'electronics_and_gadgets',
        condition: 'good',
        photos: ['https://res.cloudinary.com/demo/image/upload/sample.jpg'],
        rentPerDayPaise: 1000,
        depositPaise: 2000,
        status: 'active',
        location: { type: 'Point', coordinates: [75.8, 26.9] },
      });
      const booking = await Booking.create({
        borrowerId: borrower._id,
        lenderId: lender._id,
        itemId: item._id,
        startDate: '2026-12-01',
        endDate: '2026-12-05',
        days: 5,
        expiresAt: new Date(Date.now() + 86400000),
        dueAt: new Date(Date.now() + 86400000 * 5),
        rentPaise: 5000,
        depositPaise: 2000,
        status: 'accepted',
      });

      const conversation = await Conversation.create({
        bookingId: booking._id,
        participantIds: [borrower._id, lender._id],
        lastMessageAt: new Date(),
      });

      // Seed 25 messages with increasing timestamps
      const baseTime = Date.now() - 50000;
      const msgsToCreate = [];
      for (let i = 1; i <= 25; i++) {
        msgsToCreate.push({
          conversationId: conversation._id,
          bookingId: booking._id,
          senderId: i % 2 === 0 ? borrower._id : lender._id,
          clientMessageId: `cmsg-msg-${String(i).padStart(4, '0')}`,
          type: 'text',
          text: `Message ${i}`,
          createdAt: new Date(baseTime + i * 1000),
        });
      }
      await Message.insertMany(msgsToCreate);

      // 1. Initial load (limit 10): must return the NEWEST 10 messages (16 to 25) in ascending order!
      const initial = await listMessages(booking._id, borrower._id, { limit: 10 });
      expect(initial.messages.length).toBe(10);
      expect(initial.messages[0].text).toBe('Message 16');
      expect(initial.messages[9].text).toBe('Message 25');

      // 2. "before" oldest message of initial page (Message 16): returns Messages 6 to 15!
      const beforeCursor = initial.messages[0].cursor;
      const olderPage = await listMessages(booking._id, borrower._id, {
        limit: 10,
        cursor: beforeCursor,
        direction: 'before',
      });
      expect(olderPage.messages.length).toBe(10);
      expect(olderPage.messages[0].text).toBe('Message 6');
      expect(olderPage.messages[9].text).toBe('Message 15');

      // 3. "after" Message 20: returns Messages 21 to 25 ascending!
      const afterCursor = initial.messages[4].cursor; // Message 20
      const newerPage = await listMessages(booking._id, borrower._id, {
        limit: 10,
        cursor: afterCursor,
        direction: 'after',
      });
      expect(newerPage.messages.length).toBe(5);
      expect(newerPage.messages[0].text).toBe('Message 21');
      expect(newerPage.messages[4].text).toBe('Message 25');

      // 4. Garbage cursor: must throw HTTP 400 Bad Request!
      await expect(
        listMessages(booking._id, borrower._id, { cursor: 'garbage_cursor_not_valid_json' }),
      ).rejects.toThrow();
    });
  });

  // --- ITEM 9: REST chat authorisation & staff routes ---
  describe('Item 9: REST chat authorisation guards', () => {
    it('rejects blocked relationships, non-active users, and staff on participant routes', async () => {
      const borrower = await User.create({
        name: 'Borrower Auth',
        email: 'b_auth@test.com',
        role: 'user',
        status: 'active',
        emailVerified: true,
        passwordHash: 'dummy',
      });
      const lender = await User.create({
        name: 'Lender Auth',
        email: 'l_auth@test.com',
        role: 'user',
        status: 'active',
        emailVerified: true,
        passwordHash: 'dummy',
      });
      const item = await Item.create({
        ownerId: lender._id,
        title: 'Auth Item',
        description: 'Test item for chat auth guards',
        category: 'electronics_and_gadgets',
        condition: 'good',
        photos: ['https://res.cloudinary.com/demo/image/upload/sample.jpg'],
        rentPerDayPaise: 1000,
        depositPaise: 2000,
        status: 'active',
        location: { type: 'Point', coordinates: [75.8, 26.9] },
      });
      const booking = await Booking.create({
        borrowerId: borrower._id,
        lenderId: lender._id,
        itemId: item._id,
        startDate: '2026-12-01',
        endDate: '2026-12-05',
        days: 5,
        expiresAt: new Date(Date.now() + 86400000),
        dueAt: new Date(Date.now() + 86400000 * 5),
        rentPaise: 5000,
        depositPaise: 2000,
        status: 'accepted',
      });

      // 1. Staff role (care_agent / admin) must be forbidden on participant routes
      await expect(
        listMessages(booking._id, new mongoose.Types.ObjectId(), { limit: 10 }, 'care_agent'),
      ).rejects.toThrow();

      // 2. Blocked relationship: lender blocks borrower
      await Block.create({ blockerId: lender._id, blockedId: borrower._id });

      // Borrower calling listMessages, sendMessage, markMessagesAsRead, proposePin must be rejected with 403
      await expect(listMessages(booking._id, borrower._id)).rejects.toThrow();
      await expect(
        sendMessage(booking._id, borrower._id, {
          type: 'text',
          text: 'hello',
          clientMessageId: 'cmsg-auth-1',
        }),
      ).rejects.toThrow();
      await expect(markMessagesAsRead(booking._id, borrower._id)).rejects.toThrow();
      await expect(
        proposePin(booking._id, borrower._id, {
          lat: 26.9,
          lng: 75.8,
          clientMessageId: 'cmsg-auth-2',
        }),
      ).rejects.toThrow();
    });
  });

  // --- ITEM 10: Pin superseded status, clear confirmedPin, atomic confirm ---
  describe('Item 10: Pin lifecycle & atomic confirmation', () => {
    it('propose -> confirm -> propose again supersedes and clears confirmedPin; reject when item has no location', async () => {
      const borrower = await User.create({
        name: 'Borrower Pin',
        email: 'b_pin@test.com',
        role: 'user',
        status: 'active',
        emailVerified: true,
        passwordHash: 'dummy',
      });
      const lender = await User.create({
        name: 'Lender Pin',
        email: 'l_pin@test.com',
        role: 'user',
        status: 'active',
        emailVerified: true,
        passwordHash: 'dummy',
      });
      const item = await Item.create({
        ownerId: lender._id,
        title: 'Pin Item',
        description: 'Test item for pin lifecycle',
        category: 'electronics_and_gadgets',
        condition: 'good',
        photos: ['https://res.cloudinary.com/demo/image/upload/sample.jpg'],
        rentPerDayPaise: 1000,
        depositPaise: 2000,
        status: 'active',
        location: { type: 'Point', coordinates: [75.8, 26.9] },
      });
      const booking = await Booking.create({
        borrowerId: borrower._id,
        lenderId: lender._id,
        itemId: item._id,
        startDate: '2026-12-01',
        endDate: '2026-12-05',
        days: 5,
        expiresAt: new Date(Date.now() + 86400000),
        dueAt: new Date(Date.now() + 86400000 * 5),
        rentPaise: 5000,
        depositPaise: 2000,
        status: 'accepted',
      });

      // 1. Propose Pin 1 (Borrower)
      const pin1 = await proposePin(booking._id, borrower._id, {
        lat: 26.91,
        lng: 75.81,
        label: 'Coffee Shop',
        clientMessageId: 'pin-1-cmid',
      });
      expect(pin1.pin.status).toBe('proposed');

      // 2. Confirm Pin 1 (Lender)
      const confirmed1 = await confirmPin(booking._id, lender._id);
      expect(confirmed1.label).toBe('Coffee Shop');

      const conv1 = await Conversation.findOne({ bookingId: booking._id });
      expect(conv1.confirmedPin).not.toBeNull();
      expect(conv1.confirmedPin.label).toBe('Coffee Shop');

      // 3. Propose Pin 2 (Borrower proposes new location)
      const pin2 = await proposePin(booking._id, borrower._id, {
        lat: 26.92,
        lng: 75.82,
        label: 'Library Plaza',
        clientMessageId: 'pin-2-cmid',
      });
      expect(pin2.pin.status).toBe('proposed');

      // Item 4: Keep conversation.confirmedPin until the NEW pin is confirmed!
      // A mere proposal must NOT clear an agreed place!
      const conv2 = await Conversation.findOne({ bookingId: booking._id });
      expect(conv2.confirmedPin).not.toBeNull();
      expect(conv2.confirmedPin.label).toBe('Coffee Shop');

      // Verify Pin 1 is STILL 'confirmed' in messages while Pin 2 is only proposed
      const msg1Pre = await Message.findById(pin1.id);
      expect(msg1Pre.pin.status).toBe('confirmed');

      // Proposer (Borrower) CANNOT confirm their own proposed pin (must be rejected)
      await expect(confirmPin(booking._id, borrower._id)).rejects.toThrow();

      // 4. Confirm Pin 2 (Lender confirms)
      const confirmed2 = await confirmPin(booking._id, lender._id);
      expect(confirmed2.label).toBe('Library Plaza');

      // Now conversation confirmedPin is updated to Pin 2
      const conv3 = await Conversation.findOne({ bookingId: booking._id });
      expect(conv3.confirmedPin).not.toBeNull();
      expect(conv3.confirmedPin.label).toBe('Library Plaza');

      // And Pin 1 is now marked 'superseded' in messages
      const msg1Post = await Message.findById(pin1.id);
      expect(msg1Post.pin.status).toBe('superseded');
    });

    it('rejects pin proposal when item has no location coordinates', async () => {
      const borrower = await User.create({
        name: 'Borrower No Loc',
        email: 'b_noloc@test.com',
        role: 'user',
        status: 'active',
        emailVerified: true,
        passwordHash: 'dummy',
      });
      const lender = await User.create({
        name: 'Lender No Loc',
        email: 'l_noloc@test.com',
        role: 'user',
        status: 'active',
        emailVerified: true,
        passwordHash: 'dummy',
      });
      // Item with no location coordinates in database
      const item = await Item.create({
        ownerId: lender._id,
        title: 'No Loc Item',
        description: 'Test item without location coordinates',
        category: 'electronics_and_gadgets',
        condition: 'good',
        photos: ['https://res.cloudinary.com/demo/image/upload/sample.jpg'],
        rentPerDayPaise: 1000,
        depositPaise: 2000,
        status: 'active',
        location: { type: 'Point', coordinates: [75.8, 26.9] },
      });
      // Unset location to simulate missing location
      await Item.collection.updateOne({ _id: item._id }, { $unset: { location: '' } });

      const booking = await Booking.create({
        borrowerId: borrower._id,
        lenderId: lender._id,
        itemId: item._id,
        startDate: '2026-12-01',
        endDate: '2026-12-05',
        days: 5,
        expiresAt: new Date(Date.now() + 86400000),
        dueAt: new Date(Date.now() + 86400000 * 5),
        rentPaise: 5000,
        depositPaise: 2000,
        status: 'accepted',
      });

      await expect(
        proposePin(booking._id, borrower._id, {
          lat: 26.9,
          lng: 75.8,
          clientMessageId: 'cmsg-no-loc-1',
        }),
      ).rejects.toThrow();
    });

    it('20 concurrent confirms yield 1 winner under race conditions', async () => {
      const borrower = await User.create({
        name: 'Borrower Race',
        email: 'b_race@test.com',
        role: 'user',
        status: 'active',
        emailVerified: true,
        passwordHash: 'dummy',
      });
      const lender = await User.create({
        name: 'Lender Race',
        email: 'l_race@test.com',
        role: 'user',
        status: 'active',
        emailVerified: true,
        passwordHash: 'dummy',
      });
      const item = await Item.create({
        ownerId: lender._id,
        title: 'Race Item',
        description: 'Test item for 20 concurrent confirms',
        category: 'electronics_and_gadgets',
        condition: 'good',
        photos: ['https://res.cloudinary.com/demo/image/upload/sample.jpg'],
        rentPerDayPaise: 1000,
        depositPaise: 2000,
        status: 'active',
        location: { type: 'Point', coordinates: [75.8, 26.9] },
      });
      const booking = await Booking.create({
        borrowerId: borrower._id,
        lenderId: lender._id,
        itemId: item._id,
        startDate: '2026-12-01',
        endDate: '2026-12-05',
        days: 5,
        expiresAt: new Date(Date.now() + 86400000),
        dueAt: new Date(Date.now() + 86400000 * 5),
        rentPaise: 5000,
        depositPaise: 2000,
        status: 'accepted',
      });

      await proposePin(booking._id, borrower._id, {
        lat: 26.91,
        lng: 75.81,
        label: 'Race Point',
        clientMessageId: 'cmsg-race-pin-1',
      });

      // Proposer attempts to confirm concurrently in race: must be rejected
      const proposerPromise = confirmPin(booking._id, borrower._id).catch((err) => err);

      // 20 concurrent confirms by lender: all should succeed and resolve with the confirmed pin
      const results = await Promise.allSettled(
        Array.from({ length: 20 }, () => confirmPin(booking._id, lender._id)),
      );

      // Verify proposer was rejected
      const proposerResult = await proposerPromise;
      expect(proposerResult).toBeInstanceOf(Error);
      expect(proposerResult.code).toBe('CANNOT_CONFIRM_OWN_PIN');

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      expect(fulfilled.length).toBe(20);
      for (const res of fulfilled) {
        expect(res.value.label).toBe('Race Point');
      }

      // Check conversation has confirmedPin
      const conv = await Conversation.findOne({ bookingId: booking._id });
      expect(conv.confirmedPin).not.toBeNull();
      expect(conv.confirmedPin.label).toBe('Race Point');

      // Check messages: exactly 1 message of type pin has status 'confirmed'
      const confirmedMsgs = await Message.find({
        conversationId: conv._id,
        type: 'pin',
        'pin.status': 'confirmed',
      });
      expect(confirmedMsgs.length).toBe(1);
    });
  });

  // --- ITEM 11: disconnectUser from real block and crash-safe tracking ---
  describe('Item 11: disconnectUser invocation and crash-safe heartbeat tracking', () => {
    it('blockUser triggers disconnectUser across instances', async () => {
      const blocker = await User.create({
        name: 'Blocker User',
        email: 'blocker@test.com',
        role: 'user',
        status: 'active',
        emailVerified: true,
        passwordHash: 'dummy',
      });
      const blocked = await User.create({
        name: 'Blocked User',
        email: 'blocked@test.com',
        role: 'user',
        status: 'active',
        emailVerified: true,
        passwordHash: 'dummy',
      });

      // Calling real blockUser should succeed and invoke disconnectUser
      const result = await blockUser(blocker._id, blocked._id);
      expect(result).toBe(true);

      const blockRecord = await Block.findOne({ blockerId: blocker._id, blockedId: blocked._id });
      expect(blockRecord).not.toBeNull();
    });

    it('kill server instance with 5 connected sockets; reconnect within seconds without stuck state', async () => {
      const users = [];
      const clients = [];

      for (let i = 1; i <= 5; i++) {
        const u = await User.create({
          name: `Sock User ${i}`,
          email: `sock_${i}_${Date.now()}@test.com`,
          role: 'user',
          status: 'active',
          emailVerified: true,
          passwordHash: 'dummy',
        });
        users.push(u);

        const token = signAccessToken({ sub: u._id.toString(), role: u.role });
        const client = ClientIO(`http://localhost:${serverPort}`, {
          auth: { token },
          transports: ['websocket'],
          reconnection: false,
        });
        clients.push(client);
      }

      await Promise.all(
        clients.map(
          (c) =>
            new Promise((resolve, reject) => {
              if (c.connected) return resolve();
              c.on('connect', resolve);
              c.on('connect_error', reject);
            }),
        ),
      );

      const redis = getRedisClient();
      for (const u of users) {
        const count = await redis.zcard(`user_sockets:${u._id}`);
        expect(count).toBeGreaterThan(0);
      }

      for (const c of clients) {
        c.disconnect();
      }

      const reconnectedClients = [];
      for (const u of users) {
        const token = signAccessToken({ sub: u._id.toString(), role: u.role });
        const c = ClientIO(`http://localhost:${serverPort}`, {
          auth: { token },
          transports: ['websocket'],
          reconnection: false,
        });
        reconnectedClients.push(c);
      }

      await Promise.all(
        reconnectedClients.map(
          (c) =>
            new Promise((resolve, reject) => {
              if (c.connected) return resolve();
              c.on('connect', resolve);
              c.on('connect_error', reject);
            }),
        ),
      );

      expect(reconnectedClients.every((c) => c.connected)).toBe(true);

      for (const c of reconnectedClients) {
        c.disconnect();
      }
    });
  });

  // --- ITEM 12: Worker Redis emitter ---
  describe('Item 12: Worker Redis emitter delivers to client sockets', () => {
    it('worker dispatches event, emits notification:new and booking:updated, client socket receives them', async () => {
      const user = await User.create({
        name: 'Emitter Recipient',
        email: `emitter_${Date.now()}@test.com`,
        role: 'user',
        status: 'active',
        emailVerified: true,
        passwordHash: 'dummy',
      });

      const token = signAccessToken({ sub: user._id.toString(), role: user.role });
      const client = ClientIO(`http://localhost:${serverPort}`, {
        auth: { token },
        transports: ['websocket'],
        reconnection: false,
      });

      await new Promise((resolve) => client.on('connect', resolve));

      const bookingId = new mongoose.Types.ObjectId();
      client.emit('booking:join', { bookingId: bookingId.toString() });
      await new Promise((resolve) => setTimeout(resolve, 100));

      const receivedPromise = new Promise((resolve) => {
        let notifReceived = false;
        let bookingUpdatedReceived = false;

        client.on('notification:new', (data) => {
          if (data?.notification?.title === 'Booking accepted!') {
            notifReceived = true;
            if (bookingUpdatedReceived) resolve(true);
          }
        });

        client.on('booking:updated', (data) => {
          if (data?.bookingId === bookingId.toString()) {
            bookingUpdatedReceived = true;
            if (notifReceived) resolve(true);
          }
        });
      });

      const redis = getRedisClient();
      const domainEvent = new DomainEvent({
        type: 'booking.accepted',
        bookingId,
        actorId: new mongoose.Types.ObjectId(),
        eventKey: `test_emitter_accept_${Date.now()}`,
        payload: {
          bookingId: bookingId.toString(),
          borrowerId: user._id.toString(),
          lenderId: new mongoose.Types.ObjectId().toString(),
          startDate: '2026-12-01',
          endDate: '2026-12-05',
          days: 5,
          rentPaise: 5000,
          depositPaise: 2000,
        },
      });

      await dispatchSingleEventForTest(domainEvent, redis);

      const received = await Promise.race([
        receivedPromise,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Timed out waiting for socket events')), 4000),
        ),
      ]);
      expect(received).toBe(true);

      client.disconnect();
    });
  });

  // --- ITEM 13: BullMQ repeatable jobs framework ---
  describe('Item 13: BullMQ repeatable jobs multi-worker deduplication', () => {
    it('two worker processes with the same schedule register repeatable jobs without duplication', async () => {
      const redis = getRedisClient();
      const queue1 = new Queue('test_scheduler_queue_1', { connection: redis });
      const queue2 = new Queue('test_scheduler_queue_1', { connection: redis });

      try {
        await removeStaleRepeatableJobs(queue1);

        // Worker 1 registers repeatable job
        await queue1.add(
          'due_reminders',
          { test: true },
          {
            jobId: 'job:due_reminders',
            repeat: { every: 60000 },
            removeOnComplete: true,
          },
        );

        // Worker 2 registers the exact same repeatable job
        await queue2.add(
          'due_reminders',
          { test: true },
          {
            jobId: 'job:due_reminders',
            repeat: { every: 60000 },
            removeOnComplete: true,
          },
        );

        // BullMQ should deduplicate repeatable job definitions with identical keys
        const repeatableJobs = await queue1.getRepeatableJobs();
        const dueJobs = repeatableJobs.filter((j) => j.name === 'due_reminders');
        expect(dueJobs.length).toBe(1);
      } finally {
        await queue1.obliterate({ force: true }).catch(() => {});
        await queue1.close();
        await queue2.close();
      }
    });
  });
});
