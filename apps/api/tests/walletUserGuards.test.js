import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { setupTestDB, teardownTestDB, clearTestDB } from './setup/dbTestHelper.js';
import app from '../src/app.js';
import User from '../src/models/User.js';
import { signAccessToken } from '../src/common/jwt.js';

describe('Suite 4: User Status & Email Verification Guards', () => {
  beforeAll(async () => {
    await setupTestDB();
  });

  afterAll(async () => {
    await teardownTestDB();
  });

  beforeEach(async () => {
    await clearTestDB();
  });

  it('blocks unverified email users from adding or withdrawing funds', async () => {
    const unverifiedUser = await User.create({
      name: 'Unverified User',
      email: 'unverified@example.com',
      emailVerified: false,
      status: 'active',
      passwordHash: 'dummyhash',
    });

    const token = signAccessToken({
      sub: unverifiedUser._id.toString(),
      role: 'user',
    });

    const addRes = await request(app)
      .post('/v1/wallet/add')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', 'ik-unverified-1')
      .send({ amountPaise: 50000 });

    expect(addRes.status).toBe(403);
    expect(addRes.body.error.code).toBe('EMAIL_NOT_VERIFIED');

    const withdrawRes = await request(app)
      .post('/v1/wallet/withdraw')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', 'ik-unverified-2')
      .send({ amountPaise: 10000 });

    expect(withdrawRes.status).toBe(403);
    expect(withdrawRes.body.error.code).toBe('EMAIL_NOT_VERIFIED');
  });

  it('blocks frozen, banned, and deleted users from adding or withdrawing funds', async () => {
    const statuses = ['frozen', 'banned', 'deleted'];

    for (const status of statuses) {
      const user = await User.create({
        name: `User ${status}`,
        email: `${status}@example.com`,
        emailVerified: true,
        status,
        passwordHash: 'dummyhash',
      });

      const token = signAccessToken({
        sub: user._id.toString(),
        role: 'user',
      });

      const addRes = await request(app)
        .post('/v1/wallet/add')
        .set('Authorization', `Bearer ${token}`)
        .set('Idempotency-Key', `ik-${status}-add`)
        .send({ amountPaise: 20000 });

      expect([401, 403]).toContain(addRes.status);

      const withdrawRes = await request(app)
        .post('/v1/wallet/withdraw')
        .set('Authorization', `Bearer ${token}`)
        .set('Idempotency-Key', `ik-${status}-withdraw`)
        .send({ amountPaise: 20000 });

      expect([401, 403]).toContain(withdrawRes.status);
    }
  });
});
