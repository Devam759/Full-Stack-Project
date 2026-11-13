import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import http from 'http';
import { io as Client } from 'socket.io-client';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import IORedis from 'ioredis';
import jwt from 'jsonwebtoken';
import config from '../src/config/index.js';
import { createApp } from '../src/app.js';
import { User, Conversation, Block, Booking, Message } from '@borrowloop/server-core';
import { signAccessToken } from '../src/common/jwt.js';
import {
  initSocketServer,
  closeSocketServer,
  disconnectUser,
} from '../src/sockets/socketServer.js';

describe('Socket.IO Real-Time & Redis Adapter Integration (Phase 6)', () => {
  let replSet;
  let redisClient;
  let httpServer;
  let serverPort;

  let activeUser;
  let frozenUser;
  let bannedUser;
  let outsiderUser;
  let activeToken;
  let frozenToken;
  let bannedToken;
  let outsiderToken;
  let expiredToken;
  let wrongAudienceToken;
  let conversation;
  let testBooking;

  beforeAll(async () => {
    const testUri = process.env.MONGODB_TEST_URI;
    if (testUri) {
      await mongoose.connect(testUri);
    } else {
      replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
      await mongoose.connect(replSet.getUri());
    }
    redisClient = new IORedis({ host: '127.0.0.1', port: 6379, maxRetriesPerRequest: null });

    const app = createApp();
    httpServer = http.createServer(app);
    initSocketServer(httpServer);

    await new Promise((resolve) => {
      httpServer.listen(0, () => {
        serverPort = httpServer.address().port;
        resolve();
      });
    });

    activeUser = await User.create({
      name: 'Socket User Active',
      email: 'socket_active@borrowloop.test',
      emailVerified: true,
      status: 'active',
      passwordHash: 'hash123',
    });

    frozenUser = await User.create({
      name: 'Socket User Frozen',
      email: 'socket_frozen@borrowloop.test',
      emailVerified: true,
      status: 'frozen',
      passwordHash: 'hash123',
    });

    bannedUser = await User.create({
      name: 'Socket User Banned',
      email: 'socket_banned@borrowloop.test',
      emailVerified: true,
      status: 'banned',
      passwordHash: 'hash123',
    });

    outsiderUser = await User.create({
      name: 'Socket User Outsider',
      email: 'socket_outsider@borrowloop.test',
      emailVerified: true,
      status: 'active',
      passwordHash: 'hash123',
    });

    activeToken = signAccessToken({ sub: activeUser._id.toString(), role: activeUser.role });
    frozenToken = signAccessToken({ sub: frozenUser._id.toString(), role: frozenUser.role });
    bannedToken = signAccessToken({ sub: bannedUser._id.toString(), role: bannedUser.role });
    outsiderToken = signAccessToken({ sub: outsiderUser._id.toString(), role: outsiderUser.role });

    // Expired Token
    expiredToken = jwt.sign(
      { sub: activeUser._id.toString(), role: 'user' },
      config.JWT_ACCESS_SECRET,
      { expiresIn: '-10s' },
    );

    // Wrong Audience Token
    wrongAudienceToken = jwt.sign(
      { sub: activeUser._id.toString(), role: 'user', aud: 'wrong-audience' },
      config.JWT_ACCESS_SECRET,
      { expiresIn: '15m' },
    );

    testBooking = await Booking.create({
      itemId: new mongoose.Types.ObjectId(),
      borrowerId: activeUser._id,
      lenderId: new mongoose.Types.ObjectId(),
      startDate: '2026-11-20',
      endDate: '2026-11-22',
      dueAt: new Date('2026-11-22T23:59:59+05:30'),
      expiresAt: new Date(Date.now() + 86400000),
      days: 2,
      rentPaise: 1000_00,
      depositPaise: 2000_00,
      status: 'requested',
    });

    conversation = await Conversation.create({
      bookingId: testBooking._id,
      participantIds: [activeUser._id, testBooking.lenderId],
    });
  });

  beforeEach(async () => {
    if (redisClient && redisClient.status === 'ready') {
      const keys = await redisClient.keys('user_sockets:*');
      if (keys.length > 0) await redisClient.del(...keys);
      const rlKeys = await redisClient.keys('rl:socket:*');
      if (rlKeys.length > 0) await redisClient.del(...rlKeys);
    }
  });

  afterAll(async () => {
    await closeSocketServer();
    if (httpServer) {
      await new Promise((resolve) => httpServer.close(resolve));
    }
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

  describe('Item 5: Socket Security & Authentication Tests', () => {
    it('refuses connection for no token', async () => {
      await new Promise((resolve) => {
        const client = Client(`http://localhost:${serverPort}`, {
          transports: ['websocket'],
          reconnection: false,
        });

        client.on('connect_error', (err) => {
          expect(err.message).toMatch(/Authentication token required|Authentication failed/);
          client.disconnect();
          resolve();
        });
      });
    });

    it('refuses connection for expired token', async () => {
      await new Promise((resolve) => {
        const client = Client(`http://localhost:${serverPort}`, {
          auth: { token: expiredToken },
          transports: ['websocket'],
          reconnection: false,
        });

        client.on('connect_error', (err) => {
          expect(err.message).toMatch(/Authentication token expired|Authentication failed/);
          client.disconnect();
          resolve();
        });
      });
    });

    it('refuses connection for wrong audience', async () => {
      const originalAud = config.JWT_AUDIENCE;
      config.JWT_AUDIENCE = 'borrowloop-api';
      try {
        await new Promise((resolve) => {
          const client = Client(`http://localhost:${serverPort}`, {
            auth: { token: wrongAudienceToken },
            transports: ['websocket'],
            reconnection: false,
          });

          client.on('connect_error', (err) => {
            expect(err.message).toMatch(/Invalid token audience|Authentication failed/);
            client.disconnect();
            resolve();
          });
        });
      } finally {
        config.JWT_AUDIENCE = originalAud;
      }
    });

    it('refuses connection for banned and frozen users', async () => {
      // Banned
      await new Promise((resolve) => {
        const client = Client(`http://localhost:${serverPort}`, {
          auth: { token: bannedToken },
          transports: ['websocket'],
          reconnection: false,
        });

        client.on('connect_error', (err) => {
          expect(err.message).toMatch(/Account is banned/);
          client.disconnect();
          resolve();
        });
      });

      // Frozen
      await new Promise((resolve) => {
        const client = Client(`http://localhost:${serverPort}`, {
          auth: { token: frozenToken },
          transports: ['websocket'],
          reconnection: false,
        });

        client.on('connect_error', (err) => {
          expect(err.message).toMatch(/Account is frozen/);
          client.disconnect();
          resolve();
        });
      });
    });

    it('refuses joining a conversation you are not a participant of', async () => {
      await new Promise((resolve) => {
        const client = Client(`http://localhost:${serverPort}`, {
          auth: { token: outsiderToken },
          transports: ['websocket'],
          reconnection: false,
        });

        client.on('connect', () => {
          client.emit(
            'conversation:join',
            { conversationId: conversation._id.toString() },
            (ack) => {
              expect(ack.status).toBe('error');
              expect(ack.error).toBe('FORBIDDEN_NOT_PARTICIPANT');
              client.disconnect();
              resolve();
            },
          );
        });
      });
    });

    it('refuses joining a conversation after being blocked', async () => {
      // Active user blocks testBooking.lenderId
      await Block.create({
        blockerId: conversation.participantIds[1],
        blockedId: activeUser._id,
      });

      await new Promise((resolve) => {
        const client = Client(`http://localhost:${serverPort}`, {
          auth: { token: activeToken },
          transports: ['websocket'],
          reconnection: false,
        });

        client.on('connect', () => {
          client.emit(
            'conversation:join',
            { conversationId: conversation._id.toString() },
            (ack) => {
              expect(ack.status).toBe('error');
              expect(ack.error).toBe('BLOCKED');
              client.disconnect();
              resolve();
            },
          );
        });
      });

      // Clean up block
      await Block.deleteMany({});
    });

    it('disconnects user immediately mid-session when banned or cut off', async () => {
      await new Promise((resolve) => {
        const client = Client(`http://localhost:${serverPort}`, {
          auth: { token: activeToken },
          transports: ['websocket'],
          reconnection: false,
        });

        client.on('connect', () => {
          // Mid-session cutoff triggered
          disconnectUser(activeUser._id.toString(), 'Account banned mid-session');
        });

        client.on('disconnect', (reason) => {
          expect(reason).toBeDefined();
          resolve();
        });
      });
    });

    it('proves messages are saved before emit: failing emit leaves message in DB; failing save emits nothing', async () => {
      const { sendMessage } = await import('../src/modules/chat/chatService.js');
      const socketServerModule = await import('../src/sockets/socketServer.js');

      // Side A: Failing save throws error before emit is called; nothing written, nothing emitted
      const clientMsgFailSave = `cmsg-fail-save-${Date.now()}`;
      const originalCreate = Message.create;
      Message.create = vi.fn().mockRejectedValue(new Error('Simulated DB disk failure'));

      await expect(
        sendMessage(testBooking._id, activeUser._id, {
          clientMessageId: clientMsgFailSave,
          type: 'text',
          text: 'Should never emit if DB save fails',
        }),
      ).rejects.toThrow('Simulated DB disk failure');

      Message.create = originalCreate;

      const failMsgCount = await Message.countDocuments({ clientMessageId: clientMsgFailSave });
      expect(failMsgCount).toBe(0);

      // Side B: Failing emit (e.g. Socket emission error) leaves message already persisted in DB
      const clientMsgFailEmit = `cmsg-fail-emit-${Date.now()}`;

      // Mock emitToConversation to simulate a failure AFTER message has been persisted
      const spyEmit = vi.spyOn(socketServerModule, 'emitToConversation').mockImplementation(() => {
        throw new Error('Simulated network emission failure');
      });

      try {
        await sendMessage(testBooking._id, activeUser._id, {
          clientMessageId: clientMsgFailEmit,
          type: 'text',
          text: 'Message was saved to database before emit failed',
        });
      } catch (err) {
        expect(err.message).toBe('Simulated network emission failure');
      } finally {
        spyEmit.mockRestore();
      }

      // Proves message exists in MongoDB despite emit failure!
      const savedDoc = await Message.findOne({ clientMessageId: clientMsgFailEmit });
      expect(savedDoc).not.toBeNull();
      expect(savedDoc.text).toBe('Message was saved to database before emit failed');
    });
  });

  describe('Item 4: Rate Limits, Connection Limits & Payload Guards', () => {
    it('enforces per-user socket connection limit (max 5 sockets)', async () => {
      const clients = [];
      const connectPromises = [];

      for (let i = 0; i < 5; i++) {
        connectPromises.push(
          new Promise((resolve) => {
            const client = Client(`http://localhost:${serverPort}`, {
              auth: { token: activeToken },
              transports: ['websocket'],
              reconnection: false,
            });
            client.on('connect', () => {
              clients.push(client);
              resolve();
            });
          }),
        );
      }

      await Promise.all(connectPromises);

      // 6th connection should be rejected with TOO_MANY_CONNECTIONS
      await new Promise((resolve) => {
        const excessClient = Client(`http://localhost:${serverPort}`, {
          auth: { token: activeToken },
          transports: ['websocket'],
          reconnection: false,
        });

        excessClient.on('connect_error', (err) => {
          expect(err.message).toMatch(/TOO_MANY_CONNECTIONS/);
          excessClient.disconnect();
          resolve();
        });
      });

      // Cleanup
      for (const c of clients) c.disconnect();
    });

    it('rejects oversized socket payloads exceeding 10KB limit', async () => {
      await new Promise((resolve) => {
        const client = Client(`http://localhost:${serverPort}`, {
          auth: { token: activeToken },
          transports: ['websocket'],
          reconnection: false,
        });

        client.on('connect', () => {
          const hugeText = 'x'.repeat(12 * 1024); // 12 KB
          client.emit(
            'message:send',
            {
              bookingId: testBooking._id.toString(),
              data: {
                clientMessageId: 'cmsg-huge-payload',
                type: 'text',
                text: hugeText,
              },
            },
            (ack) => {
              expect(ack.status).toBe('error');
              expect(ack.error).toBe('PAYLOAD_TOO_LARGE');
              client.disconnect();
              resolve();
            },
          );
        });
      });
    });

    it('validates per-event payload with Zod schema and returns structured acks', async () => {
      await new Promise((resolve) => {
        const client = Client(`http://localhost:${serverPort}`, {
          auth: { token: activeToken },
          transports: ['websocket'],
          reconnection: false,
        });

        client.on('connect', () => {
          // Invalid message (missing clientMessageId)
          client.emit(
            'message:send',
            {
              bookingId: testBooking._id.toString(),
              data: {
                type: 'text',
                text: 'No clientMessageId',
              },
            },
            (ack) => {
              expect(ack.status).toBe('error');
              client.disconnect();
              resolve();
            },
          );
        });
      });
    });
  });
});
