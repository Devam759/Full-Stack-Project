import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { setupTestDB, teardownTestDB } from './setup/dbTestHelper.js';
import { createApp } from '../src/app.js';
import {
  User,
  Booking,
  Item,
  Dispute,
  Handover,
  Message,
  AuditLog,
  LedgerEntry,
  addDemoFunds,
  freezeBookingFunds,
} from '@borrowloop/server-core';
import { signAccessToken } from '../src/common/jwt.js';
import { BUSINESS_CONFIG } from '@borrowloop/shared';
import {
  closeDisputesJob,
  escalateDisputesJob,
} from '../../worker/src/jobs/disputeLifecycleJobs.js';

const { TOKEN_AUDIENCES } = BUSINESS_CONFIG;

describe('Care Disputes & Appeals Endpoints (Sub-step 8d)', () => {
  let app;
  let borrower;
  let lender;
  let careAgent;
  let careAgent2;
  let adminUser;
  let borrowerToken;
  let lenderToken;
  let careAgentToken;
  let careAgent2Token;
  let adminToken;
  let item;

  beforeAll(async () => {
    await setupTestDB();
    app = createApp();

    borrower = await User.create({
      name: 'Borrower Test',
      email: 'borrower_care@borrowloop.test',
      emailVerified: true,
      status: 'active',
      passwordHash: 'hash123',
    });

    lender = await User.create({
      name: 'Lender Test',
      email: 'lender_care@borrowloop.test',
      emailVerified: true,
      status: 'active',
      passwordHash: 'hash123',
    });

    careAgent = await User.create({
      name: 'Care Agent 1',
      email: 'care1@borrowloop.test',
      emailVerified: true,
      role: 'care_agent',
      status: 'active',
      passwordHash: 'hash123',
    });

    careAgent2 = await User.create({
      name: 'Care Agent 2',
      email: 'care2@borrowloop.test',
      emailVerified: true,
      role: 'care_agent',
      status: 'active',
      passwordHash: 'hash123',
    });

    adminUser = await User.create({
      name: 'Admin User',
      email: 'admin_care@borrowloop.test',
      emailVerified: true,
      role: 'admin',
      status: 'active',
      passwordHash: 'hash123',
    });

    borrowerToken = signAccessToken(
      { sub: borrower._id.toString(), role: borrower.role },
      TOKEN_AUDIENCES.USER,
    );
    lenderToken = signAccessToken(
      { sub: lender._id.toString(), role: lender.role },
      TOKEN_AUDIENCES.USER,
    );
    careAgentToken = signAccessToken(
      { sub: careAgent._id.toString(), role: careAgent.role },
      TOKEN_AUDIENCES.PORTAL,
    );
    careAgent2Token = signAccessToken(
      { sub: careAgent2._id.toString(), role: careAgent2.role },
      TOKEN_AUDIENCES.PORTAL,
    );
    adminToken = signAccessToken(
      { sub: adminUser._id.toString(), role: adminUser.role },
      TOKEN_AUDIENCES.PORTAL,
    );

    item = await Item.create({
      ownerId: lender._id,
      title: 'Power Drill 20V',
      description: 'Waterproof drill',
      category: 'tools_and_diy',
      condition: 'good',
      photos: [
        `https://res.cloudinary.com/demo_cloud/image/upload/borrowloop/items/${lender._id}/tent.jpg`,
      ],
      rentPerDayPaise: 1000,
      depositPaise: 5000,
      location: {
        type: 'Point',
        coordinates: [77.5946, 12.9716],
        approximateAddress: 'Indiranagar, Bangalore',
      },
      status: 'active',
    });
  });

  afterAll(async () => {
    await teardownTestDB();
  });

  async function createDisputedBookingAndDispute(overrides = {}) {
    const now = Date.now();
    const rentPaise = overrides.rentPaise || 1000;
    const depositPaise = overrides.depositPaise || 5000;
    const borrowerId = overrides.borrowerId || borrower._id;

    await addDemoFunds({ userId: borrowerId, amountPaise: rentPaise + depositPaise });

    const booking = await Booking.create({
      itemId: item._id,
      borrowerId,
      lenderId: overrides.lenderId || lender._id,
      startDate: '2026-11-01',
      endDate: '2026-11-10',
      days: 9,
      dueAt: new Date(now + 86400000),
      expiresAt: new Date(now + 86400000),
      rentPaise,
      depositPaise,
      status: 'disputed',
      lateChargePaise: overrides.lateChargePaise || 0,
    });

    await freezeBookingFunds({
      bookingId: booking._id,
      borrowerId: booking.borrowerId,
      rentPaise,
      depositPaise,
      throwOnAlreadyApplied: false,
    });

    const dispute = await Dispute.create({
      bookingId: booking._id,
      disputeReason: overrides.disputeReason || 'condition_mismatch',
      source: 'user',
      openedById: booking.borrowerId,
      againstUserId: booking.lenderId,
      status: overrides.status || 'opened',
      assignedAgentId: overrides.assignedAgentId || null,
      assignedAt: overrides.assignedAt || null,
      statusHistory: [
        {
          status: overrides.status || 'opened',
          changedBy: booking.borrowerId,
          note: 'Initial dispute',
          changedAt: new Date(now - (overrides.ageMs || 0)),
        },
      ],
      createdAt: new Date(now - (overrides.ageMs || 0)),
      ...(overrides.decision ? { decision: overrides.decision } : {}),
    });

    return { booking, dispute };
  }

  describe('GET /v1/care/disputes', () => {
    it('rejects unauthenticated requests or user-audience tokens', async () => {
      const res1 = await request(app).get('/v1/care/disputes');
      expect(res1.status).toBe(401);

      const res2 = await request(app)
        .get('/v1/care/disputes')
        .set('Authorization', `Bearer ${borrowerToken}`);
      expect(res2.status).toBe(401); // audience mismatch
    });

    it('lists disputes with filters and cursor pagination', async () => {
      await createDisputedBookingAndDispute({
        disputeReason: 'condition_mismatch',
        status: 'opened',
      });
      const { dispute: d2 } = await createDisputedBookingAndDispute({
        disputeReason: 'no_show',
        status: 'assigned',
        assignedAgentId: careAgent._id,
      });

      // Fetch with limit 1
      const res1 = await request(app)
        .get('/v1/care/disputes?limit=1')
        .set('Authorization', `Bearer ${careAgentToken}`);
      expect(res1.status).toBe(200);
      expect(res1.body.disputes.length).toBe(1);
      expect(res1.body.nextCursor).toBeDefined();

      // Fetch with assignedToMe=true
      const res2 = await request(app)
        .get('/v1/care/disputes?assignedToMe=true')
        .set('Authorization', `Bearer ${careAgentToken}`);
      expect(res2.status).toBe(200);
      expect(res2.body.disputes.some((d) => d._id === d2._id.toString())).toBe(true);
      expect(res2.body.disputes.every((d) => d.assignedAgentId === careAgent._id.toString())).toBe(
        true,
      );

      // Fetch with reason filter
      const res3 = await request(app)
        .get('/v1/care/disputes?reason=condition_mismatch')
        .set('Authorization', `Bearer ${careAgentToken}`);
      expect(res3.status).toBe(200);
      expect(res3.body.disputes.every((d) => d.disputeReason === 'condition_mismatch')).toBe(true);
    });
  });

  describe('GET /v1/care/disputes/:id', () => {
    it('returns full case file with internalNote and writes AuditLog', async () => {
      const { booking, dispute } = await createDisputedBookingAndDispute({
        status: 'assigned',
        assignedAgentId: careAgent._id,
      });

      // Add a message and handover
      await Message.create({
        conversationId: booking._id,
        bookingId: booking._id,
        senderId: borrower._id,
        recipientId: lender._id,
        type: 'text',
        text: 'Hello from borrower',
      });

      await Handover.create({
        bookingId: booking._id,
        type: 'pickup',
        issuerId: lender._id,
        photos: [],
      });

      const res = await request(app)
        .get(`/v1/care/disputes/${dispute._id}`)
        .set('Authorization', `Bearer ${careAgentToken}`);

      expect(res.status).toBe(200);
      expect(res.body.dispute._id).toBe(dispute._id.toString());
      expect(res.body.booking._id).toBe(booking._id.toString());
      expect(res.body.item._id).toBe(item._id.toString());
      expect(res.body.borrower._id).toBe(borrower._id.toString());
      expect(res.body.lender._id).toBe(lender._id.toString());
      expect(res.body.handovers.length).toBeGreaterThanOrEqual(1);
      expect(res.body.messages.length).toBeGreaterThanOrEqual(1);

      // Verify AuditLog written
      const audit = await AuditLog.findOne({
        action: 'care.dispute.view',
        targetId: dispute._id,
        actorId: careAgent._id,
      });
      expect(audit).not.toBeNull();
    });

    it('blocks reading case file with 403 CONFLICT_OF_INTEREST if agent is participant', async () => {
      // Care agent is also the borrower
      const { dispute } = await createDisputedBookingAndDispute({
        borrowerId: careAgent._id,
      });

      const res = await request(app)
        .get(`/v1/care/disputes/${dispute._id}`)
        .set('Authorization', `Bearer ${careAgentToken}`);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('CONFLICT_OF_INTEREST');
    });
  });

  describe('POST /v1/care/disputes/:id/assign', () => {
    it('allows care agent to self-assign', async () => {
      const { dispute } = await createDisputedBookingAndDispute();

      const res = await request(app)
        .post(`/v1/care/disputes/${dispute._id}/assign`)
        .set('Authorization', `Bearer ${careAgentToken}`)
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.dispute.assignedAgentId).toBe(careAgent._id.toString());
      expect(res.body.dispute.status).toBe('assigned');

      const audit = await AuditLog.findOne({
        action: 'care.dispute.assign',
        targetId: dispute._id,
        actorId: careAgent._id,
      });
      expect(audit).not.toBeNull();
    });

    it('blocks care agent assigning to someone else with 403', async () => {
      const { dispute } = await createDisputedBookingAndDispute();

      const res = await request(app)
        .post(`/v1/care/disputes/${dispute._id}/assign`)
        .set('Authorization', `Bearer ${careAgentToken}`)
        .send({ agentId: careAgent2._id.toString() });

      expect(res.status).toBe(403);
    });

    it('rejects care agent reassigning a dispute already assigned to another agent with 409', async () => {
      const { dispute } = await createDisputedBookingAndDispute({
        assignedAgentId: careAgent._id,
        status: 'assigned',
      });

      const res = await request(app)
        .post(`/v1/care/disputes/${dispute._id}/assign`)
        .set('Authorization', `Bearer ${careAgent2Token}`)
        .send({});

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('DISPUTE_ALREADY_ASSIGNED');
    });

    it('allows admin to reassign any dispute', async () => {
      const { dispute } = await createDisputedBookingAndDispute({
        assignedAgentId: careAgent._id,
        status: 'assigned',
      });

      const res = await request(app)
        .post(`/v1/care/disputes/${dispute._id}/assign`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ agentId: careAgent2._id.toString() });

      expect(res.status).toBe(200);
      expect(res.body.dispute.assignedAgentId).toBe(careAgent2._id.toString());
    });
  });

  describe('POST /v1/care/disputes/:id/decision', () => {
    it('blocks non-assigned agent from deciding with 403 DISPUTE_NOT_ASSIGNED_TO_YOU', async () => {
      const { dispute } = await createDisputedBookingAndDispute({
        assignedAgentId: careAgent._id,
        status: 'assigned',
      });

      const res = await request(app)
        .post(`/v1/care/disputes/${dispute._id}/decision`)
        .set('Authorization', `Bearer ${careAgent2Token}`)
        .set('Idempotency-Key', 'decision-key-fail-001')
        .send({
          depositToLenderPaise: 1000,
          depositToBorrowerPaise: 4000,
          applyLateCharge: false,
          rentOutcome: 'lender',
          penaltyKind: 'none',
          note: 'Valid decision note with length over 20 characters',
        });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('DISPUTE_NOT_ASSIGNED_TO_YOU');
    });

    it('decides dispute end-to-end with double entry zero-sum ledger settlement and idempotency', async () => {
      const { booking, dispute } = await createDisputedBookingAndDispute({
        assignedAgentId: careAgent._id,
        status: 'assigned',
        rentPaise: 1000,
        depositPaise: 5000,
      });

      const payload = {
        depositToLenderPaise: 2000,
        depositToBorrowerPaise: 3000,
        applyLateCharge: false,
        rentOutcome: 'lender',
        faultUserId: borrower._id.toString(),
        penaltyKind: 'lost_dispute',
        borrowerAccountAction: 'keep_frozen',
        note: 'Borrower caused partial damage; deposit compensation paid to lender.',
        internalNote: 'Evidence verified by care agent 1',
      };

      const idempotencyKey = `decision-key-${dispute._id}`;

      const res1 = await request(app)
        .post(`/v1/care/disputes/${dispute._id}/decision`)
        .set('Authorization', `Bearer ${careAgentToken}`)
        .set('Idempotency-Key', idempotencyKey)
        .send(payload);

      expect(res1.status).toBe(200);
      expect(res1.body.dispute.status).toBe('decided');
      expect(res1.body.booking.status).toBe('completed');
      expect(res1.body.settlement).toBeDefined();

      // Idempotency replay check
      const res2 = await request(app)
        .post(`/v1/care/disputes/${dispute._id}/decision`)
        .set('Authorization', `Bearer ${careAgentToken}`)
        .set('Idempotency-Key', idempotencyKey)
        .send(payload);

      expect(res2.status).toBe(200);
      expect(res2.body.dispute._id).toBe(dispute._id.toString());

      // Verify Ledger entries sum to zero
      const ledgerEntries = await LedgerEntry.find({ bookingId: booking._id });
      const sum = ledgerEntries.reduce((acc, entry) => acc + entry.amountPaise, 0);
      expect(sum).toBe(0);

      // Verify Audit log written
      const audit = await AuditLog.findOne({
        action: 'dispute.decided',
        targetId: dispute._id,
      });
      expect(audit).not.toBeNull();
    });
  });

  describe('POST /v1/disputes/:id/appeal', () => {
    it('allows a participant to appeal within 7 days', async () => {
      const now = new Date();
      const { dispute } = await createDisputedBookingAndDispute({
        status: 'decided',
        decision: {
          decidedById: careAgent._id,
          decidedAt: new Date(now.getTime() - 2 * 86400000), // 2 days ago
          depositToLenderPaise: 0,
          depositToBorrowerPaise: 5000,
          appliedLateChargePaise: 0,
          rentOutcome: 'refund_borrower',
          note: 'Decided 2 days ago for testing appeal window',
        },
      });

      const res = await request(app)
        .post(`/v1/disputes/${dispute._id}/appeal`)
        .set('Authorization', `Bearer ${lenderToken}`)
        .send({
          reason: 'Lender disagrees with full refund to borrower and has new photos',
        });

      expect(res.status).toBe(200);
      expect(res.body.dispute.status).toBe('appealed');
      expect(res.body.dispute.appeal.reason).toContain('Lender disagrees');

      // Duplicate appeal check: must be rejected with 409
      const resDup = await request(app)
        .post(`/v1/disputes/${dispute._id}/appeal`)
        .set('Authorization', `Bearer ${borrowerToken}`)
        .send({
          reason: 'Borrower also wants to appeal this dispute',
        });

      expect(resDup.status).toBe(409);
      expect(resDup.body.error.code).toBe('APPEAL_ALREADY_SUBMITTED');
    });

    it('rejects appeal after 7 days with 400 APPEAL_WINDOW_CLOSED', async () => {
      const now = new Date();
      const { dispute } = await createDisputedBookingAndDispute({
        status: 'decided',
        decision: {
          decidedById: careAgent._id,
          decidedAt: new Date(now.getTime() - 8 * 86400000), // 8 days ago
          depositToLenderPaise: 0,
          depositToBorrowerPaise: 5000,
          appliedLateChargePaise: 0,
          rentOutcome: 'refund_borrower',
          note: 'Decided 8 days ago to test window closing',
        },
      });

      const res = await request(app)
        .post(`/v1/disputes/${dispute._id}/appeal`)
        .set('Authorization', `Bearer ${lenderToken}`)
        .send({
          reason: 'Lender appealing after the window closed',
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('APPEAL_WINDOW_CLOSED');
    });
  });

  describe('Background Jobs (closeDisputesJob & escalateDisputesJob)', () => {
    it('closeDisputesJob closes decided disputes older than 7 days without appeals', async () => {
      const now = new Date();
      const { dispute } = await createDisputedBookingAndDispute({
        status: 'decided',
        decision: {
          decidedById: careAgent._id,
          decidedAt: new Date(now.getTime() - 8 * 86400000), // 8 days ago
          depositToLenderPaise: 0,
          depositToBorrowerPaise: 5000,
          appliedLateChargePaise: 0,
          rentOutcome: 'refund_borrower',
          note: 'Decided 8 days ago for close job test',
        },
      });

      const result = await closeDisputesJob({ now });
      expect(result.closedCount).toBeGreaterThanOrEqual(1);

      const reloaded = await Dispute.findById(dispute._id);
      expect(reloaded.status).toBe('closed');
      expect(reloaded.closedAt).toBeDefined();
    });

    it('escalateDisputesJob flags unassigned opened disputes older than 24 hours', async () => {
      const now = new Date();
      const { dispute } = await createDisputedBookingAndDispute({
        status: 'opened',
        assignedAgentId: null,
      });

      // Advance clock by 25 hours to test escalation job
      const futureTime = new Date(now.getTime() + 25 * 3600 * 1000);
      const result = await escalateDisputesJob({ now: futureTime });
      expect(result.escalatedCount).toBeGreaterThanOrEqual(1);

      const reloaded = await Dispute.findById(dispute._id);
      expect(reloaded.isEscalated).toBe(true);
      expect(reloaded.escalatedAt).toBeDefined();
    });
  });
});
