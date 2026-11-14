import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { setupTestDB, teardownTestDB, clearTestDB } from './setup/dbTestHelper.js';
import { createBookingFixtures } from './setup/bookingTestFixture.js';
import app from '../src/app.js';
import Booking from '../src/models/Booking.js';
import Rating from '../src/models/Rating.js';
import User from '../src/models/User.js';
import Item from '../src/models/Item.js';
import { clearRecordedEvents } from '@borrowloop/server-core';
import { revealRatingsJob } from '../../worker/src/jobs/revealRatingsJob.js';

describe('Phase 7f: Blind Ratings Integration Tests', () => {
  beforeAll(async () => {
    await setupTestDB();
    await Booking.init();
    await Rating.init();
    await User.init();
    await Item.init();
  });

  afterAll(async () => {
    await teardownTestDB();
  });

  beforeEach(async () => {
    await clearTestDB();
    clearRecordedEvents();
  });

  // Helper to create a completed booking
  async function setupCompletedBooking() {
    const fixtures = await createBookingFixtures({
      borrowerFundsPaise: 500000,
      rentPerDayPaise: 10000,
      depositPaise: 20000,
    });

    const rand1 = Math.random().toString(36).slice(2);
    const rand2 = Math.random().toString(36).slice(2);
    const rand3 = Math.random().toString(36).slice(2);
    const rand4 = Math.random().toString(36).slice(2);
    const rand5 = Math.random().toString(36).slice(2);

    const createRes = await request(app)
      .post('/v1/bookings')
      .set('Authorization', `Bearer ${fixtures.borrowerToken}`)
      .set('Idempotency-Key', `ik_c_${Date.now()}_${rand1}`)
      .send({
        itemId: fixtures.item._id.toString(),
        startDate: '2026-12-10',
        endDate: '2026-12-11',
      });
    const bookingId = createRes.body.booking._id;

    await request(app)
      .post(`/v1/bookings/${bookingId}/accept`)
      .set('Authorization', `Bearer ${fixtures.lenderToken}`)
      .set('Idempotency-Key', `ik_a_${Date.now()}_${rand2}`);

    const qrRes = await request(app)
      .post(`/v1/bookings/${bookingId}/handover/qr`)
      .set('Authorization', `Bearer ${fixtures.lenderToken}`)
      .send({});
    await request(app)
      .post(`/v1/bookings/${bookingId}/handover/code`)
      .set('Authorization', `Bearer ${fixtures.borrowerToken}`)
      .set('Idempotency-Key', `ik_p_${Date.now()}_${rand3}`)
      .send({ code: qrRes.body.fallbackCode });

    const retQr = await request(app)
      .post(`/v1/bookings/${bookingId}/return/qr`)
      .set('Authorization', `Bearer ${fixtures.borrowerToken}`)
      .send({});
    await request(app)
      .post(`/v1/bookings/${bookingId}/return/code`)
      .set('Authorization', `Bearer ${fixtures.lenderToken}`)
      .set('Idempotency-Key', `ik_r_${Date.now()}_${rand4}`)
      .send({ code: retQr.body.fallbackCode });

    await request(app)
      .post(`/v1/bookings/${bookingId}/return/confirm`)
      .set('Authorization', `Bearer ${fixtures.lenderToken}`)
      .set('Idempotency-Key', `ik_ok_${Date.now()}_${rand5}`)
      .send({ outcome: 'ok' });

    return { ...fixtures, bookingId };
  }

  it('1. Hidden until both submit: unrevealed rating is not visible on profile, never leaks in averages, rater sees own', async () => {
    const { bookingId, borrowerToken, lenderToken, lender } = await setupCompletedBooking();

    // Borrower submits rating
    const rand = Math.random().toString(36).slice(2);
    const r1 = await request(app)
      .post(`/v1/bookings/${bookingId}/rating`)
      .set('Authorization', `Bearer ${borrowerToken}`)
      .set('Idempotency-Key', `ik_r1_${Date.now()}_${rand}`)
      .send({ stars: 5, comment: 'Great lender, camera worked perfectly!' });

    expect(r1.status).toBe(201);
    expect(r1.body.isRevealed).toBe(false);

    // Lender's public ratings list must be empty
    const publicList = await request(app).get(`/v1/users/${lender._id}/ratings`);
    expect(publicList.status).toBe(200);
    expect(publicList.body.ratings.length).toBe(0);

    // Lender's profile averages must not leak unrevealed ratings
    const lenderUser = await User.findById(lender._id);
    expect(lenderUser.ratingCount).toBe(0);
    expect(lenderUser.ratingAvg).toBe(0);

    // Lender checking booking ratings sees nothing (blind)
    const lenderView = await request(app)
      .get(`/v1/bookings/${bookingId}/ratings`)
      .set('Authorization', `Bearer ${lenderToken}`);
    expect(lenderView.status).toBe(200);
    expect(lenderView.body.ratings.length).toBe(0);

    // Borrower checking booking ratings sees ONLY their own submitted rating
    const borrowerView = await request(app)
      .get(`/v1/bookings/${bookingId}/ratings`)
      .set('Authorization', `Bearer ${borrowerToken}`);
    expect(borrowerView.status).toBe(200);
    expect(borrowerView.body.ratings.length).toBe(1);
    expect(borrowerView.body.ratings[0].stars).toBe(5);
  });

  it('2. Revealed on second rating: both become visible simultaneously, stats and trust scores updated', async () => {
    const { bookingId, borrowerToken, lenderToken, borrower, lender, item } =
      await setupCompletedBooking();

    const rand1 = Math.random().toString(36).slice(2);
    const rand2 = Math.random().toString(36).slice(2);

    // First: Borrower rates lender (5 stars)
    await request(app)
      .post(`/v1/bookings/${bookingId}/rating`)
      .set('Authorization', `Bearer ${borrowerToken}`)
      .set('Idempotency-Key', `ik_b_${Date.now()}_${rand1}`)
      .send({ stars: 5, comment: 'Punctual and helpful!' });

    // Second: Lender rates borrower (4 stars)
    const r2 = await request(app)
      .post(`/v1/bookings/${bookingId}/rating`)
      .set('Authorization', `Bearer ${lenderToken}`)
      .set('Idempotency-Key', `ik_l_${Date.now()}_${rand2}`)
      .send({ stars: 4, comment: 'Returned on time and in good condition.' });

    expect(r2.status).toBe(201);
    expect(r2.body.isRevealed).toBe(true);

    // Both ratings should now be revealed
    const allRatings = await Rating.find({ bookingId });
    expect(allRatings.length).toBe(2);
    expect(allRatings.every((r) => r.isRevealed)).toBe(true);

    // Lender profile should show 1 rating with 5 stars
    const updatedLender = await User.findById(lender._id);
    expect(updatedLender.ratingCount).toBe(1);
    expect(updatedLender.ratingAvg).toBe(5);

    // Borrower profile should show 1 rating with 4 stars
    const updatedBorrower = await User.findById(borrower._id);
    expect(updatedBorrower.ratingCount).toBe(1);
    expect(updatedBorrower.ratingAvg).toBe(4);

    // Item should reflect 5 stars
    const updatedItem = await Item.findById(item._id);
    expect(updatedItem.ratingCount).toBe(1);
    expect(updatedItem.ratingAvg).toBe(5);

    // Both can now view both ratings
    const bookingRatings = await request(app)
      .get(`/v1/bookings/${bookingId}/ratings`)
      .set('Authorization', `Bearer ${lenderToken}`);
    expect(bookingRatings.body.ratings.length).toBe(2);
  });

  it('3. Revealed by the job at exactly 7 days after completion', async () => {
    const { bookingId, borrowerToken, lender } = await setupCompletedBooking();

    const rand = Math.random().toString(36).slice(2);
    await request(app)
      .post(`/v1/bookings/${bookingId}/rating`)
      .set('Authorization', `Bearer ${borrowerToken}`)
      .set('Idempotency-Key', `ik_single_${Date.now()}_${rand}`)
      .send({ stars: 5, comment: 'Solo review' });

    // 6 days after completion: job should NOT reveal
    const now = new Date();
    await Booking.findByIdAndUpdate(bookingId, {
      $set: { completedAt: new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000) },
    });

    const jobRes1 = await revealRatingsJob();
    expect(jobRes1.revealedCount).toBe(0);

    const stillHidden = await Rating.findOne({ bookingId });
    expect(stillHidden.isRevealed).toBe(false);

    // 7.1 days after completion: job DOES reveal
    await Booking.findByIdAndUpdate(bookingId, {
      $set: { completedAt: new Date(now.getTime() - 7.1 * 24 * 60 * 60 * 1000) },
    });

    const jobRes2 = await revealRatingsJob();
    expect(jobRes2.revealedCount).toBe(1);

    const nowRevealed = await Rating.findOne({ bookingId });
    expect(nowRevealed.isRevealed).toBe(true);

    const updatedLender = await User.findById(lender._id);
    expect(updatedLender.ratingCount).toBe(1);
    expect(updatedLender.ratingAvg).toBe(5);
  });

  it('4. Duplicate rating rejected with 409 RATING_ALREADY_SUBMITTED', async () => {
    const { bookingId, borrowerToken } = await setupCompletedBooking();

    const rand1 = Math.random().toString(36).slice(2);
    const rand2 = Math.random().toString(36).slice(2);

    await request(app)
      .post(`/v1/bookings/${bookingId}/rating`)
      .set('Authorization', `Bearer ${borrowerToken}`)
      .set('Idempotency-Key', `ik_first_${Date.now()}_${rand1}`)
      .send({ stars: 5 });

    const duplicateRes = await request(app)
      .post(`/v1/bookings/${bookingId}/rating`)
      .set('Authorization', `Bearer ${borrowerToken}`)
      .set('Idempotency-Key', `ik_second_${Date.now()}_${rand2}`)
      .send({ stars: 4 });

    expect(duplicateRes.status).toBe(409);
    expect(duplicateRes.body.error.code).toBe('RATING_ALREADY_SUBMITTED');
  });

  it('5. Rating before completion rejected with 400 RATING_NOT_ALLOWED', async () => {
    const fixtures = await createBookingFixtures();
    // Booking in requested status
    const rand = Math.random().toString(36).slice(2);
    const createRes = await request(app)
      .post('/v1/bookings')
      .set('Authorization', `Bearer ${fixtures.borrowerToken}`)
      .set('Idempotency-Key', `ik_c_${Date.now()}_${rand}`)
      .send({
        itemId: fixtures.item._id.toString(),
        startDate: '2026-12-10',
        endDate: '2026-12-11',
      });
    const bookingId = createRes.body.booking._id;

    const rateRes = await request(app)
      .post(`/v1/bookings/${bookingId}/rating`)
      .set('Authorization', `Bearer ${fixtures.borrowerToken}`)
      .set('Idempotency-Key', `ik_early_${Date.now()}`)
      .send({ stars: 5 });

    expect(rateRes.status).toBe(400);
    expect(rateRes.body.error.code).toBe('RATING_NOT_ALLOWED');
  });

  it('6. Non-participant rating rejected with 403 FORBIDDEN', async () => {
    const { bookingId } = await setupCompletedBooking();
    const otherFixtures = await createBookingFixtures();

    const rateRes = await request(app)
      .post(`/v1/bookings/${bookingId}/rating`)
      .set('Authorization', `Bearer ${otherFixtures.borrowerToken}`)
      .set('Idempotency-Key', `ik_third_${Date.now()}`)
      .send({ stars: 5 });

    expect(rateRes.status).toBe(403);
    expect(rateRes.body.error.code).toBe('FORBIDDEN');
  });

  it('7. HTML tags in comment are cleanly stripped', async () => {
    const { bookingId, borrowerToken } = await setupCompletedBooking();

    const rand = Math.random().toString(36).slice(2);
    await request(app)
      .post(`/v1/bookings/${bookingId}/rating`)
      .set('Authorization', `Bearer ${borrowerToken}`)
      .set('Idempotency-Key', `ik_strip_${Date.now()}_${rand}`)
      .send({
        stars: 5,
        comment: '<script>alert("xss")</script><b>Super clean equipment!</b>',
      });

    const savedRating = await Rating.findOne({ bookingId });
    expect(savedRating.comment).toBe('alert("xss")Super clean equipment!');
    expect(savedRating.comment).not.toContain('<script>');
    expect(savedRating.comment).not.toContain('<b>');
  });
});
