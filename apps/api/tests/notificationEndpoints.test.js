import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import IORedis from 'ioredis';
import { createApp } from '../src/app.js';
import { User, Notification } from '@borrowloop/server-core';
import { signAccessToken } from '../src/common/jwt.js';

describe('Notification Endpoints Integration (Phase 6)', () => {
  let app;
  let replSet;
  let redisClient;

  let userA;
  let userB;
  let tokenA;
  let tokenB;

  beforeAll(async () => {
    const testUri = process.env.MONGODB_TEST_URI;
    if (testUri) {
      await mongoose.connect(testUri);
    } else {
      replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
      await mongoose.connect(replSet.getUri());
    }
    redisClient = new IORedis({ host: '127.0.0.1', port: 6379, maxRetriesPerRequest: null });
    app = createApp();

    userA = await User.create({
      name: 'User Alpha',
      email: 'alpha@borrowloop.test',
      emailVerified: true,
      status: 'active',
      passwordHash: 'hash123',
    });

    userB = await User.create({
      name: 'User Beta',
      email: 'beta@borrowloop.test',
      emailVerified: true,
      status: 'active',
      passwordHash: 'hash123',
    });

    tokenA = signAccessToken({ sub: userA._id.toString(), role: userA.role });
    tokenB = signAccessToken({ sub: userB._id.toString(), role: userB.role });

    // Seed notifications for User A
    await Notification.create([
      {
        userId: userA._id,
        type: 'booking_requested',
        title: 'New Booking Request',
        body: 'Someone requested to borrow your item.',
        link: '/bookings/101',
        readAt: null,
        dedupeKey: `notif:req:101:${userA._id}`,
      },
      {
        userId: userA._id,
        type: 'booking_accepted',
        title: 'Booking Accepted',
        body: 'Your booking has been accepted.',
        link: '/bookings/102',
        readAt: new Date(),
        dedupeKey: `notif:acc:102:${userA._id}`,
      },
      {
        userId: userA._id,
        type: 'message_received',
        title: 'New Message',
        body: 'You received a new message.',
        link: '/bookings/103',
        readAt: null,
        dedupeKey: `notif:msg:103:${userA._id}`,
      },
    ]);

    // Seed notification for User B
    await Notification.create([
      {
        userId: userB._id,
        type: 'booking_requested',
        title: 'Beta Request',
        body: 'Beta item requested',
        link: '/bookings/201',
        readAt: null,
        dedupeKey: `notif:req:201:${userB._id}`,
      },
    ]);
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

  describe('Listing Notifications and Unread Count', () => {
    it('returns notifications for authenticated user with accurate unreadCount', async () => {
      const res = await request(app)
        .get('/v1/notifications')
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(200);
      expect(res.body.notifications).toHaveLength(3);
      expect(res.body.unreadCount).toBe(2);
    });

    it('filters by unreadOnly=true', async () => {
      const res = await request(app)
        .get('/v1/notifications?unreadOnly=true')
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(200);
      expect(res.body.notifications).toHaveLength(2);
      expect(res.body.notifications.every((n) => n.readAt === null)).toBe(true);
    });
  });

  describe('Marking Notifications as Read', () => {
    it('marks a single notification as read', async () => {
      const listRes = await request(app)
        .get('/v1/notifications?unreadOnly=true')
        .set('Authorization', `Bearer ${tokenA}`);
      const unreadNotifId = listRes.body.notifications[0].id;

      const res = await request(app)
        .post(`/v1/notifications/${unreadNotifId}/read`)
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(200);
      expect(res.body.notification.readAt).toBeDefined();

      // Unread count should now be 1
      const countRes = await request(app)
        .get('/v1/notifications')
        .set('Authorization', `Bearer ${tokenA}`);
      expect(countRes.body.unreadCount).toBe(1);
    });

    it('rejects marking another user notification as read with 404', async () => {
      const listRes = await request(app)
        .get('/v1/notifications')
        .set('Authorization', `Bearer ${tokenB}`);
      const betaNotifId = listRes.body.notifications[0].id;

      // User A tries to mark User B's notification
      const res = await request(app)
        .post(`/v1/notifications/${betaNotifId}/read`)
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOTIFICATION_NOT_FOUND');
    });

    it('marks all notifications read via read-all', async () => {
      const res = await request(app)
        .post('/v1/notifications/read-all')
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(200);
      expect(res.body.markedCount).toBe(1);

      // Unread count should now be 0
      const countRes = await request(app)
        .get('/v1/notifications')
        .set('Authorization', `Bearer ${tokenA}`);
      expect(countRes.body.unreadCount).toBe(0);
    });

    it('verifies 90-day TTL index exists on Notification.createdAt', async () => {
      await Notification.syncIndexes();
      const indexes = await Notification.collection.indexes();
      const ttlIndex = indexes.find(
        (idx) => idx.key.createdAt === 1 && idx.expireAfterSeconds !== undefined,
      );
      expect(ttlIndex).toBeDefined();
      expect(ttlIndex.expireAfterSeconds).toBe(90 * 86400);
    });
  });
});
