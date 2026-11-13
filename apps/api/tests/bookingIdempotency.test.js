import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { setupTestDB, teardownTestDB, clearTestDB } from './setup/dbTestHelper.js';
import { createBookingFixtures } from './setup/bookingTestFixture.js';
import app from '../src/app.js';
import Booking from '../src/models/Booking.js';
import ItemDayLock from '../src/models/ItemDayLock.js';

describe('Suite 7: Booking Idempotency Middleware Protection', () => {
  beforeAll(async () => {
    await setupTestDB();
    await Booking.init();
    await ItemDayLock.init();
  });

  afterAll(async () => {
    await teardownTestDB();
  });

  beforeEach(async () => {
    await clearTestDB();
  });

  it('replays identical request with X-Idempotent-Replay header and identical payload', async () => {
    const fixtures = await createBookingFixtures();
    const idemKey = 'ik-replay-valid-123';

    // First attempt
    const res1 = await request(app)
      .post('/v1/bookings')
      .set('Authorization', `Bearer ${fixtures.borrowerToken}`)
      .set('Idempotency-Key', idemKey)
      .send({
        itemId: fixtures.item._id.toString(),
        startDate: '2026-12-01',
        endDate: '2026-12-03',
      });

    expect(res1.status).toBe(201);
    expect(res1.headers['x-idempotent-replay']).toBeUndefined();
    const originalBookingId = res1.body.booking._id;

    // Second attempt with exact same body and key
    const res2 = await request(app)
      .post('/v1/bookings')
      .set('Authorization', `Bearer ${fixtures.borrowerToken}`)
      .set('Idempotency-Key', idemKey)
      .send({
        itemId: fixtures.item._id.toString(),
        startDate: '2026-12-01',
        endDate: '2026-12-03',
      });

    expect(res2.status).toBe(201);
    expect(res2.headers['x-idempotent-replay']).toBe('true');
    expect(res2.body.booking._id).toBe(originalBookingId);

    // Verify only ONE booking was created in DB
    const count = await Booking.countDocuments({ borrowerId: fixtures.borrower._id });
    expect(count).toBe(1);
  });

  it('rejects same Idempotency-Key with different payload with 409 IDEMPOTENCY_KEY_REUSE', async () => {
    const fixtures = await createBookingFixtures();
    const idemKey = 'ik-reuse-conflict-99';

    // First attempt: Dec 1 to Dec 3
    const res1 = await request(app)
      .post('/v1/bookings')
      .set('Authorization', `Bearer ${fixtures.borrowerToken}`)
      .set('Idempotency-Key', idemKey)
      .send({
        itemId: fixtures.item._id.toString(),
        startDate: '2026-12-01',
        endDate: '2026-12-03',
      });
    expect(res1.status).toBe(201);

    // Second attempt: same key but different dates (Dec 5 to Dec 7)
    const res2 = await request(app)
      .post('/v1/bookings')
      .set('Authorization', `Bearer ${fixtures.borrowerToken}`)
      .set('Idempotency-Key', idemKey)
      .send({
        itemId: fixtures.item._id.toString(),
        startDate: '2026-12-05',
        endDate: '2026-12-07',
      });

    expect(res2.status).toBe(409);
    expect(res2.body.error.code).toBe('IDEMPOTENCY_KEY_REUSE');
  });

  it('20 simultaneous identical requests with the same key produce 1 execution, 0 500 errors, and 1 DB record', async () => {
    const fixtures = await createBookingFixtures();
    const sharedKey = 'ik-concurrent-identical-20';

    const promises = Array.from({ length: 20 }, () =>
      request(app)
        .post('/v1/bookings')
        .set('Authorization', `Bearer ${fixtures.borrowerToken}`)
        .set('Idempotency-Key', sharedKey)
        .send({
          itemId: fixtures.item._id.toString(),
          startDate: '2026-12-10',
          endDate: '2026-12-12',
        }),
    );

    const responses = await Promise.all(promises);

    // No 500 errors
    for (const r of responses) {
      expect(r.status).not.toBe(500);
      expect([201, 409]).toContain(r.status);
    }

    // Exactly one booking in DB
    const count = await Booking.countDocuments({ borrowerId: fixtures.borrower._id });
    expect(count).toBe(1);

    // At least one 201 Created was returned
    const createdResponses = responses.filter((r) => r.status === 201);
    expect(createdResponses.length).toBeGreaterThanOrEqual(1);

    // All 201 responses reference the same booking ID
    const sampleId = createdResponses[0].body.booking._id;
    for (const cr of createdResponses) {
      expect(cr.body.booking._id).toBe(sampleId);
    }
  });

  it('validates Idempotency-Key format (8-128 chars, alphanumeric + _ -)', async () => {
    const fixtures = await createBookingFixtures();

    // 1. Missing header
    const noHeaderRes = await request(app)
      .post('/v1/bookings')
      .set('Authorization', `Bearer ${fixtures.borrowerToken}`)
      .send({
        itemId: fixtures.item._id.toString(),
        startDate: '2026-12-01',
        endDate: '2026-12-03',
      });
    expect(noHeaderRes.status).toBe(400);
    expect(noHeaderRes.body.error.code).toBe('INVALID_IDEMPOTENCY_KEY');

    // 2. Too short (< 8 chars)
    const tooShortRes = await request(app)
      .post('/v1/bookings')
      .set('Authorization', `Bearer ${fixtures.borrowerToken}`)
      .set('Idempotency-Key', 'short')
      .send({
        itemId: fixtures.item._id.toString(),
        startDate: '2026-12-01',
        endDate: '2026-12-03',
      });
    expect(tooShortRes.status).toBe(400);
    expect(tooShortRes.body.error.code).toBe('INVALID_IDEMPOTENCY_KEY');

    // 3. Too long (> 128 chars)
    const tooLongKey = 'a'.repeat(129);
    const tooLongRes = await request(app)
      .post('/v1/bookings')
      .set('Authorization', `Bearer ${fixtures.borrowerToken}`)
      .set('Idempotency-Key', tooLongKey)
      .send({
        itemId: fixtures.item._id.toString(),
        startDate: '2026-12-01',
        endDate: '2026-12-03',
      });
    expect(tooLongRes.status).toBe(400);
    expect(tooLongRes.body.error.code).toBe('INVALID_IDEMPOTENCY_KEY');

    // 4. Invalid characters
    const invalidCharRes = await request(app)
      .post('/v1/bookings')
      .set('Authorization', `Bearer ${fixtures.borrowerToken}`)
      .set('Idempotency-Key', 'invalid key with spaces!@#')
      .send({
        itemId: fixtures.item._id.toString(),
        startDate: '2026-12-01',
        endDate: '2026-12-03',
      });
    expect(invalidCharRes.status).toBe(400);
    expect(invalidCharRes.body.error.code).toBe('INVALID_IDEMPOTENCY_KEY');
  });
});
