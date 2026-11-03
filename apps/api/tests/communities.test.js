import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import { setupTestDB, teardownTestDB, clearTestDB } from './setup/dbTestHelper.js';
import User from '../src/models/User.js';
import Community from '../src/models/Community.js';
import Membership from '../src/models/Membership.js';
import AuditLog from '../src/models/AuditLog.js';
import Block from '../src/models/Block.js';
import { hashPassword } from '../src/common/crypto.js';
import { signAccessToken } from '../src/common/jwt.js';
import { BUSINESS_CONFIG } from '@borrowloop/shared';

describe('Communities and Location (Phase 2)', () => {
  let ownerUser;
  let ownerToken;
  let memberUser;
  let memberToken;
  let adminUser;
  let adminPortalToken;

  beforeAll(async () => {
    await setupTestDB();
  }, 60000);

  afterAll(async () => {
    await teardownTestDB();
  });

  beforeEach(async () => {
    await clearTestDB();

    const passwordHash = await hashPassword('Password123!');

    // 1. Owner User
    ownerUser = await User.create({
      name: 'Owner Alice',
      email: 'owner@example.com',
      passwordHash,
      emailVerified: true,
      status: 'active',
      photoUrl: 'https://res.cloudinary.com/demo_cloud/image/upload/borrowloop/profiles/alice.jpg',
    });
    ownerToken = signAccessToken(
      { sub: ownerUser._id.toString(), role: 'user' },
      BUSINESS_CONFIG.TOKEN_AUDIENCES.USER,
    );

    // 2. Regular User
    memberUser = await User.create({
      name: 'Member Bob',
      email: 'bob@example.com',
      passwordHash,
      emailVerified: true,
      status: 'active',
      photoUrl: 'https://res.cloudinary.com/demo_cloud/image/upload/borrowloop/profiles/bob.jpg',
    });
    memberToken = signAccessToken(
      { sub: memberUser._id.toString(), role: 'user' },
      BUSINESS_CONFIG.TOKEN_AUDIENCES.USER,
    );

    // 3. Admin User
    adminUser = await User.create({
      name: 'Admin System',
      email: 'admin@borrowloop.test',
      passwordHash,
      role: 'admin',
      status: 'active',
      emailVerified: true,
    });
    adminPortalToken = signAccessToken(
      { sub: adminUser._id.toString(), role: 'admin' },
      BUSINESS_CONFIG.TOKEN_AUDIENCES.PORTAL,
    );
  });

  describe('Creation, Validation & Limits', () => {
    it('creates a community in a transaction, setting creator as active owner', async () => {
      const res = await request(app)
        .post('/v1/communities')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          name: 'Indiranagar Borrowers',
          description: 'A cozy neighborhood sharing circle.',
          type: 'public',
          city: 'Bengaluru',
          location: { type: 'Point', coordinates: [77.641234, 12.978912] },
        });

      expect(res.status).toBe(201);
      expect(res.body.community.name).toBe('Indiranagar Borrowers');
      expect(res.body.community.memberCount).toBe(1);
      // Coordinates rounded to 2 decimals (~1.1 km)
      expect(res.body.community.location.coordinates).toEqual([77.64, 12.98]);

      const membership = await Membership.findOne({
        communityId: res.body.community._id,
        userId: ownerUser._id,
      });
      expect(membership).not.toBeNull();
      expect(membership.role).toBe('owner');
      expect(membership.status).toBe('active');
    });

    it('rejects reserved names and duplicate names', async () => {
      const reservedRes = await request(app)
        .post('/v1/communities')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          name: 'admin',
          type: 'public',
          city: 'Bengaluru',
          location: { type: 'Point', coordinates: [77.59, 12.97] },
        });
      expect(reservedRes.status).toBe(400);

      await request(app)
        .post('/v1/communities')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          name: 'Campus Circle',
          type: 'public',
          city: 'Bengaluru',
          location: { type: 'Point', coordinates: [77.59, 12.97] },
        });

      const duplicateRes = await request(app)
        .post('/v1/communities')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          name: 'campus circle', // Case-insensitive collision
          type: 'public',
          city: 'Bengaluru',
          location: { type: 'Point', coordinates: [77.59, 12.97] },
        });
      expect(duplicateRes.status).toBe(409);
    });
  });

  describe('Geospatial Query (2dsphere) & Privacy', () => {
    it('returns communities within radius sorted by distance with distance bands', async () => {
      // 1. Nearby (~1.5 km from [77.59, 12.97])
      await request(app)
        .post('/v1/communities')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          name: 'Central Bengaluru',
          type: 'public',
          city: 'Bengaluru',
          location: { type: 'Point', coordinates: [77.59, 12.98] },
        });

      // 2. Far away (~30 km away)
      await request(app)
        .post('/v1/communities')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          name: 'Distant Airport Loop',
          type: 'public',
          city: 'Bengaluru',
          location: { type: 'Point', coordinates: [77.71, 13.2] },
        });

      // Query within 10 km of [77.59, 12.97]
      const res = await request(app)
        .get('/v1/communities/nearby?lat=12.97&lng=77.59&radius=10000')
        .set('Authorization', `Bearer ${memberToken}`);

      expect(res.status).toBe(200);
      expect(res.body.communities).toHaveLength(1);
      expect(res.body.communities[0].name).toBe('Central Bengaluru');
      expect(res.body.communities[0]).toHaveProperty('distanceBand');
    });

    it('private communities hide description and exact location from non-members', async () => {
      const createRes = await request(app)
        .post('/v1/communities')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          name: 'Secret Society',
          description: 'Top secret hostel group.',
          type: 'private',
          city: 'Bengaluru',
          location: { type: 'Point', coordinates: [77.59, 12.97] },
        });

      const commId = createRes.body.community._id;

      // Outsider Bob inspects nearby
      const nearbyRes = await request(app)
        .get('/v1/communities/nearby?lat=12.97&lng=77.59')
        .set('Authorization', `Bearer ${memberToken}`);

      const secretInNearby = nearbyRes.body.communities.find((c) => c.id === commId);
      expect(secretInNearby).toBeDefined();
      expect(secretInNearby.name).toBe('Secret Society');
      expect(secretInNearby.description).toBeUndefined(); // Stripped
      expect(secretInNearby.location).toBeUndefined(); // Stripped

      // Outsider Bob inspects detail
      const detailRes = await request(app)
        .get(`/v1/communities/${commId}`)
        .set('Authorization', `Bearer ${memberToken}`);

      expect(detailRes.status).toBe(200);
      expect(detailRes.body.community.name).toBe('Secret Society');
      expect(detailRes.body.community.description).toBeUndefined();
    });
  });

  describe('Joining & Private Rules', () => {
    it('allows instant join on public community', async () => {
      const commRes = await request(app)
        .post('/v1/communities')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          name: 'Public Park Group',
          type: 'public',
          city: 'Bengaluru',
          location: { type: 'Point', coordinates: [77.59, 12.97] },
        });

      const commId = commRes.body.community._id;

      const joinRes = await request(app)
        .post(`/v1/communities/${commId}/join`)
        .set('Authorization', `Bearer ${memberToken}`);

      expect(joinRes.status).toBe(200);
      expect(joinRes.body.status).toBe('active');

      const updatedComm = await Community.findById(commId);
      expect(updatedComm.memberCount).toBe(2);
    });

    it('private community: instant join with valid invite code; pending request without code', async () => {
      const commRes = await request(app)
        .post('/v1/communities')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          name: 'Hostel Block A',
          type: 'private',
          city: 'Bengaluru',
          location: { type: 'Point', coordinates: [77.59, 12.97] },
        });

      const commId = commRes.body.community._id;
      const inviteCode = commRes.body.community.inviteCode;
      expect(inviteCode).toBeDefined();

      // Bob tries with wrong invite code
      const wrongCodeRes = await request(app)
        .post(`/v1/communities/${commId}/join`)
        .set('Authorization', `Bearer ${memberToken}`)
        .send({ inviteCode: 'WRONGCODE1' });
      expect(wrongCodeRes.status).toBe(403);

      // Bob requests to join without code -> creates pending request
      const reqRes = await request(app)
        .post(`/v1/communities/${commId}/join`)
        .set('Authorization', `Bearer ${memberToken}`);
      expect(reqRes.status).toBe(200);
      expect(reqRes.body.status).toBe('pending');

      // Owner approves Bob
      const approveRes = await request(app)
        .post(`/v1/communities/${commId}/requests/${memberUser._id}/approve`)
        .set('Authorization', `Bearer ${ownerToken}`);
      expect(approveRes.status).toBe(200);

      const commAfter = await Community.findById(commId);
      expect(commAfter.memberCount).toBe(2);
    });

    it('enforces 24-hour cooldown after owner rejection', async () => {
      const commRes = await request(app)
        .post('/v1/communities')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          name: 'Private Club',
          type: 'private',
          city: 'Bengaluru',
          location: { type: 'Point', coordinates: [77.59, 12.97] },
        });
      const commId = commRes.body.community._id;

      // Bob requests
      await request(app)
        .post(`/v1/communities/${commId}/join`)
        .set('Authorization', `Bearer ${memberToken}`);

      // Owner rejects
      await request(app)
        .post(`/v1/communities/${commId}/requests/${memberUser._id}/reject`)
        .set('Authorization', `Bearer ${ownerToken}`);

      // Bob tries to request again immediately -> blocked by 24h cooldown
      const retryRes = await request(app)
        .post(`/v1/communities/${commId}/join`)
        .set('Authorization', `Bearer ${memberToken}`);
      expect(retryRes.status).toBe(403);
      expect(retryRes.body.error.message).toContain('Please wait');
    });

    it('owner removal marks member removed and blocks self-rejoin', async () => {
      const commRes = await request(app)
        .post('/v1/communities')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          name: 'Neighbourhood Circle',
          type: 'public',
          city: 'Bengaluru',
          location: { type: 'Point', coordinates: [77.59, 12.97] },
        });
      const commId = commRes.body.community._id;

      // Bob joins
      await request(app)
        .post(`/v1/communities/${commId}/join`)
        .set('Authorization', `Bearer ${memberToken}`);

      // Owner removes Bob
      const removeRes = await request(app)
        .delete(`/v1/communities/${commId}/members/${memberUser._id}`)
        .set('Authorization', `Bearer ${ownerToken}`);
      expect(removeRes.status).toBe(200);

      // Bob attempts to rejoin -> strictly blocked
      const rejoinRes = await request(app)
        .post(`/v1/communities/${commId}/join`)
        .set('Authorization', `Bearer ${memberToken}`);
      expect(rejoinRes.status).toBe(403);
      expect(rejoinRes.body.error.message).toContain('removed by the community owner');
    });

    it('allows owner to transfer ownership to another active member', async () => {
      const commRes = await request(app)
        .post('/v1/communities')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          name: 'Handover Group',
          type: 'public',
          city: 'Bengaluru',
          location: { type: 'Point', coordinates: [77.59, 12.97] },
        });
      const commId = commRes.body.community._id;

      // Bob joins
      await request(app)
        .post(`/v1/communities/${commId}/join`)
        .set('Authorization', `Bearer ${memberToken}`);

      // Transfer to Bob
      const transferRes = await request(app)
        .post(`/v1/communities/${commId}/transfer-owner`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ newOwnerId: memberUser._id.toString() });
      expect(transferRes.status).toBe(200);

      const commUpdated = await Community.findById(commId);
      expect(commUpdated.ownerId.toString()).toBe(memberUser._id.toString());
    });
  });

  describe('Admin Suspension & Audit Log (Rule 10)', () => {
    it('admin suspends community using portal token and writes an audit log', async () => {
      const commRes = await request(app)
        .post('/v1/communities')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          name: 'Suspicious Group',
          type: 'public',
          city: 'Bengaluru',
          location: { type: 'Point', coordinates: [77.59, 12.97] },
        });
      const commId = commRes.body.community._id;

      // Admin suspends via portal
      const suspendRes = await request(app)
        .post(`/v1/admin/communities/${commId}/suspend`)
        .set('Authorization', `Bearer ${adminPortalToken}`);
      expect(suspendRes.status).toBe(200);

      const commInDb = await Community.findById(commId);
      expect(commInDb.status).toBe('suspended');

      // Verify audit log entry
      const auditLog = await AuditLog.findOne({
        action: 'COMMUNITY_SUSPEND',
        targetId: commId,
      });
      expect(auditLog).not.toBeNull();
      expect(auditLog.actorRole).toBe('admin');
      expect(auditLog.before.status).toBe('active');
      expect(auditLog.after.status).toBe('suspended');

      // Suspended community is excluded from public nearby queries
      const nearbyRes = await request(app).get('/v1/communities/nearby?lat=12.97&lng=77.59');
      const found = nearbyRes.body.communities.find((c) => c.id === commId);
      expect(found).toBeUndefined();
    });
  });

  describe('Members List & Block Privacy (Rule 14)', () => {
    it('hides blocked users from the members list', async () => {
      const commRes = await request(app)
        .post('/v1/communities')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          name: 'Social Club',
          type: 'public',
          city: 'Bengaluru',
          location: { type: 'Point', coordinates: [77.59, 12.97] },
        });
      const commId = commRes.body.community._id;

      // Bob joins
      await request(app)
        .post(`/v1/communities/${commId}/join`)
        .set('Authorization', `Bearer ${memberToken}`);

      // Bob blocks Alice (the owner)
      await Block.create({ blockerId: memberUser._id, blockedId: ownerUser._id });

      // Alice requests members list: Bob should be hidden because Bob blocked Alice!
      const membersRes = await request(app)
        .get(`/v1/communities/${commId}/members`)
        .set('Authorization', `Bearer ${ownerToken}`);

      expect(membersRes.status).toBe(200);
      const bobInList = membersRes.body.members.find(
        (m) => m.userId.toString() === memberUser._id.toString(),
      );
      expect(bobInList).toBeUndefined();
    });
  });

  describe('100-Parallel-Joins Race Test (Rule 14 / Concurrency)', () => {
    it('concurrently executes 100 parallel joins without drift in memberCount or duplicate memberships', async () => {
      const commRes = await request(app)
        .post('/v1/communities')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          name: 'Concurrency Stress Test Community',
          type: 'public',
          city: 'Bengaluru',
          location: { type: 'Point', coordinates: [77.59, 12.97] },
        });
      const commId = commRes.body.community._id;

      // Pre-create 100 users
      const numUsers = 100;
      const userDocs = [];
      for (let i = 0; i < numUsers; i++) {
        userDocs.push({
          name: `User ${i}`,
          email: `race_user_${i}_${Date.now()}@test.com`,
          passwordHash: 'dummyhash',
          status: 'active',
          emailVerified: true,
        });
      }
      const insertedUsers = await User.insertMany(userDocs);

      // Execute 100 parallel joins
      const joinPromises = insertedUsers.map((u) => {
        const uToken = signAccessToken(
          { sub: u._id.toString(), role: 'user' },
          BUSINESS_CONFIG.TOKEN_AUDIENCES.USER,
        );
        return request(app)
          .post(`/v1/communities/${commId}/join`)
          .set('Authorization', `Bearer ${uToken}`);
      });

      const results = await Promise.all(joinPromises);

      // Verify all succeeded with 200 OK
      for (const res of results) {
        expect(res.status).toBe(200);
        expect(res.body.status).toBe('active');
      }

      // Check database state
      const finalComm = await Community.findById(commId);
      const activeMembershipsCount = await Membership.countDocuments({
        communityId: commId,
        status: 'active',
      });

      // 1 owner + 100 new members = 101 members exactly
      expect(activeMembershipsCount).toBe(101);
      expect(finalComm.memberCount).toBe(101);
    }, 45000);
  });
});
