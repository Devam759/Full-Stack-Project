import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import * as OTPAuth from 'otpauth';
import app from '../src/app.js';
import { setupTestDB, teardownTestDB, clearTestDB } from './setup/dbTestHelper.js';
import User from '../src/models/User.js';
import { hashPassword } from '../src/common/crypto.js';
import { generateTotpSecret } from '../src/services/totpService.js';
import { BUSINESS_CONFIG } from '@borrowloop/shared';

describe('Portal TOTP Authentication (Phase 1)', () => {
  beforeAll(async () => {
    await setupTestDB();
  }, 60000);

  afterAll(async () => {
    await teardownTestDB();
  });

  beforeEach(async () => {
    await clearTestDB();
  });

  it('rejects regular users from accessing portal login', async () => {
    const passwordHash = await hashPassword('UserPassword123!');
    await User.create({
      name: 'Bob Regular',
      email: 'bob@example.com',
      passwordHash,
      role: 'user',
    });

    const res = await request(app)
      .post('/v1/portal/auth/login')
      .send({ email: 'bob@example.com', password: 'UserPassword123!' });

    expect(res.status).toBe(401);
  });

  it('authenticates care agent via step 1 password + step 2 TOTP code, and blocks replay', async () => {
    const email = 'agent@borrowloop.test';
    const password = 'AgentPassword123!';
    const passwordHash = await hashPassword(password);
    const { secretBase32, encryptedSecret } = generateTotpSecret(email);

    await User.create({
      name: 'Agent Smith',
      email,
      passwordHash,
      role: 'care_agent',
      status: 'active',
      totpSecret: encryptedSecret,
    });

    // Step 1: Login with password
    const step1Res = await request(app).post('/v1/portal/auth/login').send({ email, password });

    expect(step1Res.status).toBe(200);
    expect(step1Res.body.totpRequired).toBe(true);
    const tempToken = step1Res.body.tempToken;
    expect(tempToken).toBeDefined();

    // Verify pre-TOTP token cannot be used on normal endpoints
    const meRes = await request(app)
      .get('/v1/users/me')
      .set('Authorization', `Bearer ${tempToken}`);
    expect(meRes.status).toBe(401);

    // Generate valid TOTP code
    const totp = new OTPAuth.TOTP({
      issuer: BUSINESS_CONFIG.TOTP_SETTINGS.ISSUER,
      label: email,
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret: OTPAuth.Secret.fromBase32(secretBase32),
    });
    const code = totp.generate();

    // Step 2: Submit TOTP code
    const step2Res = await request(app)
      .post('/v1/portal/auth/totp')
      .send({ tempToken, totpCode: code });

    expect(step2Res.status).toBe(200);
    expect(step2Res.body).toHaveProperty('accessToken');
    expect(step2Res.body.user.role).toBe('care_agent');

    // ANTI-REPLAY TEST: Presenting the same TOTP code again must be blocked!
    const replayRes = await request(app)
      .post('/v1/portal/auth/totp')
      .send({ tempToken, totpCode: code });

    expect(replayRes.status).toBe(401);
  });
});
