import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { setupTestDB, teardownTestDB, clearTestDB } from './setup/dbTestHelper.js';
import app from '../src/app.js';
import User from '../src/models/User.js';
import Wallet from '../src/models/Wallet.js';
import IdempotencyKey from '../src/models/IdempotencyKey.js';
import { signAccessToken } from '../src/common/jwt.js';

describe('Suite 2: Idempotency Key Handling & Replay Protection', () => {
  let user;
  let token;

  beforeAll(async () => {
    await setupTestDB();
  });

  afterAll(async () => {
    await teardownTestDB();
  });

  beforeEach(async () => {
    await clearTestDB();

    user = await User.create({
      name: 'Alice Idempotent',
      email: 'alice.idemp@example.com',
      emailVerified: true,
      status: 'active',
      passwordHash: 'dummyhash123',
    });

    token = signAccessToken({
      sub: user._id.toString(),
      role: 'user',
    });
  });

  it('rejects wallet add requests missing Idempotency-Key header', async () => {
    const res = await request(app)
      .post('/v1/wallet/add')
      .set('Authorization', `Bearer ${token}`)
      .send({ amountPaise: 50000 });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_IDEMPOTENCY_KEY');
  });

  it('records idempotency key in idempotency_keys collection on successful operation', async () => {
    const key = 'ik-test-100';
    const res = await request(app)
      .post('/v1/wallet/add')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', key)
      .send({ amountPaise: 50000 });

    expect(res.status).toBe(200);
    expect(res.body.availablePaise).toBe(50000);

    const savedKey = await IdempotencyKey.findOne({ userId: user._id, key });
    expect(savedKey).not.toBeNull();
    expect(savedKey.statusCode).toBe(200);
    expect(savedKey.requestHash).toBeDefined();
    expect(savedKey.responseBody.availablePaise).toBe(50000);
  });

  it('returns cached response on replay with identical body without double-crediting', async () => {
    const key = 'ik-test-replay';

    // First attempt
    const res1 = await request(app)
      .post('/v1/wallet/add')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', key)
      .send({ amountPaise: 20000 });

    expect(res1.status).toBe(200);
    expect(res1.body.availablePaise).toBe(20000);

    // Replay attempt with exact same key and body
    const res2 = await request(app)
      .post('/v1/wallet/add')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', key)
      .send({ amountPaise: 20000 });

    expect(res2.status).toBe(200);
    expect(res2.headers['x-idempotent-replay']).toBe('true');
    expect(res2.body.availablePaise).toBe(20000);

    // Wallet balance should NOT have been doubled
    const wallet = await Wallet.findOne({ userId: user._id });
    expect(wallet.availablePaise).toBe(20000);
  });

  it('rejects request with 409 CONFLICT if same idempotency key is reused with different body', async () => {
    const key = 'ik-reuse-diff-body';

    const res1 = await request(app)
      .post('/v1/wallet/add')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', key)
      .send({ amountPaise: 10000 });

    expect(res1.status).toBe(200);

    // Same key with different amount
    const res2 = await request(app)
      .post('/v1/wallet/add')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', key)
      .send({ amountPaise: 25000 });

    expect(res2.status).toBe(409);
    expect(res2.body.error.code).toBe('IDEMPOTENCY_KEY_REUSE');

    // Balance must remain unchanged at 10000
    const wallet = await Wallet.findOne({ userId: user._id });
    expect(wallet.availablePaise).toBe(10000);
  });

  it('validates Idempotency-Key header: trim, length 8-128, and regex /^[A-Za-z0-9_-]+$/', async () => {
    // 1. Too short (< 8 chars)
    const shortRes = await request(app)
      .post('/v1/wallet/add')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', 'short')
      .send({ amountPaise: 10000 });
    expect(shortRes.status).toBe(400);
    expect(shortRes.body.error.code).toBe('INVALID_IDEMPOTENCY_KEY');

    // 2. Too long (> 128 chars)
    const longKey = 'a'.repeat(129);
    const longRes = await request(app)
      .post('/v1/wallet/add')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', longKey)
      .send({ amountPaise: 10000 });
    expect(longRes.status).toBe(400);
    expect(longRes.body.error.code).toBe('INVALID_IDEMPOTENCY_KEY');

    // 3. Invalid characters
    const invalidCharsRes = await request(app)
      .post('/v1/wallet/add')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', 'ik-test@invalid!')
      .send({ amountPaise: 10000 });
    expect(invalidCharsRes.status).toBe(400);
    expect(invalidCharsRes.body.error.code).toBe('INVALID_IDEMPOTENCY_KEY');

    // 4. Valid key with leading/trailing spaces (trims to valid length 8-128)
    const validWithSpacesRes = await request(app)
      .post('/v1/wallet/add')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', '   ik-valid-trimmed-key   ')
      .send({ amountPaise: 10000 });
    expect(validWithSpacesRes.status).toBe(200);
    expect(validWithSpacesRes.body.availablePaise).toBe(10000);
  });

  it('handles 20 simultaneous identical requests with exactly one execution, replays or 409s, and no 500s', async () => {
    const key = 'ik-concurrent-20-test';
    const amountPaise = 10000;

    const promises = Array.from({ length: 20 }, () =>
      request(app)
        .post('/v1/wallet/add')
        .set('Authorization', `Bearer ${token}`)
        .set('Idempotency-Key', key)
        .send({ amountPaise }),
    );

    const responses = await Promise.all(promises);

    // Verify status codes: every response must be 200 or 409
    const statuses = responses.map((r) => r.status);
    expect(statuses.every((s) => s === 200 || s === 409)).toBe(true);

    // No 500s allowed!
    expect(statuses.includes(500)).toBe(false);

    // At least one request succeeded with 200
    const okResponses = responses.filter((r) => r.status === 200);
    expect(okResponses.length).toBeGreaterThanOrEqual(1);

    // Any 409s must be IDEMPOTENCY_IN_PROGRESS
    const conflictResponses = responses.filter((r) => r.status === 409);
    for (const res of conflictResponses) {
      expect(res.body.error.code).toBe('IDEMPOTENCY_IN_PROGRESS');
    }

    // Verify balance was credited exactly ONCE
    const wallet = await Wallet.findOne({ userId: user._id });
    expect(wallet.availablePaise).toBe(amountPaise);
  });
});
