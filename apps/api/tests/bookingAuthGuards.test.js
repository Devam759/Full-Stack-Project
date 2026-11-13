import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { setupTestDB, teardownTestDB, clearTestDB } from './setup/dbTestHelper.js';
import { createBookingFixtures } from './setup/bookingTestFixture.js';
import app from '../src/app.js';
import User from '../src/models/User.js';
import Membership from '../src/models/Membership.js';
import Booking from '../src/models/Booking.js';
import { signAccessToken } from '../src/common/jwt.js';

describe('Booking Authorization & Guard Checks', () => {
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

  it('rejects booking request if borrower is not a member of the item community', async () => {
    const fixtures = await createBookingFixtures();
    // Remove borrower membership
    await Membership.deleteOne({
      communityId: fixtures.community._id,
      userId: fixtures.borrower._id,
    });

    const res = await request(app)
      .post('/v1/bookings')
      .set('Authorization', `Bearer ${fixtures.borrowerToken}`)
      .set('Idempotency-Key', 'ik-auth-nomember')
      .send({
        itemId: fixtures.item._id.toString(),
        startDate: '2026-11-20',
        endDate: '2026-11-22',
      });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('COMMUNITY_MEMBERSHIP_REQUIRED');
  });

  it('rejects booking request if owner attempts to borrow their own item', async () => {
    const fixtures = await createBookingFixtures();

    const res = await request(app)
      .post('/v1/bookings')
      .set('Authorization', `Bearer ${fixtures.lenderToken}`)
      .set('Idempotency-Key', 'ik-auth-ownitem')
      .send({
        itemId: fixtures.item._id.toString(),
        startDate: '2026-11-20',
        endDate: '2026-11-22',
      });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CANNOT_BORROW_OWN_ITEM');
  });

  it('rejects booking request if item is not active (e.g. paused/removed)', async () => {
    const fixtures = await createBookingFixtures({ itemStatus: 'paused' });

    const res = await request(app)
      .post('/v1/bookings')
      .set('Authorization', `Bearer ${fixtures.borrowerToken}`)
      .set('Idempotency-Key', 'ik-auth-paused')
      .send({
        itemId: fixtures.item._id.toString(),
        startDate: '2026-11-20',
        endDate: '2026-11-22',
      });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ITEM_NOT_ACTIVE');
  });

  it('rejects unverified email borrower from creating a booking request', async () => {
    const fixtures = await createBookingFixtures();
    fixtures.borrower.emailVerified = false;
    await fixtures.borrower.save();

    const res = await request(app)
      .post('/v1/bookings')
      .set('Authorization', `Bearer ${fixtures.borrowerToken}`)
      .set('Idempotency-Key', 'ik-auth-unverified')
      .send({
        itemId: fixtures.item._id.toString(),
        startDate: '2026-11-20',
        endDate: '2026-11-22',
      });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('EMAIL_NOT_VERIFIED');
  });

  it('blocks banned or frozen borrower from creating booking requests', async () => {
    for (const status of ['banned', 'frozen']) {
      const fixtures = await createBookingFixtures();
      fixtures.borrower.status = status;
      await fixtures.borrower.save();

      const res = await request(app)
        .post('/v1/bookings')
        .set('Authorization', `Bearer ${fixtures.borrowerToken}`)
        .set('Idempotency-Key', `ik-auth-${status}`)
        .send({
          itemId: fixtures.item._id.toString(),
          startDate: '2026-11-20',
          endDate: '2026-11-22',
        });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe(status === 'banned' ? 'ACCOUNT_BANNED' : 'ACCOUNT_FROZEN');
    }
  });

  it('blocks non-participants from viewing or mutating a booking', async () => {
    const fixtures = await createBookingFixtures();

    // Create a booking
    const createRes = await request(app)
      .post('/v1/bookings')
      .set('Authorization', `Bearer ${fixtures.borrowerToken}`)
      .set('Idempotency-Key', 'ik-auth-create-view')
      .send({
        itemId: fixtures.item._id.toString(),
        startDate: '2026-11-20',
        endDate: '2026-11-22',
      });

    expect(createRes.status).toBe(201);
    const bookingId = createRes.body.booking._id;

    // Create third-party user
    const thirdPartyUser = await User.create({
      name: 'Third Party',
      email: 'thirdparty@test.com',
      emailVerified: true,
      status: 'active',
      passwordHash: 'dummyhash',
    });
    const thirdPartyToken = signAccessToken({
      sub: thirdPartyUser._id.toString(),
      role: 'user',
    });

    // 1. GET /bookings/:id
    const viewRes = await request(app)
      .get(`/v1/bookings/${bookingId}`)
      .set('Authorization', `Bearer ${thirdPartyToken}`);
    expect(viewRes.status).toBe(403);
    expect(viewRes.body.error.code).toBe('FORBIDDEN');

    // 2. POST /bookings/:id/accept
    const acceptRes = await request(app)
      .post(`/v1/bookings/${bookingId}/accept`)
      .set('Authorization', `Bearer ${thirdPartyToken}`)
      .set('Idempotency-Key', 'ik-auth-thirdparty-accept');
    expect(acceptRes.status).toBe(403);
    expect(acceptRes.body.error.code).toBe('FORBIDDEN');

    // 3. POST /bookings/:id/reject
    const rejectRes = await request(app)
      .post(`/v1/bookings/${bookingId}/reject`)
      .set('Authorization', `Bearer ${thirdPartyToken}`)
      .set('Idempotency-Key', 'ik-auth-thirdparty-reject')
      .send({ reason: 'Malicious reject' });
    expect(rejectRes.status).toBe(403);
    expect(rejectRes.body.error.code).toBe('FORBIDDEN');

    // 4. POST /bookings/:id/cancel
    const cancelRes = await request(app)
      .post(`/v1/bookings/${bookingId}/cancel`)
      .set('Authorization', `Bearer ${thirdPartyToken}`)
      .set('Idempotency-Key', 'ik-auth-thirdparty-cancel')
      .send({ reason: 'Malicious cancel' });
    expect(cancelRes.status).toBe(403);
    expect(cancelRes.body.error.code).toBe('FORBIDDEN');
  });

  it('blocks banned or frozen lender from accepting a booking', async () => {
    for (const status of ['banned', 'frozen']) {
      const fixtures = await createBookingFixtures();

      const createRes = await request(app)
        .post('/v1/bookings')
        .set('Authorization', `Bearer ${fixtures.borrowerToken}`)
        .set('Idempotency-Key', `ik-lender-pre-${status}`)
        .send({
          itemId: fixtures.item._id.toString(),
          startDate: '2026-11-20',
          endDate: '2026-11-22',
        });
      expect(createRes.status).toBe(201);
      const bookingId = createRes.body.booking._id;

      // Update lender status
      fixtures.lender.status = status;
      await fixtures.lender.save();

      const acceptRes = await request(app)
        .post(`/v1/bookings/${bookingId}/accept`)
        .set('Authorization', `Bearer ${fixtures.lenderToken}`)
        .set('Idempotency-Key', `ik-lender-accept-${status}`);

      expect(acceptRes.status).toBe(403);
      expect(acceptRes.body.error.code).toBe(
        status === 'banned' ? 'ACCOUNT_BANNED' : 'ACCOUNT_FROZEN',
      );
    }
  });
});
