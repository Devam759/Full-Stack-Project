import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { setupTestDB, teardownTestDB, clearTestDB } from './setup/dbTestHelper.js';
import { createBookingFixtures } from './setup/bookingTestFixture.js';
import app from '../src/app.js';
import Booking from '../src/models/Booking.js';
import { calculateDueAtIST } from '../src/modules/bookings/bookingService.js';

describe('Suite 12: Date Boundaries, Duration Limits, and IST Timestamps', () => {
  beforeAll(async () => {
    await setupTestDB();
    await Booking.init();
  });

  afterAll(async () => {
    await teardownTestDB();
  });

  beforeEach(async () => {
    await clearTestDB();
  });

  it('rejects dates in the past', async () => {
    const fixtures = await createBookingFixtures();
    const pastDate = '2020-01-01';

    const res = await request(app)
      .post('/v1/bookings')
      .set('Authorization', `Bearer ${fixtures.borrowerToken}`)
      .set('Idempotency-Key', 'ik-dates-past-1')
      .send({
        itemId: fixtures.item._id.toString(),
        startDate: pastDate,
        endDate: '2020-01-05',
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects endDate prior to startDate', async () => {
    const fixtures = await createBookingFixtures();

    const res = await request(app)
      .post('/v1/bookings')
      .set('Authorization', `Bearer ${fixtures.borrowerToken}`)
      .set('Idempotency-Key', 'ik-dates-inverted-1')
      .send({
        itemId: fixtures.item._id.toString(),
        startDate: '2026-12-10',
        endDate: '2026-12-05',
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('supports single-day bookings where startDate === endDate', async () => {
    const fixtures = await createBookingFixtures();

    const res = await request(app)
      .post('/v1/bookings')
      .set('Authorization', `Bearer ${fixtures.borrowerToken}`)
      .set('Idempotency-Key', 'ik-dates-single-1')
      .send({
        itemId: fixtures.item._id.toString(),
        startDate: '2026-12-15',
        endDate: '2026-12-15',
      });

    expect(res.status).toBe(201);
    expect(res.body.booking.days).toBe(1);
    expect(res.body.booking.rentPaise).toBe(fixtures.item.rentPerDayPaise);
  });

  it('enforces item minDays and maxDays duration limits', async () => {
    const fixtures = await createBookingFixtures({ minDays: 3, maxDays: 7 });

    // Too short (2 days when minDays is 3)
    const shortRes = await request(app)
      .post('/v1/bookings')
      .set('Authorization', `Bearer ${fixtures.borrowerToken}`)
      .set('Idempotency-Key', 'ik-dates-short-1')
      .send({
        itemId: fixtures.item._id.toString(),
        startDate: '2026-12-10',
        endDate: '2026-12-11', // 2 days
      });
    expect(shortRes.status).toBe(400);
    expect(shortRes.body.error.message).toContain('at least 3 days');

    // Too long (8 days when maxDays is 7)
    const longRes = await request(app)
      .post('/v1/bookings')
      .set('Authorization', `Bearer ${fixtures.borrowerToken}`)
      .set('Idempotency-Key', 'ik-dates-long-1')
      .send({
        itemId: fixtures.item._id.toString(),
        startDate: '2026-12-10',
        endDate: '2026-12-17', // 8 days
      });
    expect(longRes.status).toBe(400);
    expect(longRes.body.error.message).toContain('cannot exceed 7 days');
  });

  it('accurately computes IST dueAt timestamp (23:59:59.999 IST = 18:29:59.999Z UTC)', () => {
    const dueAt = calculateDueAtIST('2026-12-25');
    // In UTC, 23:59:59.999 IST (+05:30) corresponds to 18:29:59.999Z
    expect(dueAt.toISOString()).toBe('2026-12-25T18:29:59.999Z');
  });
});
