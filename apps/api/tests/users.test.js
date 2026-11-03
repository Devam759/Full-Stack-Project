import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import { setupTestDB, teardownTestDB, clearTestDB } from './setup/dbTestHelper.js';
import User from '../src/models/User.js';
import { hashPassword } from '../src/common/crypto.js';

describe('User Profile, Security & Moderation Endpoints (Phase 1)', () => {
  let userToken;
  let userId;

  beforeAll(async () => {
    await setupTestDB();
  }, 60000);

  afterAll(async () => {
    await teardownTestDB();
  });

  beforeEach(async () => {
    await clearTestDB();

    const passwordHash = await hashPassword('UserPassword123!');
    const user = await User.create({
      name: 'Carol Danvers',
      email: 'carol@example.com',
      passwordHash,
      role: 'user',
      status: 'active',
      emailVerified: true,
      trustScore: 50,
      approxLocation: { type: 'Point', coordinates: [77.5946, 12.9716] },
    });

    userId = user._id.toString();

    const loginRes = await request(app)
      .post('/v1/auth/login')
      .send({ email: 'carol@example.com', password: 'UserPassword123!' });

    userToken = loginRes.body.accessToken;
  });

  describe('Security & Immutability of Sensitive Fields (Rule 14)', () => {
    it('PATCH /users/me rejects attempts to modify role, trustScore, status, or emailVerified', async () => {
      const res = await request(app)
        .patch('/v1/users/me')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          role: 'admin',
          trustScore: 100,
          status: 'banned',
          emailVerified: false,
        });

      // Strict schema rejects unknown fields with 400 validation error
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');

      const userInDb = await User.findById(userId);
      expect(userInDb.role).toBe('user');
      expect(userInDb.trustScore).toBe(50);
      expect(userInDb.status).toBe('active');
      expect(userInDb.emailVerified).toBe(true);
    });

    it('never exposes passwordHash or totpSecret in any response', async () => {
      const meRes = await request(app)
        .get('/v1/users/me')
        .set('Authorization', `Bearer ${userToken}`);

      expect(meRes.status).toBe(200);
      expect(meRes.body.user).not.toHaveProperty('passwordHash');
      expect(meRes.body.user).not.toHaveProperty('totpSecret');
      expect(JSON.stringify(meRes.body)).not.toContain('passwordHash');
      expect(JSON.stringify(meRes.body)).not.toContain('totpSecret');

      const publicRes = await request(app).get(`/v1/users/${userId}`);
      expect(publicRes.status).toBe(200);
      expect(publicRes.body.profile).not.toHaveProperty('passwordHash');
      expect(publicRes.body.profile).not.toHaveProperty('totpSecret');
    });

    it('rounds coordinates to 2 decimal places to preserve location privacy', async () => {
      const res = await request(app)
        .patch('/v1/users/me')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          approxLocation: {
            type: 'Point',
            coordinates: [77.594689, 12.971612],
          },
        });

      expect(res.status).toBe(200);
      expect(res.body.user.approxLocation.coordinates).toEqual([77.59, 12.97]);
    });
  });

  describe('Blocking & Unblocking Users', () => {
    it('allows blocking and unblocking users and viewing blocked list', async () => {
      const targetHash = await hashPassword('Target123!');
      const target = await User.create({
        name: 'David Spammer',
        email: 'david@example.com',
        passwordHash: targetHash,
      });

      // Block David
      const blockRes = await request(app)
        .post(`/v1/users/${target._id}/block`)
        .set('Authorization', `Bearer ${userToken}`);
      expect(blockRes.status).toBe(200);

      // List blocked users
      const listRes = await request(app)
        .get('/v1/users/me/blocks')
        .set('Authorization', `Bearer ${userToken}`);
      expect(listRes.status).toBe(200);
      expect(listRes.body.blocks).toHaveLength(1);

      // Unblock David
      const unblockRes = await request(app)
        .delete(`/v1/users/${target._id}/block`)
        .set('Authorization', `Bearer ${userToken}`);
      expect(unblockRes.status).toBe(200);

      // Verify list is empty
      const listAfter = await request(app)
        .get('/v1/users/me/blocks')
        .set('Authorization', `Bearer ${userToken}`);
      expect(listAfter.body.blocks).toHaveLength(0);
    });
  });

  describe('Account Deletion (Rule 13)', () => {
    it('deletes account with password confirmation, anonymizes personal data, and revokes tokens', async () => {
      const deleteRes = await request(app)
        .delete('/v1/users/me')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ password: 'UserPassword123!' });

      expect(deleteRes.status).toBe(200);

      const deletedUser = await User.findById(userId);
      expect(deletedUser.status).toBe('deleted');
      expect(deletedUser.name).toBe('Deleted User');
      expect(deletedUser.email).toContain('deleted_');

      // Subsequent authenticated requests with old token must be rejected
      const meRes = await request(app)
        .get('/v1/users/me')
        .set('Authorization', `Bearer ${userToken}`);
      expect(meRes.status).toBe(401);
    });
  });
});
