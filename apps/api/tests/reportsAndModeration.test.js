import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { setupTestDB, teardownTestDB } from './setup/dbTestHelper.js';
import { createApp } from '../src/app.js';
import {
  User,
  Item,
  Booking,
  Message,
  Report,
  Notification,
  AuditLog,
} from '@borrowloop/server-core';
import { signAccessToken } from '../src/common/jwt.js';
import { BUSINESS_CONFIG } from '@borrowloop/shared';

const { TOKEN_AUDIENCES } = BUSINESS_CONFIG;

describe('Reports & Care Moderation (Sub-step 8e)', () => {
  let app;
  let user1;
  let user2;
  let user3;
  let ownerUser;
  let careAgent;
  let user1Token;
  let user2Token;
  let user3Token;
  let ownerToken;
  let careAgentToken;
  let testItem;
  let testMessage;

  beforeAll(async () => {
    await setupTestDB();
    await Promise.all([
      AuditLog.init().catch(() => {}),
      Report.init().catch(() => {}),
      Item.init().catch(() => {}),
      User.init().catch(() => {}),
      Notification.init().catch(() => {}),
    ]);
    app = createApp();

    user1 = await User.create({
      name: 'User One',
      email: 'user1_report@borrowloop.test',
      emailVerified: true,
      status: 'active',
      passwordHash: 'hash123',
    });

    user2 = await User.create({
      name: 'User Two',
      email: 'user2_report@borrowloop.test',
      emailVerified: true,
      status: 'active',
      passwordHash: 'hash123',
    });

    user3 = await User.create({
      name: 'User Three',
      email: 'user3_report@borrowloop.test',
      emailVerified: true,
      status: 'active',
      passwordHash: 'hash123',
    });

    ownerUser = await User.create({
      name: 'Owner User',
      email: 'owner_report@borrowloop.test',
      emailVerified: true,
      status: 'active',
      passwordHash: 'hash123',
    });

    careAgent = await User.create({
      name: 'Care Agent Mod',
      email: 'care_mod@borrowloop.test',
      emailVerified: true,
      role: 'care_agent',
      status: 'active',
      passwordHash: 'hash123',
    });

    user1Token = signAccessToken(
      { sub: user1._id.toString(), role: user1.role },
      TOKEN_AUDIENCES.USER,
    );
    user2Token = signAccessToken(
      { sub: user2._id.toString(), role: user2.role },
      TOKEN_AUDIENCES.USER,
    );
    user3Token = signAccessToken(
      { sub: user3._id.toString(), role: user3.role },
      TOKEN_AUDIENCES.USER,
    );
    ownerToken = signAccessToken(
      { sub: ownerUser._id.toString(), role: ownerUser.role },
      TOKEN_AUDIENCES.USER,
    );
    careAgentToken = signAccessToken(
      { sub: careAgent._id.toString(), role: careAgent.role },
      TOKEN_AUDIENCES.PORTAL,
    );

    testItem = await Item.create({
      ownerId: ownerUser._id,
      title: 'Bosch Rotary Hammer',
      description: 'Heavy duty rotary hammer drill in pristine condition',
      category: 'tools_and_diy',
      condition: 'good',
      photos: ['https://res.cloudinary.com/demo/image/upload/bosch.jpg'],
      rentPerDayPaise: 3000,
      depositPaise: 8000,
      location: {
        type: 'Point',
        coordinates: [77.5946, 12.9716],
        approximateAddress: 'Indiranagar, Bangalore',
      },
      status: 'active',
    });

    testMessage = await Message.create({
      conversationId: ownerUser._id,
      bookingId: ownerUser._id,
      senderId: ownerUser._id,
      recipientId: user1._id,
      type: 'text',
      text: 'Threatening chat message for moderation test',
    });
  });

  afterAll(async () => {
    await teardownTestDB();
  });

  describe('POST /v1/reports (User Report Submission)', () => {
    it('blocks users from reporting their own content', async () => {
      // 1. Report self
      const resSelf = await request(app)
        .post('/v1/reports')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          targetType: 'user',
          targetId: ownerUser._id.toString(),
          reason: 'harassment',
          details: 'Reporting myself should fail',
        });
      expect(resSelf.status).toBe(400);
      expect(resSelf.body.error.code).toBe('REPORT_NOT_ALLOWED');

      // 2. Report own item
      const resItem = await request(app)
        .post('/v1/reports')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          targetType: 'item',
          targetId: testItem._id.toString(),
          reason: 'misleading',
          details: 'Reporting own item should fail',
        });
      expect(resItem.status).toBe(400);
      expect(resItem.body.error.code).toBe('REPORT_NOT_ALLOWED');

      // 3. Report own message
      const resMsg = await request(app)
        .post('/v1/reports')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          targetType: 'message',
          targetId: testMessage._id.toString(),
          reason: 'threat',
          details: 'Reporting own message should fail',
        });
      expect(resMsg.status).toBe(400);
      expect(resMsg.body.error.code).toBe('REPORT_NOT_ALLOWED');
    });

    it('enforces single pending report per user per target', async () => {
      const res1 = await request(app)
        .post('/v1/reports')
        .set('Authorization', `Bearer ${user1Token}`)
        .send({
          targetType: 'user',
          targetId: ownerUser._id.toString(),
          reason: 'harassment',
          details: 'User 1 initial harassment report',
        });
      expect(res1.status).toBe(201);
      expect(res1.body.report._id).toBeDefined();

      // Duplicate report by user 1 on same user
      const resDup = await request(app)
        .post('/v1/reports')
        .set('Authorization', `Bearer ${user1Token}`)
        .send({
          targetType: 'user',
          targetId: ownerUser._id.toString(),
          reason: 'fraud',
          details: 'User 1 trying to file second report',
        });
      expect(resDup.status).toBe(409);
      expect(resDup.body.error.code).toBe('REPORT_ALREADY_FILED');
    });

    it('captures a frozen snapshot of the target at filing time', async () => {
      const res = await request(app)
        .post('/v1/reports')
        .set('Authorization', `Bearer ${user1Token}`)
        .send({
          targetType: 'message',
          targetId: testMessage._id.toString(),
          reason: 'threat',
          details: 'Check snapshot freeze',
        });

      expect(res.status).toBe(201);
      const report = res.body.report;
      expect(report.snapshot.text).toBe('Threatening chat message for moderation test');

      // Now edit message text
      await Message.updateOne({ _id: testMessage._id }, { text: 'Edited polite message' });

      // Reload report: snapshot must remain original
      const reloadedReport = await Report.findById(report._id);
      expect(reloadedReport.snapshot.text).toBe('Threatening chat message for moderation test');
    });

    it('3rd unique reporter auto-hides item and notifies owner', async () => {
      const autoHideItem = await Item.create({
        ownerId: ownerUser._id,
        title: 'Controversial Item for Auto-Hide',
        description: 'Dangerous or prohibited item description',
        category: 'tools_and_diy',
        condition: 'good',
        photos: ['https://res.cloudinary.com/demo/image/upload/item.jpg'],
        rentPerDayPaise: 1000,
        depositPaise: 5000,
        location: {
          type: 'Point',
          coordinates: [77.5946, 12.9716],
          approximateAddress: 'Indiranagar, Bangalore',
        },
        status: 'active',
      });

      // Reporter 1 reports
      const res1 = await request(app)
        .post('/v1/reports')
        .set('Authorization', `Bearer ${user1Token}`)
        .send({
          targetType: 'item',
          targetId: autoHideItem._id.toString(),
          reason: 'prohibited_item',
          details: 'First report',
        });
      expect(res1.status).toBe(201);
      let checkItem = await Item.findById(autoHideItem._id);
      expect(checkItem.status).toBe('active');

      // Reporter 2 reports
      const res2 = await request(app)
        .post('/v1/reports')
        .set('Authorization', `Bearer ${user2Token}`)
        .send({
          targetType: 'item',
          targetId: autoHideItem._id.toString(),
          reason: 'prohibited_item',
          details: 'Second report',
        });
      expect(res2.status).toBe(201);
      checkItem = await Item.findById(autoHideItem._id);
      expect(checkItem.status).toBe('active');

      // Reporter 3 reports (triggers auto-hide at threshold 3)
      const res3 = await request(app)
        .post('/v1/reports')
        .set('Authorization', `Bearer ${user3Token}`)
        .send({
          targetType: 'item',
          targetId: autoHideItem._id.toString(),
          reason: 'prohibited_item',
          details: 'Third report threshold reached',
        });
      expect(res3.status).toBe(201);

      // Verify item auto-hidden
      checkItem = await Item.findById(autoHideItem._id);
      expect(checkItem.status).toBe('hidden');
      expect(checkItem.hiddenReason).toBe('auto_reports');
      expect(checkItem.hiddenFromStatus).toBe('active');

      // Verify Notification created for owner
      const notif = await Notification.findOne({
        userId: ownerUser._id,
        type: 'item_auto_hidden',
      });
      expect(notif).not.toBeNull();
      expect(notif.metadata.itemId.toString()).toBe(autoHideItem._id.toString());
    });
  });

  describe('Care Staff Endpoints (GET /v1/care/reports, POST action, GET users)', () => {
    it('GET /v1/care/reports lists reports with cursor pagination and filters', async () => {
      const res = await request(app)
        .get('/v1/care/reports?targetType=item&limit=10')
        .set('Authorization', `Bearer ${careAgentToken}`);

      expect(res.status).toBe(200);
      expect(res.body.reports.length).toBeGreaterThanOrEqual(1);
      expect(res.body.reports.every((r) => r.targetType === 'item')).toBe(true);
    });

    it('rejects invalid action for target type', async () => {
      // Create user report
      const rep = await Report.create({
        reporterId: user2._id,
        targetType: 'user',
        targetId: ownerUser._id,
        targetOwnerId: ownerUser._id,
        reason: 'harassment',
        status: 'pending',
      });

      // Attempting 'hide_item' on a user report must reject
      const res = await request(app)
        .post(`/v1/care/reports/${rep._id}/action`)
        .set('Authorization', `Bearer ${careAgentToken}`)
        .send({
          action: 'hide_item',
          notes: 'Invalid action on user',
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('REPORT_NOT_ALLOWED');
    });

    it('executes each care moderation action end-to-end and writes AuditLog', async () => {
      // 1. Action: dismiss
      const repDismiss = await Report.create({
        reporterId: user3._id,
        targetType: 'user',
        targetId: user1._id,
        targetOwnerId: user1._id,
        reason: 'spam',
        status: 'pending',
      });

      const resDismiss = await request(app)
        .post(`/v1/care/reports/${repDismiss._id}/action`)
        .set('Authorization', `Bearer ${careAgentToken}`)
        .send({
          action: 'dismiss',
          notes: 'No violation found',
        });
      expect(resDismiss.status).toBe(200);
      expect(resDismiss.body.report.status).toBe('reviewed');
      expect(resDismiss.body.report.actionTaken).toBe('dismiss');

      // 2. Action: hide_item, restore_item, remove_item
      const itemToModerate = await Item.create({
        ownerId: ownerUser._id,
        title: 'Moderation Action Item',
        description: 'Test item for care agent hide, restore, remove',
        category: 'tools_and_diy',
        condition: 'good',
        photos: ['https://res.cloudinary.com/demo/image/upload/mod_item.jpg'],
        rentPerDayPaise: 1000,
        depositPaise: 2000,
        location: {
          type: 'Point',
          coordinates: [77.5946, 12.9716],
          approximateAddress: 'Bangalore',
        },
        status: 'active',
      });

      const repItem = await Report.create({
        reporterId: user1._id,
        targetType: 'item',
        targetId: itemToModerate._id,
        targetOwnerId: ownerUser._id,
        reason: 'unsafe',
        status: 'pending',
      });

      // hide_item
      const resHide = await request(app)
        .post(`/v1/care/reports/${repItem._id}/action`)
        .set('Authorization', `Bearer ${careAgentToken}`)
        .send({ action: 'hide_item', notes: 'Hidden by care' });
      expect(resHide.status).toBe(200);
      let modItem = await Item.findById(itemToModerate._id);
      expect(modItem.status).toBe('hidden');
      expect(modItem.hiddenReason).toBe('care_agent');

      // restore_item
      const resRestore = await request(app)
        .post(`/v1/care/reports/${repItem._id}/action`)
        .set('Authorization', `Bearer ${careAgentToken}`)
        .send({ action: 'restore_item', notes: 'Item approved on review' });
      expect(resRestore.status).toBe(200);
      modItem = await Item.findById(itemToModerate._id);
      expect(modItem.status).toBe('active');
      expect(modItem.hiddenReason).toBeNull();

      // remove_item
      const resRemove = await request(app)
        .post(`/v1/care/reports/${repItem._id}/action`)
        .set('Authorization', `Bearer ${careAgentToken}`)
        .send({ action: 'remove_item', notes: 'Item permanently removed' });
      expect(resRemove.status).toBe(200);
      modItem = await Item.findById(itemToModerate._id);
      expect(modItem.status).toBe('removed');

      // 3. Action: warn_user
      const repWarn = await Report.create({
        reporterId: user2._id,
        targetType: 'message',
        targetId: testMessage._id,
        targetOwnerId: ownerUser._id,
        reason: 'inappropriate',
        status: 'pending',
      });

      const resWarn = await request(app)
        .post(`/v1/care/reports/${repWarn._id}/action`)
        .set('Authorization', `Bearer ${careAgentToken}`)
        .send({ action: 'warn_user', notes: 'Warning issued for inappropriate chat' });
      expect(resWarn.status).toBe(200);
      const warnNotif = await Notification.findOne({
        userId: ownerUser._id,
        type: 'user_warning',
      });
      expect(warnNotif).not.toBeNull();
      expect(warnNotif.body).toContain('Warning issued');

      // 4. Action: strike_user
      const repStrike = await Report.create({
        reporterId: user3._id,
        targetType: 'user',
        targetId: ownerUser._id,
        targetOwnerId: ownerUser._id,
        reason: 'harassment',
        status: 'pending',
      });

      const initialStrikes = ownerUser.strikes || ownerUser.strikesCount || 0;
      const resStrike = await request(app)
        .post(`/v1/care/reports/${repStrike._id}/action`)
        .set('Authorization', `Bearer ${careAgentToken}`)
        .send({ action: 'strike_user', notes: 'Strike applied for verified harassment' });
      expect(resStrike.status).toBe(200);

      const ownerReloaded = await User.findById(ownerUser._id);
      expect(ownerReloaded.strikes).toBe(initialStrikes + 1);

      // Verify AuditLog written for care report action
      const audit = await AuditLog.findOne({
        action: 'care.report.action',
        targetId: repStrike._id,
      });
      expect(audit).not.toBeNull();
    });

    it('GET /v1/care/users/:id returns user profile with masked email and booking statistics', async () => {
      // Create a booking for ownerUser to verify counts
      await Booking.create({
        itemId: testItem._id,
        borrowerId: user1._id,
        lenderId: ownerUser._id,
        startDate: '2026-11-25',
        endDate: '2026-11-28',
        days: 3,
        rentPaise: 3000,
        depositPaise: 5000,
        status: 'completed',
        dueAt: new Date(),
        expiresAt: new Date(),
      });

      const res = await request(app)
        .get(`/v1/care/users/${ownerUser._id}`)
        .set('Authorization', `Bearer ${careAgentToken}`);

      expect(res.status).toBe(200);
      expect(res.body.user._id).toBe(ownerUser._id.toString());
      expect(res.body.user.name).toBe(ownerUser.name);
      // Privacy rule: email must be masked, e.g. o***r@borrowloop.test
      expect(res.body.user.email).toMatch(/^o\*\*\*.*@borrowloop\.test$/);
      expect(res.body.user.bookingsAsLenderCount).toBeGreaterThanOrEqual(1);
      expect(res.body.user.strikesCount).toBeDefined();
      expect(res.body.user.trustScore).toBeDefined();

      // AuditLog check
      const audit = await AuditLog.findOne({
        action: 'care.user.view',
        targetId: ownerUser._id,
      });
      expect(audit).not.toBeNull();
    });
  });
});
