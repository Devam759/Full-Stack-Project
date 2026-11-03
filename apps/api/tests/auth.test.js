import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import { setupTestDB, teardownTestDB, clearTestDB } from './setup/dbTestHelper.js';
import User from '../src/models/User.js';

describe('Authentication & User Lifecycle (Phase 1)', () => {
  beforeAll(async () => {
    await setupTestDB();
  }, 60000);

  afterAll(async () => {
    await teardownTestDB();
  });

  beforeEach(async () => {
    await clearTestDB();
  });

  const validUserData = {
    name: 'Alice Sharma',
    email: 'alice@example.com',
    password: 'Password123!',
    confirmAge: true,
    acceptTerms: true,
  };

  describe('Registration & Email Verification', () => {
    it('creates an account in Step 1 with photoUrl=null and unverified email', async () => {
      const res = await request(app).post('/v1/auth/register').send(validUserData);

      expect(res.status).toBe(201);
      expect(res.body.user.email).toBe('alice@example.com');
      expect(res.body.user.emailVerified).toBe(false);
      expect(res.body.user.photoUrl).toBeNull();
      expect(res.body.user).not.toHaveProperty('passwordHash');

      const userInDb = await User.findOne({ email: 'alice@example.com' });
      expect(userInDb).not.toBeNull();
      expect(userInDb.termsAcceptedAt).not.toBeNull();
      expect(userInDb.ageConfirmedAt).not.toBeNull();
    });

    it('rejects registration if user does not confirm age >= 18', async () => {
      const res = await request(app)
        .post('/v1/auth/register')
        .send({ ...validUserData, confirmAge: false });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects passwords shorter than 8 or longer than 128 chars', async () => {
      const shortRes = await request(app)
        .post('/v1/auth/register')
        .send({ ...validUserData, password: 'short' });
      expect(shortRes.status).toBe(400);

      const longRes = await request(app)
        .post('/v1/auth/register')
        .send({ ...validUserData, password: 'a'.repeat(129) });
      expect(longRes.status).toBe(400);
    });

    it('verifies email successfully with token', async () => {
      const regRes = await request(app).post('/v1/auth/register').send(validUserData);
      const token = regRes.body.verificationToken;

      const verifyRes = await request(app).post('/v1/auth/verify-email').send({ token });

      expect(verifyRes.status).toBe(200);
      expect(verifyRes.body.user.emailVerified).toBe(true);

      const updatedUser = await User.findOne({ email: 'alice@example.com' });
      expect(updatedUser.emailVerified).toBe(true);
    });
  });

  describe('Login & Slowdown', () => {
    beforeEach(async () => {
      await request(app).post('/v1/auth/register').send(validUserData);
    });

    it('returns uniform generic error message on invalid email or bad password', async () => {
      const badEmailRes = await request(app)
        .post('/v1/auth/login')
        .send({ email: 'nonexistent@example.com', password: 'Password123!' });
      expect(badEmailRes.status).toBe(401);
      expect(badEmailRes.body.error.message).toBe('Invalid email or password');

      const badPassRes = await request(app)
        .post('/v1/auth/login')
        .send({ email: 'alice@example.com', password: 'WrongPassword!' });
      expect(badPassRes.status).toBe(401);
      expect(badPassRes.body.error.message).toBe('Invalid email or password');
    });

    it('logs in successfully and indicates photo is required for Step 2', async () => {
      const res = await request(app)
        .post('/v1/auth/login')
        .send({ email: 'alice@example.com', password: 'Password123!' });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('accessToken');
      expect(res.body.requiresPhoto).toBe(true);
      expect(res.headers['set-cookie']).toBeDefined();
    });
  });

  describe('Refresh Token Rotation & Reuse Detection (Security)', () => {
    it('rotates refresh token and invalidates entire family if an old token is reused', async () => {
      await request(app).post('/v1/auth/register').send(validUserData);
      const loginRes = await request(app)
        .post('/v1/auth/login')
        .send({ email: 'alice@example.com', password: 'Password123!' });

      const cookie1 = loginRes.headers['set-cookie'][0];
      const token1 = loginRes.body.refreshToken;

      // First refresh: valid
      const refresh1Res = await request(app)
        .post('/v1/auth/refresh')
        .set('Cookie', cookie1)
        .send({ refreshToken: token1 });

      expect(refresh1Res.status).toBe(200);
      expect(refresh1Res.body).toHaveProperty('accessToken');

      const cookie2 = refresh1Res.headers['set-cookie'][0];
      const token2 = refresh1Res.body.refreshToken;

      // Second refresh with new token2: valid
      const refresh2Res = await request(app)
        .post('/v1/auth/refresh')
        .set('Cookie', cookie2)
        .send({ refreshToken: token2 });

      expect(refresh2Res.status).toBe(200);

      // REUSE ATTACK: Attacker presents token1 which was already rotated/revoked!
      const attackRes = await request(app)
        .post('/v1/auth/refresh')
        .set('Cookie', cookie1)
        .send({ refreshToken: token1 });

      expect(attackRes.status).toBe(401);
      expect(attackRes.body.error.code).toBe('TOKEN_REVOKED');

      // Now token2 or token3 must also be revoked because the entire family was invalidated!
      const victimRes = await request(app)
        .post('/v1/auth/refresh')
        .set('Cookie', refresh2Res.headers['set-cookie'][0])
        .send({ refreshToken: refresh2Res.body.refreshToken });

      expect(victimRes.status).toBe(401);
      expect(victimRes.body.error.code).toBe('TOKEN_REVOKED');
    });

    it('rejects token refresh from unauthorized origin', async () => {
      await request(app).post('/v1/auth/register').send(validUserData);
      const loginRes = await request(app)
        .post('/v1/auth/login')
        .send({ email: 'alice@example.com', password: 'Password123!' });

      const refreshRes = await request(app)
        .post('/v1/auth/refresh')
        .set('Cookie', loginRes.headers['set-cookie'][0])
        .set('Origin', 'https://malicious-website.com')
        .send({ refreshToken: loginRes.body.refreshToken });

      expect(refreshRes.status).toBe(403);
    });
  });

  describe('Password Reset & Change', () => {
    it('executes forgot-password and reset-password with single-use token', async () => {
      await request(app).post('/v1/auth/register').send(validUserData);

      const forgotRes = await request(app)
        .post('/v1/auth/forgot-password')
        .send({ email: 'alice@example.com' });

      expect(forgotRes.status).toBe(200);
      const resetToken = forgotRes.body.resetToken;
      expect(resetToken).toBeDefined();

      const resetRes = await request(app)
        .post('/v1/auth/reset-password')
        .send({ token: resetToken, newPassword: 'NewPassword123!' });

      expect(resetRes.status).toBe(200);

      // Old password must fail
      const oldLogin = await request(app)
        .post('/v1/auth/login')
        .send({ email: 'alice@example.com', password: 'Password123!' });
      expect(oldLogin.status).toBe(401);

      // New password must succeed
      const newLogin = await request(app)
        .post('/v1/auth/login')
        .send({ email: 'alice@example.com', password: 'NewPassword123!' });
      expect(newLogin.status).toBe(200);

      // Reusing reset token must fail
      const reuseRes = await request(app)
        .post('/v1/auth/reset-password')
        .send({ token: resetToken, newPassword: 'AnotherPassword123!' });
      expect(reuseRes.status).toBe(400);
    });
  });
});
