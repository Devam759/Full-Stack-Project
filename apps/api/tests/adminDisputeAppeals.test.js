/**
 * @file apps/api/tests/adminDisputeAppeals.test.js
 * Comprehensive integration tests for Sub-step 9d:
 * Dispute appeals queue, settlement preview, conflict-of-interest guards,
 * money reversal deltas, shortfall capping, penalty reversal, and transactional decisions.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { BUSINESS_CONFIG } from '@borrowloop/shared';
import {
  User,
  Item,
  Booking,
  Dispute,
  Wallet,
  TrustEvent,
  AuditLog,
  Notification,
  LedgerEntry,
} from '@borrowloop/server-core';
import { signAccessToken } from '../src/common/jwt.js';
import app from '../src/app.js';

const { TOKEN_AUDIENCES } = BUSINESS_CONFIG;

describe('Sub-step 9d: Admin Dispute Appeals and Money Reversal', () => {
  let replSet;
  let adminUser;
  let adminToken;
  let careAgentUser;
  let careAgentToken;
  let conflictAdminUser;
  let conflictAdminToken;

  let borrowerUser;
  let lenderUser;
  let testItem;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({
      replSet: { count: 1, storageEngine: 'wiredTiger' },
    });
    const uri = replSet.getUri();
    await mongoose.connect(uri);

    // Admin user (unbiased decider)
    adminUser = await User.create({
      name: 'Independent Admin',
      email: 'admin.independent@borrowloop.test',
      passwordHash: 'dummy_hash',
      role: 'admin',
      status: 'active',
      emailVerified: true,
    });
    adminToken = signAccessToken(
      { sub: adminUser._id.toString(), role: 'admin' },
      TOKEN_AUDIENCES.PORTAL,
    );

    // Conflict Admin user (e.g. made original care decision or is participant)
    conflictAdminUser = await User.create({
      name: 'Original Care Decider',
      email: 'admin.decider@borrowloop.test',
      passwordHash: 'dummy_hash',
      role: 'admin',
      status: 'active',
      emailVerified: true,
    });
    conflictAdminToken = signAccessToken(
      { sub: conflictAdminUser._id.toString(), role: 'admin' },
      TOKEN_AUDIENCES.PORTAL,
    );

    // Care Agent user (for RBAC 403 test)
    careAgentUser = await User.create({
      name: 'Frontline Agent',
      email: 'care.agent@borrowloop.test',
      passwordHash: 'dummy_hash',
      role: 'care_agent',
      status: 'active',
      emailVerified: true,
    });
    careAgentToken = signAccessToken(
      { sub: careAgentUser._id.toString(), role: 'care_agent' },
      TOKEN_AUDIENCES.PORTAL,
    );

    // Borrower user
    borrowerUser = await User.create({
      name: 'David Borrower',
      email: 'david.borrower@test.com',
      passwordHash: 'dummy_hash',
      role: 'user',
      status: 'active',
      emailVerified: true,
      strikes: 1, // Received 1 strike in original care decision
    });

    // Lender user
    lenderUser = await User.create({
      name: 'Laura Lender',
      email: 'laura.lender@test.com',
      passwordHash: 'dummy_hash',
      role: 'user',
      status: 'active',
      emailVerified: true,
    });

    // Wallets: Initial available balances
    await Wallet.create({
      userId: borrowerUser._id,
      availablePaise: 500_00,
      frozenPaise: 0,
      pendingPaise: 0,
    });

    await Wallet.create({
      userId: lenderUser._id,
      availablePaise: 100_00, // Lender has low available balance to trigger shortfall on debit
      frozenPaise: 0,
      pendingPaise: 0,
    });

    // Item
    testItem = await Item.create({
      ownerId: lenderUser._id,
      title: 'Pro Stihl Chainsaw',
      description: 'Heavy duty gas chainsaw',
      category: 'tools_and_diy',
      condition: 'good',
      photos: ['https://example.com/chainsaw.jpg'],
      rentPerDayPaise: 1000_00,
      depositPaise: 2000_00,
      location: { coordinates: [77.5946, 12.9716] },
      status: 'active',
    });
  });

  afterAll(async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
    if (replSet) {
      await replSet.stop();
    }
  });

  describe('RBAC Verification', () => {
    it('blocks care agents from accessing admin appeals queue, preview, and decide (403)', async () => {
      const getRes = await request(app)
        .get('/v1/admin/appeals')
        .set('Authorization', `Bearer ${careAgentToken}`);
      expect(getRes.status).toBe(403);
      expect(getRes.body.error.code).toBe('FORBIDDEN');

      const fakeId = new mongoose.Types.ObjectId();
      const prevRes = await request(app)
        .post(`/v1/admin/appeals/${fakeId}/preview`)
        .set('Authorization', `Bearer ${careAgentToken}`)
        .send({
          revisedDecision: {
            depositToLenderPaise: 0,
            depositToBorrowerPaise: 2000_00,
            rentOutcome: 'refund_borrower',
            penaltyKind: 'none',
          },
        });
      expect(prevRes.status).toBe(403);

      const decideRes = await request(app)
        .post(`/v1/admin/appeals/${fakeId}/decide`)
        .set('Authorization', `Bearer ${careAgentToken}`)
        .set('Idempotency-Key', 'care_decide_1')
        .send({ decision: 'upheld', note: 'Upheld by care agent attempt' });
      expect(decideRes.status).toBe(403);
    });
  });

  describe('Appeals Queue & Listing', () => {
    let mockDispute;

    beforeAll(async () => {
      const booking = await Booking.create({
        itemId: testItem._id,
        borrowerId: borrowerUser._id,
        lenderId: lenderUser._id,
        startDate: '2026-05-01',
        endDate: '2026-05-03',
        days: 2,
        dueAt: new Date('2026-05-03T20:00:00Z'),
        expiresAt: new Date('2026-05-04T00:00:00Z'),
        rentPaise: 1000_00,
        depositPaise: 2000_00,
        status: 'completed',
      });

      mockDispute = await Dispute.create({
        bookingId: booking._id,
        disputeReason: 'damage',
        source: 'user',
        openedById: lenderUser._id,
        againstUserId: borrowerUser._id,
        status: 'appealed',
        decision: {
          decidedById: conflictAdminUser._id,
          decidedAt: new Date(),
          depositToLenderPaise: 2000_00, // Lender got 100% of deposit
          depositToBorrowerPaise: 0,
          appliedLateChargePaise: 0,
          rentOutcome: 'lender',
          faultUserId: borrowerUser._id,
          penaltyKind: 'lost_dispute',
          note: 'Initial care decision: full deposit to lender for chain guide damage',
        },
        appeal: {
          appealedById: borrowerUser._id,
          reason: 'Photo metadata shows chain guide damage existed prior to pickup',
          status: 'pending',
          createdAt: new Date(),
        },
      });
    });

    it('GET /v1/admin/appeals returns pending appeals with populated item title, care decision, and requester role', async () => {
      const res = await request(app)
        .get('/v1/admin/appeals?status=pending')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.appeals).toBeInstanceOf(Array);
      expect(res.body.appeals.length).toBeGreaterThanOrEqual(1);

      const found = res.body.appeals.find((a) => a._id === mockDispute._id.toString());
      expect(found).toBeDefined();
      expect(found.itemTitle).toBe('Pro Stihl Chainsaw');
      expect(found.originalCareDecision.depositToLenderPaise).toBe(2000_00);
      expect(found.appeal.requesterRole).toBe('borrower');
      expect(found.appeal.status).toBe('pending');
      expect(found.appeal.reason).toContain('Photo metadata shows');
    });
  });

  describe('Conflict of Interest & No-Show Guards', () => {
    let conflictDispute;
    let noShowDispute;

    beforeAll(async () => {
      const b1 = await Booking.create({
        itemId: testItem._id,
        borrowerId: borrowerUser._id,
        lenderId: lenderUser._id,
        startDate: '2026-05-10',
        endDate: '2026-05-12',
        days: 2,
        dueAt: new Date('2026-05-12T20:00:00Z'),
        expiresAt: new Date('2026-05-13T00:00:00Z'),
        rentPaise: 1000_00,
        depositPaise: 2000_00,
        status: 'completed',
      });

      conflictDispute = await Dispute.create({
        bookingId: b1._id,
        disputeReason: 'condition_mismatch',
        source: 'user',
        openedById: borrowerUser._id,
        againstUserId: lenderUser._id,
        status: 'appealed',
        decision: {
          decidedById: conflictAdminUser._id,
          decidedAt: new Date(),
          depositToLenderPaise: 0,
          depositToBorrowerPaise: 2000_00,
          appliedLateChargePaise: 0,
          rentOutcome: 'lender',
          penaltyKind: 'none',
          note: 'Original decision by conflictAdminUser',
        },
        appeal: {
          appealedById: lenderUser._id,
          reason: 'Lender appeals rent deduction',
          status: 'pending',
        },
      });

      // No show dispute
      const b2 = await Booking.create({
        itemId: testItem._id,
        borrowerId: borrowerUser._id,
        lenderId: lenderUser._id,
        startDate: '2026-05-20',
        endDate: '2026-05-22',
        days: 2,
        dueAt: new Date('2026-05-22T20:00:00Z'),
        expiresAt: new Date('2026-05-23T00:00:00Z'),
        rentPaise: 800_00,
        depositPaise: 1500_00,
        status: 'cancelled',
      });

      noShowDispute = await Dispute.create({
        bookingId: b2._id,
        disputeReason: 'no_show',
        source: 'user',
        openedById: borrowerUser._id,
        againstUserId: lenderUser._id,
        status: 'appealed',
        decision: {
          decidedById: new mongoose.Types.ObjectId(),
          decidedAt: new Date(),
          depositToLenderPaise: 0,
          depositToBorrowerPaise: 1500_00,
          appliedLateChargePaise: 0,
          rentOutcome: 'refund_borrower',
          penaltyKind: 'no_show',
          faultUserId: lenderUser._id,
          note: 'Lender failed to appear at designated handover location',
        },
        appeal: {
          appealedById: lenderUser._id,
          reason: 'Lender claims had emergency and was 10 mins late',
          status: 'pending',
        },
      });
    });

    it('refuses decision with 403 CONFLICT_OF_INTEREST if deciding admin made original care decision', async () => {
      const res = await request(app)
        .post(`/v1/admin/appeals/${conflictDispute._id}/decide`)
        .set('Authorization', `Bearer ${conflictAdminToken}`) // decider is the original care agent
        .set('Idempotency-Key', 'conflict_attempt_1')
        .send({
          decision: 'upheld',
          note: 'Deciding my own previous care decision is prohibited by policy',
        });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('CONFLICT_OF_INTEREST');
    });

    it('enforces full refund rule on no_show disputes when overturning (DISPUTE_DECISION_INVALID)', async () => {
      const res = await request(app)
        .post(`/v1/admin/appeals/${noShowDispute._id}/preview`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          revisedDecision: {
            rentOutcome: 'lender', // Invalid for no-show! Must remain refund_borrower
            depositToLenderPaise: 500_00, // Invalid! Must remain 0
            depositToBorrowerPaise: 1000_00,
            penaltyKind: 'none',
          },
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('DISPUTE_DECISION_INVALID');
      expect(res.body.error.message).toContain('No-show dispute requires full refund');
    });
  });

  describe('Preview Endpoint & Shortfall Calculation', () => {
    let damageDispute;

    beforeAll(async () => {
      const booking = await Booking.create({
        itemId: testItem._id,
        borrowerId: borrowerUser._id,
        lenderId: lenderUser._id,
        startDate: '2026-06-01',
        endDate: '2026-06-03',
        days: 2,
        dueAt: new Date('2026-06-03T20:00:00Z'),
        expiresAt: new Date('2026-06-04T00:00:00Z'),
        rentPaise: 1000_00,
        depositPaise: 2000_00,
        status: 'completed',
      });

      // Original settlement: Lender got full deposit (2000_00) + rent (850_00 net)
      damageDispute = await Dispute.create({
        bookingId: booking._id,
        disputeReason: 'damage',
        source: 'user',
        openedById: lenderUser._id,
        againstUserId: borrowerUser._id,
        status: 'appealed',
        decision: {
          decidedById: new mongoose.Types.ObjectId(),
          decidedAt: new Date(),
          depositToLenderPaise: 2000_00,
          depositToBorrowerPaise: 0,
          appliedLateChargePaise: 0,
          rentOutcome: 'lender',
          faultUserId: borrowerUser._id,
          penaltyKind: 'lost_dispute',
          note: 'Full deposit to lender',
        },
        appeal: {
          appealedById: borrowerUser._id,
          reason: 'Pre-existing damage verified by timestamped handover photos',
          status: 'pending',
        },
      });
    });

    it('POST /v1/admin/appeals/:id/preview calculates delta movements and detects shortfall when wallet available is insufficient', async () => {
      // Overturning: Borrower gets 100% deposit back (2000_00)
      // Lender delta is -2000_00. But lender only has 100_00 available!
      // Unrecovered amount = 1900_00. Borrower would gain 2000_00.
      // Shortfall is charged against borrower credit.
      const res = await request(app)
        .post(`/v1/admin/appeals/${damageDispute._id}/preview`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          revisedDecision: {
            depositToLenderPaise: 0,
            depositToBorrowerPaise: 2000_00,
            rentOutcome: 'lender',
            faultUserId: null,
            penaltyKind: 'none',
          },
        });

      expect(res.status).toBe(200);
      expect(res.body.deltas.borrower).toBe(2000_00);
      expect(res.body.deltas.lender).toBe(-2000_00);
      expect(res.body.deltas.platform).toBe(0);

      // Shortfall detected: Lender only had 100_00 available, so unrecovered = 1900_00
      expect(res.body.shortfall.amountPaise).toBe(1900_00);
      expect(res.body.shortfall.party).toBe('borrower');
      expect(res.body.shortfall.acknowledgeRequired).toBe(true);

      // Effective credit for borrower is 2000_00 - 1900_00 = 100_00
      expect(res.body.effectiveDeltas.borrower).toBe(100_00);
      expect(res.body.effectiveDeltas.lender).toBe(-100_00);

      // Invariant: Zero-sum holds on effective deltas
      expect(
        res.body.effectiveDeltas.borrower +
          res.body.effectiveDeltas.lender +
          res.body.effectiveDeltas.platform,
      ).toBe(0);
    });
  });

  describe('Appeal Decision (Upheld & Overturned)', () => {
    let upheldDispute;
    let overturnDispute;
    let overturnBooking;

    beforeAll(async () => {
      // Seed dispute for Upheld
      const b1 = await Booking.create({
        itemId: testItem._id,
        borrowerId: borrowerUser._id,
        lenderId: lenderUser._id,
        startDate: '2026-06-10',
        endDate: '2026-06-12',
        days: 2,
        dueAt: new Date('2026-06-12T20:00:00Z'),
        expiresAt: new Date('2026-06-13T00:00:00Z'),
        rentPaise: 1000_00,
        depositPaise: 2000_00,
        status: 'completed',
      });

      upheldDispute = await Dispute.create({
        bookingId: b1._id,
        disputeReason: 'not_returned',
        source: 'user',
        openedById: lenderUser._id,
        againstUserId: borrowerUser._id,
        status: 'appealed',
        decision: {
          decidedById: new mongoose.Types.ObjectId(),
          decidedAt: new Date(),
          depositToLenderPaise: 500_00,
          depositToBorrowerPaise: 1500_00,
          appliedLateChargePaise: 0,
          rentOutcome: 'lender',
          penaltyKind: 'none',
          note: 'Late charge penalty verified by GPS timestamp',
        },
        appeal: {
          appealedById: borrowerUser._id,
          reason: 'Borrower claims traffic delay beyond control',
          status: 'pending',
        },
      });

      // Seed dispute for Overturn with penalty correction
      overturnBooking = await Booking.create({
        itemId: testItem._id,
        borrowerId: borrowerUser._id,
        lenderId: lenderUser._id,
        startDate: '2026-06-15',
        endDate: '2026-06-17',
        days: 2,
        dueAt: new Date('2026-06-17T20:00:00Z'),
        expiresAt: new Date('2026-06-18T00:00:00Z'),
        rentPaise: 1000_00,
        depositPaise: 2000_00,
        status: 'completed',
      });

      overturnDispute = await Dispute.create({
        bookingId: overturnBooking._id,
        disputeReason: 'damage',
        source: 'user',
        openedById: lenderUser._id,
        againstUserId: borrowerUser._id,
        status: 'appealed',
        decision: {
          decidedById: new mongoose.Types.ObjectId(),
          decidedAt: new Date(),
          depositToLenderPaise: 2000_00,
          depositToBorrowerPaise: 0,
          appliedLateChargePaise: 0,
          rentOutcome: 'lender',
          faultUserId: borrowerUser._id,
          penaltyKind: 'lost_dispute',
          note: 'Initial care decision: full deposit and strike to borrower',
        },
        appeal: {
          appealedById: borrowerUser._id,
          reason: 'Conclusive evidence of pre-existing crack on chainsaw casing',
          status: 'pending',
        },
      });

      // Seed initial trust event for the dispute penalty
      await TrustEvent.create({
        userId: borrowerUser._id,
        type: 'lost_dispute',
        bookingId: overturnBooking._id,
        eventKey: `trust_lost_dispute_${overturnDispute._id}`,
        meta: { disputeId: overturnDispute._id },
      });
    });

    it('upheld decision: care decision stands, no money moves, dispute closed, audit recorded', async () => {
      const res = await request(app)
        .post(`/v1/admin/appeals/${upheldDispute._id}/decide`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('Idempotency-Key', `upheld_decide_${Date.now()}`)
        .send({
          decision: 'upheld',
          note: 'Review confirms borrower handover was 3 hours late without prior notice.',
        });

      expect(res.status).toBe(200);
      expect(res.body.appealStatus).toBe('upheld');

      const d = await Dispute.findById(upheldDispute._id);
      expect(d.status).toBe('closed');
      expect(d.appeal.status).toBe('upheld');
      expect(d.appeal.note).toContain('3 hours late');

      // Verify zero ledger entries created
      const entries = await LedgerEntry.find({ bookingId: upheldDispute.bookingId });
      expect(entries.length).toBe(0);

      // Verify audit log
      const audit = await AuditLog.findOne({
        action: 'appeal_decided',
        targetId: upheldDispute._id.toString(),
      });
      expect(audit).toBeDefined();
      expect(audit.after.appealStatus).toBe('upheld');

      // Verify notification
      const notif = await Notification.findOne({
        userId: borrowerUser._id,
        type: 'appeal_decided',
      });
      expect(notif).toBeDefined();
    });

    it('refuses overturning appeal with unacknowledged shortfall (400 APPEAL_SHORTFALL_NOT_ACKNOWLEDGED)', async () => {
      const res = await request(app)
        .post(`/v1/admin/appeals/${overturnDispute._id}/decide`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('Idempotency-Key', `refused_overturn_${Date.now()}`)
        .send({
          decision: 'overturned',
          note: 'Overturning decision upon inspection of photographic evidence',
          revisedDecision: {
            depositToLenderPaise: 0,
            depositToBorrowerPaise: 2000_00,
            rentOutcome: 'lender',
            faultUserId: null,
            penaltyKind: 'none',
          },
          acknowledgeShortfall: false, // Fails because lender only has 100_00 available!
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('APPEAL_SHORTFALL_NOT_ACKNOWLEDGED');
      expect(res.body.error.details.unrecoveredPaise).toBeGreaterThan(0);
    });

    it('overturned decision: executes double-entry reversal, caps debit at available, adjusts penalties/strikes, and writes audit', async () => {
      // Borrower wallet before: 500_00.
      // Lender wallet before: 100_00.
      // Shortfall unrecovered from lender is 1900_00.
      // Lender debited 100_00 (lender wallet becomes 0).
      // Borrower credited 100_00 (2000_00 - 1900_00) (borrower wallet becomes 600_00).
      // Platform commission change: 0.
      const res = await request(app)
        .post(`/v1/admin/appeals/${overturnDispute._id}/decide`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('Idempotency-Key', `overturn_acknowledged_${Date.now()}`)
        .send({
          decision: 'overturned',
          note: 'Handover photos confirm damage pre-existed. Full deposit awarded to borrower.',
          revisedDecision: {
            depositToLenderPaise: 0,
            depositToBorrowerPaise: 2000_00,
            rentOutcome: 'lender',
            faultUserId: lenderUser._id,
            penaltyKind: 'rejected_damage_claim', // Lender penalized for false damage claim
          },
          acknowledgeShortfall: true,
        });

      expect(res.status).toBe(200);
      expect(res.body.appealStatus).toBe('overturned');
      expect(res.body.unrecoveredPaise).toBe(1900_00);
      expect(res.body.deltas.borrower).toBe(100_00);
      expect(res.body.deltas.lender).toBe(-100_00);

      // Verify Dispute status
      const updatedDispute = await Dispute.findById(overturnDispute._id);
      expect(updatedDispute.status).toBe('closed');
      expect(updatedDispute.appeal.status).toBe('overturned');
      expect(updatedDispute.appeal.unrecoveredPaise).toBe(1900_00);

      // Verify Wallets: no wallet negative invariant
      const updatedBorrowerWallet = await Wallet.findOne({ userId: borrowerUser._id });
      const updatedLenderWallet = await Wallet.findOne({ userId: lenderUser._id });
      expect(updatedBorrowerWallet.availablePaise).toBe(600_00);
      expect(updatedLenderWallet.availablePaise).toBe(0); // Capped at available, never negative

      // Verify Ledger Entries
      const reversalEntries = await LedgerEntry.find({
        bookingId: overturnBooking._id,
        type: 'appeal_reversal',
      });
      expect(reversalEntries.length).toBe(2);
      const sum = reversalEntries.reduce((acc, e) => acc + e.amountPaise, 0);
      expect(sum).toBe(0); // Strict double-entry zero sum invariant

      // Verify Penalty Correction: Strike reversed for borrower
      const updatedBorrower = await User.findById(borrowerUser._id);
      expect(updatedBorrower.strikes).toBe(0); // Strike 1 reversed back to 0

      // Verify Trust Event reversed: penalty_reversed event written
      const revTrustEvent = await TrustEvent.findOne({
        userId: borrowerUser._id,
        type: 'penalty_reversed',
      });
      expect(revTrustEvent).toBeDefined();
      expect(revTrustEvent.meta.reverses).toBe(`trust_lost_dispute_${overturnDispute._id}`);

      // Verify Revised Trust Event applied to lender
      const lenderTrustEvent = await TrustEvent.findOne({
        userId: lenderUser._id,
        type: 'rejected_damage_claim',
      });
      expect(lenderTrustEvent).toBeDefined();

      // Verify Audit Log row
      const audit = await AuditLog.findOne({
        action: 'appeal_decided',
        targetId: overturnDispute._id.toString(),
      });
      expect(audit).toBeDefined();
      expect(audit.after.appealStatus).toBe('overturned');
      expect(audit.after.unrecoveredPaise).toBe(1900_00);
    });
  });
});
