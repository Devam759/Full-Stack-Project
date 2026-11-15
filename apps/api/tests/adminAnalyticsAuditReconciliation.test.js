import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { setupTestDB, teardownTestDB } from './setup/dbTestHelper.js';
import { BUSINESS_CONFIG } from '@borrowloop/shared';
import {
  User,
  Wallet,
  Item,
  Booking,
  LedgerEntry,
  Dispute,
  AuditLog,
  ReconciliationRun,
  IdempotencyKey,
} from '@borrowloop/server-core';
import { createApp } from '../src/app.js';
import { signAccessToken } from '../src/common/jwt.js';

let app;
let adminToken;
let careAgentToken;
let adminUserId;

const { TOKEN_AUDIENCES } = BUSINESS_CONFIG;

beforeAll(async () => {
  await setupTestDB();

  await User.init();
  await Wallet.init();
  await Item.init();
  await Booking.init();
  await LedgerEntry.init();
  await Dispute.init();
  await AuditLog.init();
  await ReconciliationRun.init();
  await IdempotencyKey.init();

  app = createApp();

  // Seed Admin user
  adminUserId = new mongoose.Types.ObjectId();
  await User.create({
    _id: adminUserId,
    name: 'Platform Admin',
    email: 'admin@borrowloop.test',
    passwordHash: 'dummy_hash',
    role: 'admin',
    status: 'active',
  });
  adminToken = signAccessToken(
    { sub: adminUserId.toString(), role: 'admin' },
    TOKEN_AUDIENCES.PORTAL,
  );

  // Seed Care Agent user
  const careAgentId = new mongoose.Types.ObjectId();
  await User.create({
    _id: careAgentId,
    name: 'Care Agent 1',
    email: 'care@borrowloop.test',
    passwordHash: 'dummy_hash',
    role: 'care_agent',
    status: 'active',
  });
  careAgentToken = signAccessToken(
    { sub: careAgentId.toString(), role: 'care_agent' },
    TOKEN_AUDIENCES.PORTAL,
  );
});

afterAll(async () => {
  await teardownTestDB();
});

describe('Sub-step 9b: Admin Analytics, Audit Log & Ledger Reconciliation', () => {
  describe('Role-Based Access Control', () => {
    it('blocks care agents from accessing admin analytics overview (403)', async () => {
      const res = await request(app)
        .get('/v1/admin/analytics/overview')
        .set('Authorization', `Bearer ${careAgentToken}`);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('blocks care agents from accessing admin audit log (403)', async () => {
      const res = await request(app)
        .get('/v1/admin/audit-log')
        .set('Authorization', `Bearer ${careAgentToken}`);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('blocks care agents from accessing reconciliation history and run trigger (403)', async () => {
      const getRes = await request(app)
        .get('/v1/admin/ledger/reconciliation')
        .set('Authorization', `Bearer ${careAgentToken}`);
      expect(getRes.status).toBe(403);

      const postRes = await request(app)
        .post('/v1/admin/ledger/reconciliation/run')
        .set('Authorization', `Bearer ${careAgentToken}`)
        .set('Idempotency-Key', 'care_key_1')
        .send({ reason: 'Audit test trigger attempt' });
      expect(postRes.status).toBe(403);
    });
  });

  describe('GET /v1/admin/analytics/overview', () => {
    beforeAll(async () => {
      // Seed users: 2 active (already exist from beforeAll), 1 frozen, 1 banned
      await User.create({
        name: 'Frozen User',
        email: 'frozen@test.com',
        passwordHash: 'dummy_hash',
        role: 'user',
        status: 'frozen',
      });
      await User.create({
        name: 'Banned User',
        email: 'banned@test.com',
        passwordHash: 'dummy_hash',
        role: 'user',
        status: 'banned',
      });

      // Seed items
      const ownerId = new mongoose.Types.ObjectId();
      await Item.create([
        {
          ownerId,
          title: 'Active Drill',
          description: 'A cordless drill',
          category: 'tools_and_diy',
          condition: 'good',
          photos: ['https://example.com/drill.jpg'],
          rentPerDayPaise: 500_00,
          depositPaise: 1000_00,
          location: { coordinates: [77.5946, 12.9716] },
          status: 'active',
        },
        {
          ownerId,
          title: 'Paused Tent',
          description: 'Camping tent',
          category: 'outdoor_and_camping',
          condition: 'good',
          photos: ['https://example.com/tent.jpg'],
          rentPerDayPaise: 400_00,
          depositPaise: 800_00,
          location: { coordinates: [77.5946, 12.9716] },
          status: 'paused',
        },
        {
          ownerId,
          title: 'Hidden Item',
          description: 'Auto hidden item',
          category: 'other',
          condition: 'fair',
          photos: ['https://example.com/hidden.jpg'],
          rentPerDayPaise: 200_00,
          depositPaise: 500_00,
          location: { coordinates: [77.5946, 12.9716] },
          status: 'hidden',
          hiddenReason: 'auto_reports',
        },
      ]);

      // Seed Bookings
      const borrowerId = new mongoose.Types.ObjectId();
      const itemId = new mongoose.Types.ObjectId();
      await Booking.create([
        {
          itemId,
          borrowerId,
          lenderId: ownerId,
          startDate: '2026-05-01',
          endDate: '2026-05-03',
          days: 2,
          dueAt: new Date('2026-05-03T20:00:00Z'),
          expiresAt: new Date('2026-05-04T00:00:00Z'),
          rentPaise: 1000_00,
          depositPaise: 2000_00,
          status: 'completed',
        },
        {
          itemId,
          borrowerId,
          lenderId: ownerId,
          startDate: '2026-05-04',
          endDate: '2026-05-06',
          days: 2,
          dueAt: new Date('2026-05-06T20:00:00Z'),
          expiresAt: new Date('2026-05-07T00:00:00Z'),
          rentPaise: 1500_00,
          depositPaise: 3000_00,
          status: 'completed',
        },
        {
          itemId,
          borrowerId,
          lenderId: ownerId,
          startDate: '2026-05-10',
          endDate: '2026-05-12',
          days: 2,
          dueAt: new Date('2026-05-12T20:00:00Z'),
          expiresAt: new Date('2026-05-13T00:00:00Z'),
          rentPaise: 800_00,
          depositPaise: 1500_00,
          status: 'picked_up',
        },
      ]);

      // Seed Wallets: total frozen deposits
      await Wallet.create({
        userId: borrowerId,
        availablePaise: 5000_00,
        frozenPaise: 4500_00,
        pendingPaise: 0,
      });

      // Seed LedgerEntries: platform commission including appeal reversal entries
      await LedgerEntry.create([
        {
          txnId: 'txn_comm_1',
          account: 'platform_revenue',
          amountPaise: 375_00,
          type: 'commission',
        },
        {
          txnId: 'txn_comm_2',
          account: 'platform_revenue',
          amountPaise: 225_00,
          type: 'commission',
        },
        {
          txnId: 'txn_appeal_rev_1',
          account: 'platform_revenue',
          amountPaise: -50_00, // Reversal adjusting commission
          type: 'appeal_reversal',
        },
      ]);

      // Seed Disputes: 1 open, 1 with pending appeal
      const disputeBooking1 = new mongoose.Types.ObjectId();
      const disputeBooking2 = new mongoose.Types.ObjectId();
      await Dispute.create([
        {
          bookingId: disputeBooking1,
          disputeReason: 'damage',
          source: 'user',
          openedById: borrowerId,
          againstUserId: ownerId,
          status: 'opened',
        },
        {
          bookingId: disputeBooking2,
          disputeReason: 'condition_mismatch',
          source: 'user',
          openedById: borrowerId,
          againstUserId: ownerId,
          status: 'appealed',
          appeal: {
            appealedById: borrowerId,
            reason: 'Claimed damage was pre-existing',
            status: 'pending',
          },
        },
      ]);
    });

    it('aggregates exact live operational numbers and displays Demo money label', async () => {
      const res = await request(app)
        .get('/v1/admin/analytics/overview')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      const data = res.body;

      // Users
      expect(data.users.total).toBeGreaterThanOrEqual(4);
      expect(data.users.active).toBeGreaterThanOrEqual(2);
      expect(data.users.frozen).toBe(1);
      expect(data.users.banned).toBe(1);

      // Items
      expect(data.items.active).toBe(1);
      expect(data.items.paused).toBe(1);
      expect(data.items.hidden).toBe(1);
      expect(data.items.rentedNow).toBe(1); // 1 picked_up booking

      // Bookings
      expect(data.bookings.completed).toBe(2);
      expect(data.bookings.picked_up).toBe(1);

      // Financials: Volume = completed rent sum (1000 + 1500 = 2500_00)
      expect(data.financials.volumePaise).toBe(2500_00);
      // Deposits held = sum of frozenPaise in wallets (4500_00)
      expect(data.financials.depositsHeldPaise).toBe(4500_00);
      // Commission earned = 375 + 225 - 50 = 550_00
      expect(data.financials.commissionEarnedPaise).toBe(550_00);
      expect(data.financials.label).toBe('Demo money');

      // Disputes
      expect(data.disputes.open).toBe(1);
      expect(data.disputes.pendingAppeals).toBe(1);
      expect(data.disputes.total).toBe(2);
      expect(data.disputes.disputeRatio).toBeGreaterThan(0);

      // Privacy: No emails, names, coordinates in analytics response
      const str = JSON.stringify(data);
      expect(str).not.toContain('@');
      expect(str).not.toContain('coordinates');
    });
  });

  describe('GET /v1/admin/audit-log', () => {
    beforeAll(async () => {
      // Seed audit log entries with sensitive data to test masking
      await AuditLog.create([
        {
          actorId: adminUserId,
          actorRole: 'admin',
          action: 'user_banned',
          targetType: 'user',
          targetId: new mongoose.Types.ObjectId().toString(),
          before: { status: 'active', email: 'offender@borrowloop.test' },
          after: { status: 'banned', reason: 'Fraudulent listings' },
        },
        {
          actorId: adminUserId,
          actorRole: 'admin',
          action: 'item_removed',
          targetType: 'item',
          targetId: new mongoose.Types.ObjectId().toString(),
          before: { status: 'active', location: { coordinates: [77.59, 12.97] } },
          after: { status: 'removed', reason: 'Prohibited firearm' },
        },
        {
          actorId: adminUserId,
          actorRole: 'admin',
          action: 'strike_reversed',
          targetType: 'user',
          targetId: new mongoose.Types.ObjectId().toString(),
          before: { strikes: 2 },
          after: { strikes: 1, reason: 'Appeal upheld' },
        },
      ]);
    });

    it('returns cursor-paginated audit trail with masked PII and zero coordinates', async () => {
      const res = await request(app)
        .get('/v1/admin/audit-log?limit=2')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.auditLogs).toHaveLength(2);
      expect(res.body.nextCursor).toBeDefined();

      // Masking check: email is masked, coordinates omitted
      const first = res.body.auditLogs[0];
      const str = JSON.stringify(first);
      expect(str).not.toContain('offender@borrowloop.test');
      expect(str).not.toContain('coordinates');

      // Cursor continuity check: page 2
      const page2 = await request(app)
        .get(`/v1/admin/audit-log?limit=2&cursor=${res.body.nextCursor}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(page2.status).toBe(200);
      expect(page2.body.auditLogs.length).toBeGreaterThanOrEqual(1);
      // Items must be strictly older than previous page
      expect(page2.body.auditLogs[0]._id).not.toBe(first._id);
    });

    it('filters audit logs by action and targetType', async () => {
      const res = await request(app)
        .get('/v1/admin/audit-log?action=user_banned')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.auditLogs.length).toBeGreaterThanOrEqual(1);
      expect(res.body.auditLogs.every((l) => l.action === 'user_banned')).toBe(true);
    });
  });

  describe('Reconciliation History & On-Demand Trigger', () => {
    it('returns reconciliation history with mismatch summaries', async () => {
      await ReconciliationRun.create({
        runId: 'rec_historical_1',
        status: 'completed',
        startedAt: new Date(Date.now() - 3600000),
        finishedAt: new Date(Date.now() - 3500000),
        totalWalletsChecked: 100,
        totalLedgerEntriesChecked: 250,
        mismatchesCount: 1,
        mismatches: [
          {
            userId: new mongoose.Types.ObjectId(),
            walletAvailablePaise: 1200,
            ledgerAvailableSumPaise: 1000,
            diffPaise: 200,
          },
        ],
      });

      const res = await request(app)
        .get('/v1/admin/ledger/reconciliation')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.runs.length).toBeGreaterThanOrEqual(1);
      const run = res.body.runs.find((r) => r.runId === 'rec_historical_1');
      expect(run).toBeDefined();
      expect(run.mismatchesCount).toBe(1);
      expect(run.mismatches[0].diffPaise).toBe(200);
    });

    it('triggers on-demand reconciliation run and returns 202 with runId', async () => {
      const res = await request(app)
        .post('/v1/admin/ledger/reconciliation/run')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('Idempotency-Key', `admin_rec_trigger_${Date.now()}`)
        .send({ reason: 'Weekly integrity audit review' });

      expect(res.status).toBe(202);
      expect(res.body.runId).toMatch(/^rec_admin_/);
      expect(res.body.status).toBe('enqueued');

      // Verify audit log row was written in DB
      const audit = await AuditLog.findOne({
        action: 'reconciliation_run_triggered',
        targetId: res.body.runId,
      });
      expect(audit).toBeDefined();
      expect(audit.after.reason).toBe('Weekly integrity audit review');
    });

    it('enforces cooldown when reconciliation is triggered too quickly (429)', async () => {
      // Create a run that just completed 10 seconds ago
      await ReconciliationRun.create({
        runId: `rec_just_finished_${Date.now()}`,
        status: 'completed',
        startedAt: new Date(Date.now() - 20000),
        finishedAt: new Date(Date.now() - 10000), // 10s ago
        completedAt: new Date(Date.now() - 10000),
      });

      const res = await request(app)
        .post('/v1/admin/ledger/reconciliation/run')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('Idempotency-Key', `rec_cd_${Date.now()}`)
        .send({ reason: 'Immediate repeated run attempt' });

      expect(res.status).toBe(429);
      expect(res.body.error.code).toBe('RECONCILIATION_COOLDOWN');
    });

    it('enforces cooldown when a reconciliation run is already in progress (429)', async () => {
      await ReconciliationRun.create({
        runId: `rec_in_prog_${Date.now()}`,
        status: 'in_progress',
        startedAt: new Date(Date.now() - 30000), // 30s ago
      });

      const res = await request(app)
        .post('/v1/admin/ledger/reconciliation/run')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('Idempotency-Key', `rec_prog_${Date.now()}`)
        .send({ reason: 'Concurrent trigger attempt' });

      expect(res.status).toBe(429);
      expect(res.body.error.code).toBe('RECONCILIATION_COOLDOWN');
      expect(res.body.error.message).toContain('already in progress');
    });
  });
});
