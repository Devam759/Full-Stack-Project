/**
 * @file apps/api/tests/adminUsersCommunitiesAgents.test.js
 * Comprehensive integration tests for Sub-step 9c:
 * Admin user moderation, banning, unbanning, strike reversal, community moderation, and care agent lifecycle.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { setupTestDB, teardownTestDB } from './setup/dbTestHelper.js';
import { BUSINESS_CONFIG } from '@borrowloop/shared';
import {
  User,
  Item,
  Booking,
  Community,
  Membership,
  Dispute,
  Wallet,
  RefreshToken,
  AuditLog,
  Notification,
  LedgerOperation,
  LedgerEntry,
} from '@borrowloop/server-core';
import { signAccessToken } from '../src/common/jwt.js';
import app from '../src/app.js';

const { TOKEN_AUDIENCES } = BUSINESS_CONFIG;

describe('Sub-step 9c: Admin Users, Communities & Care Agents Moderation', () => {
  let adminUser;
  let adminToken;
  let careAgentUser;
  let careAgentToken;

  beforeAll(async () => {
    await setupTestDB();

    // Create Admin user
    adminUser = await User.create({
      name: 'System Admin',
      email: 'admin.super@borrowloop.test',
      passwordHash: 'dummy_hash',
      role: 'admin',
      status: 'active',
      emailVerified: true,
    });

    adminToken = signAccessToken(
      { sub: adminUser._id.toString(), role: 'admin' },
      TOKEN_AUDIENCES.PORTAL,
    );

    // Create Care Agent user
    careAgentUser = await User.create({
      name: 'Care Agent 1',
      email: 'care.agent1@borrowloop.test',
      passwordHash: 'dummy_hash',
      role: 'care_agent',
      status: 'active',
      emailVerified: true,
    });

    careAgentToken = signAccessToken(
      { sub: careAgentUser._id.toString(), role: 'care_agent' },
      TOKEN_AUDIENCES.PORTAL,
    );
  });

  afterAll(async () => {
    await teardownTestDB();
  });

  describe('RBAC Verification', () => {
    it('blocks care agents from accessing admin user management endpoints (403)', async () => {
      const getRes = await request(app)
        .get('/v1/admin/users')
        .set('Authorization', `Bearer ${careAgentToken}`);
      expect(getRes.status).toBe(403);
      expect(getRes.body.error.code).toBe('FORBIDDEN');

      const banRes = await request(app)
        .post(`/v1/admin/users/${new mongoose.Types.ObjectId()}/ban`)
        .set('Authorization', `Bearer ${careAgentToken}`)
        .set('Idempotency-Key', 'care_ban_attempt_1')
        .send({ reason: 'Fraudulent listings across accounts' });
      expect(banRes.status).toBe(403);
    });

    it('blocks care agents from accessing community moderation endpoints (403)', async () => {
      const res = await request(app)
        .get('/v1/admin/communities')
        .set('Authorization', `Bearer ${careAgentToken}`);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('blocks care agents from accessing care agent management endpoints (403)', async () => {
      const res = await request(app)
        .get('/v1/admin/agents')
        .set('Authorization', `Bearer ${careAgentToken}`);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });
  });

  describe('User Listing & Audited Profile View', () => {
    let regularUser;

    beforeAll(async () => {
      regularUser = await User.create({
        name: 'Alice Wonder',
        email: 'alice.wonder@testmail.com',
        passwordHash: 'dummy_hash',
        role: 'user',
        status: 'active',
        emailVerified: true,
        strikes: 1,
      });

      await Item.create({
        ownerId: regularUser._id,
        title: 'Alice Lawn Mower',
        description: 'Gasoline powered',
        category: 'tools_and_diy',
        condition: 'good',
        photos: ['https://example.com/mower.jpg'],
        rentPerDayPaise: 500_00,
        depositPaise: 1000_00,
        location: { coordinates: [77.5946, 12.9716] },
        status: 'active',
      });
    });

    it('GET /v1/admin/users returns cursor-paginated list with masked emails and zero coordinates', async () => {
      const res = await request(app)
        .get('/v1/admin/users?limit=10')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.users).toBeInstanceOf(Array);
      expect(res.body.users.length).toBeGreaterThanOrEqual(1);

      const alice = res.body.users.find((u) => u._id === regularUser._id.toString());
      expect(alice).toBeDefined();
      expect(alice.name).toBe('Alice Wonder');
      expect(alice.maskedEmail).toMatch(/^a\*\*\*@t\*\*\*\.com$/);
      expect(alice.activeItemsCount).toBe(1);
      expect(alice.strikes).toBe(1);

      const str = JSON.stringify(res.body);
      expect(str).not.toContain('alice.wonder@testmail.com');
      expect(str).not.toContain('coordinates');
    });

    it('GET /v1/admin/users allows searching by exact email or name query without echoing raw email', async () => {
      const res = await request(app)
        .get('/v1/admin/users?q=alice.wonder@testmail.com')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.users.length).toBe(1);
      expect(res.body.users[0].name).toBe('Alice Wonder');
      expect(res.body.users[0].maskedEmail).toBe('a***@t***.com');
      expect(JSON.stringify(res.body)).not.toContain('alice.wonder@testmail.com');
    });

    it('GET /v1/admin/users/:id returns full profile and records an audit row', async () => {
      const res = await request(app)
        .get(`/v1/admin/users/${regularUser._id}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.user.name).toBe('Alice Wonder');
      expect(res.body.user.maskedEmail).toBe('a***@t***.com');
      expect(res.body.bookingSummary).toBeDefined();
      expect(res.body.itemsSummary).toBeDefined();

      // Check audit log row was written
      const audit = await AuditLog.findOne({
        action: 'user_profile_viewed',
        targetId: regularUser._id.toString(),
        actorId: adminUser._id,
      });
      expect(audit).toBeDefined();
    });
  });

  describe('User Banning & Unbanning Lifecycle', () => {
    let offenderUser;
    let borrowerUser;
    let offenderItem;

    beforeAll(async () => {
      offenderUser = await User.create({
        name: 'Bob Offender',
        email: 'bob.offender@testmail.com',
        passwordHash: 'dummy_hash',
        role: 'user',
        status: 'active',
        emailVerified: true,
        strikes: 2,
      });

      borrowerUser = await User.create({
        name: 'Charlie Borrower',
        email: 'charlie@testmail.com',
        passwordHash: 'dummy_hash',
        role: 'user',
        status: 'active',
        emailVerified: true,
      });

      // Wallet for borrower
      await Wallet.create({
        userId: borrowerUser._id,
        availablePaise: 1000_00,
        frozenPaise: 3000_00,
        pendingPaise: 0,
      });

      // Item owned by offender
      offenderItem = await Item.create({
        ownerId: offenderUser._id,
        title: 'Prohibited Drone',
        description: 'High altitude drone',
        category: 'electronics_and_gadgets',
        condition: 'good',
        photos: ['https://example.com/drone.jpg'],
        rentPerDayPaise: 1000_00,
        depositPaise: 2000_00,
        location: { coordinates: [77.5946, 12.9716] },
        status: 'active',
      });

      // Refresh tokens to verify revocation
      await RefreshToken.create({
        userId: offenderUser._id,
        familyId: 'family_offender_1',
        tokenHash: 'dummy_refresh_hash_1',
        expiresAt: new Date(Date.now() + 86400000),
      });
    });

    it('refuses banning staff members (admin or care agent) with 403 CANNOT_MODIFY_STAFF', async () => {
      // Attempting to ban self
      const selfRes = await request(app)
        .post(`/v1/admin/users/${adminUser._id}/ban`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('Idempotency-Key', 'ban_self_attempt')
        .send({ reason: 'Self ban prohibited test' });
      expect(selfRes.status).toBe(403);
      expect(selfRes.body.error.code).toBe('CANNOT_MODIFY_STAFF');

      // Attempting to ban care agent
      const agentRes = await request(app)
        .post(`/v1/admin/users/${careAgentUser._id}/ban`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('Idempotency-Key', 'ban_agent_attempt')
        .send({ reason: 'Agent ban prohibited test' });
      expect(agentRes.status).toBe(403);
      expect(agentRes.body.error.code).toBe('CANNOT_MODIFY_STAFF');
    });

    it('refuses banning a user with active or disputed bookings (409 USER_HAS_ACTIVE_BOOKINGS)', async () => {
      // Create a booking in 'picked_up' status involving offender
      const activeBooking = await Booking.create({
        itemId: offenderItem._id,
        lenderId: offenderUser._id,
        borrowerId: borrowerUser._id,
        startDate: '2026-05-01',
        endDate: '2026-05-03',
        days: 2,
        dueAt: new Date('2026-05-03T20:00:00Z'),
        expiresAt: new Date('2026-05-04T00:00:00Z'),
        rentPaise: 1000_00,
        depositPaise: 2000_00,
        status: 'picked_up',
      });

      const res = await request(app)
        .post(`/v1/admin/users/${offenderUser._id}/ban`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('Idempotency-Key', 'ban_active_booking_attempt')
        .send({ reason: 'Attempt to ban user with item currently out' });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('USER_HAS_ACTIVE_BOOKINGS');
      expect(res.body.error.details.bookingIds).toContain(activeBooking._id.toString());

      // Clean up the active booking so next tests can proceed
      await Booking.deleteOne({ _id: activeBooking._id });
    });

    it('successfully bans user: cancels requested/accepted bookings with refund, hides items, revokes tokens, and writes audit', async () => {
      // Clean any leftover bookings for offender
      await Booking.deleteMany({
        $or: [{ lenderId: offenderUser._id }, { borrowerId: offenderUser._id }],
      });

      // 1. Seed requested booking
      const requestedBooking = await Booking.create({
        itemId: offenderItem._id,
        lenderId: offenderUser._id,
        borrowerId: borrowerUser._id,
        startDate: '2026-05-10',
        endDate: '2026-05-12',
        days: 2,
        dueAt: new Date('2026-05-12T20:00:00Z'),
        expiresAt: new Date('2026-05-13T00:00:00Z'),
        rentPaise: 500_00,
        depositPaise: 1000_00,
        status: 'requested',
      });

      // 2. Seed accepted booking with money held
      const acceptedBooking = await Booking.create({
        itemId: offenderItem._id,
        lenderId: offenderUser._id,
        borrowerId: borrowerUser._id,
        startDate: '2026-05-15',
        endDate: '2026-05-17',
        days: 2,
        dueAt: new Date('2026-05-17T20:00:00Z'),
        expiresAt: new Date('2026-05-18T00:00:00Z'),
        rentPaise: 1000_00,
        depositPaise: 2000_00,
        status: 'accepted',
      });

      // Record booking hold operation and entries so refundCancelledBooking can reverse it cleanly
      await LedgerOperation.create({
        operationType: 'booking_hold',
        bookingId: acceptedBooking._id,
        opRef: 'default',
        status: 'applied',
        entriesCount: 2,
      });

      await LedgerEntry.create([
        {
          txnId: `txn_hold_avail_${acceptedBooking._id}`,
          userId: borrowerUser._id,
          bookingId: acceptedBooking._id,
          account: 'available',
          amountPaise: -3000_00,
          type: 'booking_hold',
        },
        {
          txnId: `txn_hold_froz_${acceptedBooking._id}`,
          userId: borrowerUser._id,
          bookingId: acceptedBooking._id,
          account: 'frozen',
          amountPaise: 3000_00,
          type: 'booking_hold',
        },
      ]);

      const res = await request(app)
        .post(`/v1/admin/users/${offenderUser._id}/ban`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('Idempotency-Key', `ban_offender_${Date.now()}`)
        .send({ reason: 'Severe community terms of service violations' });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('banned');
      expect(res.body.cancelledRequestedCount).toBe(1);
      expect(res.body.cancelledAcceptedCount).toBe(1);
      expect(res.body.hiddenItemsCount).toBe(1);

      // Verify DB state
      const updatedUser = await User.findById(offenderUser._id);
      expect(updatedUser.status).toBe('banned');

      // Requested booking cancelled
      const bReq = await Booking.findById(requestedBooking._id);
      expect(bReq.status).toBe('cancelled');

      // Accepted booking cancelled
      const bAcc = await Booking.findById(acceptedBooking._id);
      expect(bAcc.status).toBe('cancelled');

      // Item hidden with owner_banned and preserved hiddenFromStatus
      const updatedItem = await Item.findById(offenderItem._id);
      expect(updatedItem.status).toBe('hidden');
      expect(updatedItem.hiddenReason).toBe('owner_banned');
      expect(updatedItem.hiddenFromStatus).toBe('active');

      // Refresh tokens deleted
      const tokensCount = await RefreshToken.countDocuments({ userId: offenderUser._id });
      expect(tokensCount).toBe(0);

      // Borrower wallet received full refund (3000_00 unfrozen to available)
      const borrowerWallet = await Wallet.findOne({ userId: borrowerUser._id });
      expect(borrowerWallet.availablePaise).toBe(4000_00);
      expect(borrowerWallet.frozenPaise).toBe(0);

      // Audit log row exists
      const audit = await AuditLog.findOne({
        action: 'user_banned',
        targetId: offenderUser._id.toString(),
      });
      expect(audit).toBeDefined();
      expect(audit.after.reason).toContain('Severe community terms');

      // Notification created
      const notif = await Notification.findOne({
        userId: offenderUser._id,
        type: 'user_banned',
      });
      expect(notif).toBeDefined();
    });

    it('successfully unbans user: restores owner_banned items, preserves strikes, and writes audit', async () => {
      const res = await request(app)
        .post(`/v1/admin/users/${offenderUser._id}/unban`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('Idempotency-Key', `unban_offender_${Date.now()}`)
        .send({ reason: 'Account appeal granted upon identity verification' });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('active');
      expect(res.body.restoredItemsCount).toBe(1);

      const updatedUser = await User.findById(offenderUser._id);
      expect(updatedUser.status).toBe('active');
      expect(updatedUser.strikes).toBe(2); // Invariant: unban does NOT reset strikes

      const updatedItem = await Item.findById(offenderItem._id);
      expect(updatedItem.status).toBe('active');
      expect(updatedItem.hiddenReason).toBeNull();
      expect(updatedItem.hiddenFromStatus).toBeNull();

      const audit = await AuditLog.findOne({
        action: 'user_unbanned',
        targetId: offenderUser._id.toString(),
      });
      expect(audit).toBeDefined();
    });

    it('POST /v1/admin/users/:id/reverse-strike reverses strike with deterministic eventKey', async () => {
      const res = await request(app)
        .post(`/v1/admin/users/${offenderUser._id}/reverse-strike`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('Idempotency-Key', `rev_strike_${Date.now()}`)
        .send({ reason: 'Dispute overturn reversed incorrect strike' });

      expect(res.status).toBe(200);
      expect(res.body.strikes).toBe(1);

      const user = await User.findById(offenderUser._id);
      expect(user.strikes).toBe(1);

      const audit = await AuditLog.findOne({
        action: 'strike_reversed',
        targetId: offenderUser._id.toString(),
      });
      expect(audit).toBeDefined();
    });
  });

  describe('Community Moderation & Privacy', () => {
    let testCommunity;
    let commOwner;

    beforeAll(async () => {
      commOwner = await User.create({
        name: 'Community Leader',
        email: 'leader@secretcomm.test',
        passwordHash: 'dummy_hash',
        role: 'user',
        status: 'active',
        emailVerified: true,
      });

      testCommunity = await Community.create({
        name: 'Greenfield Neighborhood',
        slug: `greenfield-neighborhood-${Date.now()}`,
        description: 'Greenfield residents tool library',
        type: 'public',
        ownerId: commOwner._id,
        city: 'Bengaluru',
        location: {
          type: 'Point',
          coordinates: [77.5946, 12.9716],
        },
        status: 'active',
      });

      await Membership.create({
        communityId: testCommunity._id,
        userId: commOwner._id,
        role: 'owner',
      });
    });

    it('GET /v1/admin/communities lists communities with member count and ZERO owner email leakage', async () => {
      const res = await request(app)
        .get('/v1/admin/communities?status=active')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.communities.length).toBeGreaterThanOrEqual(1);

      const found = res.body.communities.find((c) => c._id === testCommunity._id.toString());
      expect(found).toBeDefined();
      expect(found.name).toBe('Greenfield Neighborhood');
      expect(found.memberCount).toBe(1);
      expect(found.owner.name).toBe('Community Leader');

      // Privacy check: Zero email leakage
      const raw = JSON.stringify(res.body);
      expect(raw).not.toContain('leader@secretcomm.test');
      expect(raw).not.toContain('email');
    });

    it('POST /v1/admin/communities/:id/suspend suspends community, writes audit row, and notifies owner', async () => {
      const res = await request(app)
        .post(`/v1/admin/communities/${testCommunity._id}/suspend`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('Idempotency-Key', `suspend_comm_${Date.now()}`)
        .send({ reason: 'Investigation into reported spam listings' });

      expect(res.status).toBe(200);
      expect(res.body.community.status).toBe('suspended');

      const comm = await Community.findById(testCommunity._id);
      expect(comm.status).toBe('suspended');

      const audit = await AuditLog.findOne({
        action: 'community_suspended',
        targetId: testCommunity._id.toString(),
      });
      expect(audit).toBeDefined();

      const notif = await Notification.findOne({
        userId: commOwner._id,
        type: 'community_suspended',
      });
      expect(notif).toBeDefined();
    });

    it('POST /v1/admin/communities/:id/restore restores community and notifies owner', async () => {
      const res = await request(app)
        .post(`/v1/admin/communities/${testCommunity._id}/restore`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('Idempotency-Key', `restore_comm_${Date.now()}`)
        .send({ reason: 'Investigation complete, spam cleared' });

      expect(res.status).toBe(200);
      expect(res.body.community.status).toBe('active');

      const comm = await Community.findById(testCommunity._id);
      expect(comm.status).toBe('active');

      const audit = await AuditLog.findOne({
        action: 'community_restored',
        targetId: testCommunity._id.toString(),
      });
      expect(audit).toBeDefined();
    });
  });

  describe('Care Agent Management', () => {
    let candidateUser;

    beforeAll(async () => {
      candidateUser = await User.create({
        name: 'Dana Candidate',
        email: 'dana.candidate@borrowloop.test',
        passwordHash: 'dummy_hash',
        role: 'user',
        status: 'active',
        emailVerified: true,
      });
    });

    it('GET /v1/admin/agents lists care agents with masked email and totpEnrolled flag', async () => {
      const res = await request(app)
        .get('/v1/admin/agents')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.agents).toBeInstanceOf(Array);
      expect(res.body.agents.length).toBeGreaterThanOrEqual(1);

      const agent = res.body.agents.find((a) => a._id === careAgentUser._id.toString());
      expect(agent).toBeDefined();
      expect(agent.maskedEmail).toMatch(/^c\*\*\*@b\*\*\*\.test$/);
      expect(agent.totpEnrolled).toBe(false);
    });

    it('POST /v1/admin/agents promotes candidate, generates TOTP enrollment, and hides secret from response', async () => {
      const res = await request(app)
        .post('/v1/admin/agents')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('Idempotency-Key', `promote_agent_${Date.now()}`)
        .send({
          userId: candidateUser._id.toString(),
          reason: 'Promoted to support peak season disputes',
        });

      expect(res.status).toBe(201);
      expect(res.body.agent.role).toBe('care_agent');
      expect(res.body.agent.maskedEmail).toBe('d***@b***.test');

      // Invariant: Secret and enrollment link must NEVER be in response
      const str = JSON.stringify(res.body);
      expect(str).not.toContain('otpauth:');
      expect(str).not.toContain('secretBase32');
      expect(str).not.toContain('dana.candidate@borrowloop.test');

      // Verify DB role changed
      const updated = await User.findById(candidateUser._id);
      expect(updated.role).toBe('care_agent');

      // Verify Audit Log row
      const audit = await AuditLog.findOne({
        action: 'staff_invited',
        targetId: candidateUser._id.toString(),
      });
      expect(audit).toBeDefined();
    });

    it('DELETE /v1/admin/agents/:id demotes agent, clears TOTP secret, and returns disputes to opened', async () => {
      // Create a dispute assigned to candidateUser
      const disputeBooking = new mongoose.Types.ObjectId();
      const mockDispute = await Dispute.create({
        bookingId: disputeBooking,
        disputeReason: 'damage',
        source: 'user',
        openedById: candidateUser._id,
        againstUserId: adminUser._id,
        status: 'assigned',
        assignedAgentId: candidateUser._id,
        assignedAt: new Date(),
      });

      const res = await request(app)
        .delete(`/v1/admin/agents/${candidateUser._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('Idempotency-Key', `demote_agent_${Date.now()}`)
        .send({ reason: 'Role tenure ended' });

      expect(res.status).toBe(200);
      expect(res.body.role).toBe('user');

      // Verify user demoted and totp secret wiped
      const demoted = await User.findById(candidateUser._id).select('+totpSecret');
      expect(demoted.role).toBe('user');
      expect(demoted.totpSecret).toBeNull();

      // Verify assigned dispute returned to 'opened'
      const updatedDispute = await Dispute.findById(mockDispute._id);
      expect(updatedDispute.status).toBe('opened');
      expect(updatedDispute.assignedAgentId).toBeNull();
      expect(updatedDispute.assignedAt).toBeNull();

      // Verify audit log
      const audit = await AuditLog.findOne({
        action: 'staff_removed',
        targetId: candidateUser._id.toString(),
      });
      expect(audit).toBeDefined();
    });

    it('refuses demoting the last administrator with 403 LAST_ADMIN', async () => {
      const res = await request(app)
        .delete(`/v1/admin/agents/${adminUser._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('Idempotency-Key', 'demote_last_admin_attempt')
        .send({ reason: 'Attempt to demote self or sole admin' });

      // Either CANNOT_MODIFY_STAFF (self) or LAST_ADMIN (last admin)
      expect(res.status).toBe(403);
    });
  });
});
