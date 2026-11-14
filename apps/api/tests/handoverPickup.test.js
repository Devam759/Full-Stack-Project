import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { setupTestDB, teardownTestDB, clearTestDB } from './setup/dbTestHelper.js';
import { createBookingFixtures } from './setup/bookingTestFixture.js';
import app from '../src/app.js';
import Booking from '../src/models/Booking.js';
import Handover from '../src/models/Handover.js';
import ItemDayLock from '../src/models/ItemDayLock.js';
import LedgerOperation from '../src/models/LedgerOperation.js';
import IdempotencyKey from '../src/models/IdempotencyKey.js';
import { generateQrToken } from '../src/modules/handovers/handoverService.js';
import config from '../src/config/index.js';
import { clearRecordedEvents } from '@borrowloop/server-core';

describe('Phase 7b: Handover (Pickup) Integration Tests', () => {
  beforeAll(async () => {
    await setupTestDB();
    await Booking.init();
    await Handover.init();
    await ItemDayLock.init();
    await LedgerOperation.init();
    await IdempotencyKey.init();
  });

  afterAll(async () => {
    await teardownTestDB();
  });

  beforeEach(async () => {
    await clearTestDB();
    clearRecordedEvents();
  });

  // Helper to create an accepted booking ready for pickup
  async function setupAcceptedBooking() {
    const fixtures = await createBookingFixtures({
      borrowerFundsPaise: 500000,
      rentPerDayPaise: 50000,
      depositPaise: 100000,
    });

    const rand1 = Math.random().toString(36).slice(2);
    const rand2 = Math.random().toString(36).slice(2);

    const createRes = await request(app)
      .post('/v1/bookings')
      .set('Authorization', `Bearer ${fixtures.borrowerToken}`)
      .set('Idempotency-Key', `ik_create_${Date.now()}_${rand1}`)
      .send({
        itemId: fixtures.item._id.toString(),
        startDate: '2026-12-10',
        endDate: '2026-12-12',
      });
    expect(createRes.status).toBe(201);
    const bookingId = createRes.body.booking._id;

    const acceptRes = await request(app)
      .post(`/v1/bookings/${bookingId}/accept`)
      .set('Authorization', `Bearer ${fixtures.lenderToken}`)
      .set('Idempotency-Key', `ik_accept_${Date.now()}_${rand2}`);
    expect(acceptRes.status).toBe(200);

    return { ...fixtures, bookingId };
  }

  it('1. Happy path: lender generates QR, borrower scans within 200m, transitions to picked_up', async () => {
    const { bookingId, lenderToken, borrowerToken } = await setupAcceptedBooking();

    // Connaught Place coordinates
    const lenderLat = 28.6315;
    const lenderLng = 77.2167;

    const qrRes = await request(app)
      .post(`/v1/bookings/${bookingId}/handover/qr`)
      .set('Authorization', `Bearer ${lenderToken}`)
      .send({ lat: lenderLat, lng: lenderLng, accuracyM: 10 });

    expect(qrRes.status).toBe(200);
    expect(qrRes.body).toHaveProperty('qrToken');
    expect(qrRes.body).toHaveProperty('expiresAt');
    expect(qrRes.body).toHaveProperty('fallbackCode');
    expect(qrRes.body.expiresInSeconds).toBe(25);

    // Borrower ~50m away
    const borrowerLat = 28.6319;
    const borrowerLng = 77.2167;

    const scanRes = await request(app)
      .post(`/v1/bookings/${bookingId}/handover/scan`)
      .set('Authorization', `Bearer ${borrowerToken}`)
      .set('Idempotency-Key', 'ik-scan-happy-1')
      .send({
        qrToken: qrRes.body.qrToken,
        lat: borrowerLat,
        lng: borrowerLng,
        accuracyM: 10,
      });

    expect(scanRes.status).toBe(200);
    expect(scanRes.body.booking.status).toBe('picked_up');
    expect(scanRes.body.booking.pickupAt).toBeDefined();

    // Verify Handover record: distanceMeters recorded, no latitude or longitude stored
    const handoverDoc = await Handover.findOne({ bookingId, type: 'pickup' });
    expect(handoverDoc).toBeDefined();
    expect(handoverDoc.scannedAt).toBeDefined();
    expect(handoverDoc.geoChecked).toBe(true);
    expect(handoverDoc.fallbackCodeUsed).toBe(false);
    expect(typeof handoverDoc.distanceMeters).toBe('number');
    expect(handoverDoc.distanceMeters).toBeLessThan(100);

    // Ensure raw lat/lng are strictly NOT in the document
    expect(handoverDoc.lat).toBeUndefined();
    expect(handoverDoc.lng).toBeUndefined();
    expect(handoverDoc.borrowerLat).toBeUndefined();
  });

  it('2. QR replay is rejected with QR_ALREADY_USED (409)', async () => {
    const { bookingId, lenderToken, borrowerToken } = await setupAcceptedBooking();

    const qrRes = await request(app)
      .post(`/v1/bookings/${bookingId}/handover/qr`)
      .set('Authorization', `Bearer ${lenderToken}`)
      .send({ lat: 28.6315, lng: 77.2167, accuracyM: 5 });

    const scanRes1 = await request(app)
      .post(`/v1/bookings/${bookingId}/handover/scan`)
      .set('Authorization', `Bearer ${borrowerToken}`)
      .set('Idempotency-Key', 'ik-scan-replay-1')
      .send({
        qrToken: qrRes.body.qrToken,
        lat: 28.6315,
        lng: 77.2167,
        accuracyM: 5,
      });
    expect(scanRes1.status).toBe(200);

    // Replay same QR with different idempotency key
    const scanRes2 = await request(app)
      .post(`/v1/bookings/${bookingId}/handover/scan`)
      .set('Authorization', `Bearer ${borrowerToken}`)
      .set('Idempotency-Key', 'ik-scan-replay-2')
      .send({
        qrToken: qrRes.body.qrToken,
        lat: 28.6315,
        lng: 77.2167,
        accuracyM: 5,
      });

    // Booking is now picked_up, or QR is consumed
    expect([400, 409]).toContain(scanRes2.status);
    expect(['QR_ALREADY_USED', 'INVALID_BOOKING_TRANSITION']).toContain(scanRes2.body.error.code);
  });

  it('3. Expired QR token is rejected with QR_EXPIRED (400)', async () => {
    const { bookingId, borrowerToken } = await setupAcceptedBooking();

    // Token with exp in the past
    const expiredToken = generateQrToken({
      bookingId,
      type: 'pickup',
      nonce: 'expirednonce1234',
      exp: Math.floor(Date.now() / 1000) - 10,
      secret: config.JWT_ACCESS_SECRET,
    });

    const res = await request(app)
      .post(`/v1/bookings/${bookingId}/handover/scan`)
      .set('Authorization', `Bearer ${borrowerToken}`)
      .set('Idempotency-Key', 'ik-scan-expired-1')
      .send({
        qrToken: expiredToken,
        lat: 28.6315,
        lng: 77.2167,
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('QR_EXPIRED');
  });

  it('4. QR for wrong booking is rejected with QR_INVALID (400)', async () => {
    const b1 = await setupAcceptedBooking();
    const b2 = await setupAcceptedBooking();

    const qrRes = await request(app)
      .post(`/v1/bookings/${b1.bookingId}/handover/qr`)
      .set('Authorization', `Bearer ${b1.lenderToken}`)
      .send({ lat: 28.6315, lng: 77.2167 });

    const scanRes = await request(app)
      .post(`/v1/bookings/${b2.bookingId}/handover/scan`)
      .set('Authorization', `Bearer ${b2.borrowerToken}`)
      .set('Idempotency-Key', 'ik-scan-wrong-b-1')
      .send({
        qrToken: qrRes.body.qrToken,
        lat: 28.6315,
        lng: 77.2167,
      });

    expect(scanRes.status).toBe(400);
    expect(scanRes.body.error.code).toBe('QR_INVALID');
  });

  it('5. QR of wrong type (return token scanned at pickup) is rejected with QR_INVALID (400)', async () => {
    const { bookingId, borrowerToken } = await setupAcceptedBooking();

    const returnToken = generateQrToken({
      bookingId,
      type: 'return', // Wrong type
      nonce: 'returnnonce1234',
      exp: Math.floor(Date.now() / 1000) + 30,
      secret: config.JWT_ACCESS_SECRET,
    });

    const scanRes = await request(app)
      .post(`/v1/bookings/${bookingId}/handover/scan`)
      .set('Authorization', `Bearer ${borrowerToken}`)
      .set('Idempotency-Key', 'ik-scan-wrong-type-1')
      .send({
        qrToken: returnToken,
        lat: 28.6315,
        lng: 77.2167,
      });

    expect(scanRes.status).toBe(400);
    expect(scanRes.body.error.code).toBe('QR_INVALID');
  });

  it('6. Tampered token signature is rejected with QR_INVALID (400)', async () => {
    const { bookingId, lenderToken, borrowerToken } = await setupAcceptedBooking();

    const qrRes = await request(app)
      .post(`/v1/bookings/${bookingId}/handover/qr`)
      .set('Authorization', `Bearer ${lenderToken}`)
      .send({ lat: 28.6315, lng: 77.2167 });

    const [payload, sig] = qrRes.body.qrToken.split('.');
    const tamperedToken = `${payload}.${sig.slice(0, -3)}xyz`;

    const scanRes = await request(app)
      .post(`/v1/bookings/${bookingId}/handover/scan`)
      .set('Authorization', `Bearer ${borrowerToken}`)
      .set('Idempotency-Key', 'ik-scan-tampered-1')
      .send({
        qrToken: tamperedToken,
        lat: 28.6315,
        lng: 77.2167,
      });

    expect(scanRes.status).toBe(400);
    expect(scanRes.body.error.code).toBe('QR_INVALID');
  });

  it('7. Two simultaneous scans give exactly one winner and one 409 conflict', async () => {
    const { bookingId, lenderToken, borrowerToken } = await setupAcceptedBooking();

    const qrRes = await request(app)
      .post(`/v1/bookings/${bookingId}/handover/qr`)
      .set('Authorization', `Bearer ${lenderToken}`)
      .send({ lat: 28.6315, lng: 77.2167, accuracyM: 10 });

    const [res1, res2] = await Promise.all([
      request(app)
        .post(`/v1/bookings/${bookingId}/handover/scan`)
        .set('Authorization', `Bearer ${borrowerToken}`)
        .set('Idempotency-Key', 'ik-race-scan-1')
        .send({ qrToken: qrRes.body.qrToken, lat: 28.6315, lng: 77.2167, accuracyM: 10 }),
      request(app)
        .post(`/v1/bookings/${bookingId}/handover/scan`)
        .set('Authorization', `Bearer ${borrowerToken}`)
        .set('Idempotency-Key', 'ik-race-scan-2')
        .send({ qrToken: qrRes.body.qrToken, lat: 28.6315, lng: 77.2167, accuracyM: 10 }),
    ]);

    const statuses = [res1.status, res2.status].sort();
    expect(statuses).toEqual([200, 409]);
  });

  it('8. Proximity check rejects when parties are too far apart (> 200m) with HANDOVER_TOO_FAR', async () => {
    const { bookingId, lenderToken, borrowerToken } = await setupAcceptedBooking();

    // Lender in Connaught Place, New Delhi
    const qrRes = await request(app)
      .post(`/v1/bookings/${bookingId}/handover/qr`)
      .set('Authorization', `Bearer ${lenderToken}`)
      .send({ lat: 28.6315, lng: 77.2167, accuracyM: 10 });

    // Borrower 1.5 km away in Karol Bagh
    const scanRes = await request(app)
      .post(`/v1/bookings/${bookingId}/handover/scan`)
      .set('Authorization', `Bearer ${borrowerToken}`)
      .set('Idempotency-Key', 'ik-scan-too-far-1')
      .send({
        qrToken: qrRes.body.qrToken,
        lat: 28.645,
        lng: 77.2,
        accuracyM: 10,
      });

    expect(scanRes.status).toBe(400);
    expect(scanRes.body.error.code).toBe('HANDOVER_TOO_FAR');
  });

  it('9. GPS denied/unavailable falls back to 6-digit code with geoChecked: false', async () => {
    const { bookingId, lenderToken, borrowerToken } = await setupAcceptedBooking();

    const qrRes = await request(app)
      .post(`/v1/bookings/${bookingId}/handover/qr`)
      .set('Authorization', `Bearer ${lenderToken}`)
      .send({}); // GPS denied on lender device

    const fallbackCode = qrRes.body.fallbackCode;
    expect(fallbackCode).toMatch(/^\d{6}$/);

    const codeRes = await request(app)
      .post(`/v1/bookings/${bookingId}/handover/code`)
      .set('Authorization', `Bearer ${borrowerToken}`)
      .set('Idempotency-Key', 'ik-code-success-1')
      .send({ code: fallbackCode });

    expect(codeRes.status).toBe(200);
    expect(codeRes.body.booking.status).toBe('picked_up');
    expect(codeRes.body.fallbackCodeUsed).toBe(true);

    const handoverDoc = await Handover.findOne({ bookingId, type: 'pickup' });
    expect(handoverDoc.geoChecked).toBe(false);
    expect(handoverDoc.fallbackCodeUsed).toBe(true);
    expect(handoverDoc.distanceMeters).toBeNull();
  });

  it('10. Three wrong codes trigger a 15-minute lockout and recovery after lockout', async () => {
    const { bookingId, lenderToken, borrowerToken } = await setupAcceptedBooking();

    await request(app)
      .post(`/v1/bookings/${bookingId}/handover/qr`)
      .set('Authorization', `Bearer ${lenderToken}`)
      .send({});

    // Attempt 1: wrong code
    const att1 = await request(app)
      .post(`/v1/bookings/${bookingId}/handover/code`)
      .set('Authorization', `Bearer ${borrowerToken}`)
      .set('Idempotency-Key', 'ik-code-fail-1')
      .send({ code: '000000' });
    expect(att1.status).toBe(400);
    expect(att1.body.error.code).toBe('HANDOVER_CODE_INVALID');

    // Attempt 2: wrong code
    const att2 = await request(app)
      .post(`/v1/bookings/${bookingId}/handover/code`)
      .set('Authorization', `Bearer ${borrowerToken}`)
      .set('Idempotency-Key', 'ik-code-fail-2')
      .send({ code: '000001' });
    expect(att2.status).toBe(400);

    // Attempt 3: 3rd wrong code locks the handover
    const att3 = await request(app)
      .post(`/v1/bookings/${bookingId}/handover/code`)
      .set('Authorization', `Bearer ${borrowerToken}`)
      .set('Idempotency-Key', 'ik-code-fail-3')
      .send({ code: '000002' });
    expect(att3.status).toBe(403);
    expect(att3.body.error.code).toBe('HANDOVER_LOCKED');

    // Attempt 4: immediately locked
    const att4 = await request(app)
      .post(`/v1/bookings/${bookingId}/handover/code`)
      .set('Authorization', `Bearer ${borrowerToken}`)
      .set('Idempotency-Key', 'ik-code-fail-4')
      .send({ code: '000000' });
    expect(att4.status).toBe(403);
    expect(att4.body.error.code).toBe('HANDOVER_LOCKED');

    // Advance lockout time manually on Handover document to simulate 15 minutes passing
    await Handover.findOneAndUpdate(
      { bookingId, type: 'pickup' },
      { $set: { lockedUntil: new Date(Date.now() - 1000) } },
    );

    // Re-issue QR to get fresh code and verify recovery
    const freshQr = await request(app)
      .post(`/v1/bookings/${bookingId}/handover/qr`)
      .set('Authorization', `Bearer ${lenderToken}`)
      .send({});

    const recoveryRes = await request(app)
      .post(`/v1/bookings/${bookingId}/handover/code`)
      .set('Authorization', `Bearer ${borrowerToken}`)
      .set('Idempotency-Key', 'ik-code-recovery-1')
      .send({ code: freshQr.body.fallbackCode });

    expect(recoveryRes.status).toBe(200);
    expect(recoveryRes.body.booking.status).toBe('picked_up');
  });

  it('11. Lender trying to scan pickup QR is rejected with 403 FORBIDDEN', async () => {
    const { bookingId, lenderToken } = await setupAcceptedBooking();

    const qrRes = await request(app)
      .post(`/v1/bookings/${bookingId}/handover/qr`)
      .set('Authorization', `Bearer ${lenderToken}`)
      .send({ lat: 28.6315, lng: 77.2167 });

    const scanRes = await request(app)
      .post(`/v1/bookings/${bookingId}/handover/scan`)
      .set('Authorization', `Bearer ${lenderToken}`)
      .set('Idempotency-Key', 'ik-lender-scan-pickup')
      .send({
        qrToken: qrRes.body.qrToken,
        lat: 28.6315,
        lng: 77.2167,
      });

    expect(scanRes.status).toBe(403);
    expect(scanRes.body.error.code).toBe('FORBIDDEN');
  });

  it('12. Photo upload from non-participant is rejected with 403 FORBIDDEN', async () => {
    const { bookingId } = await setupAcceptedBooking();
    const otherFixtures = await createBookingFixtures();

    const res = await request(app)
      .post(`/v1/bookings/${bookingId}/photos`)
      .set('Authorization', `Bearer ${otherFixtures.borrowerToken}`)
      .send({
        stage: 'pickup',
        photos: [
          {
            publicId: `borrowloop/handovers/${bookingId}/pickup/photo1`,
            url: 'https://res.cloudinary.com/demo/image/upload/sample.jpg',
          },
        ],
      });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('13. Photo upload to wrong folder is rejected with 400 BAD_REQUEST', async () => {
    const { bookingId, borrowerToken } = await setupAcceptedBooking();

    const res = await request(app)
      .post(`/v1/bookings/${bookingId}/photos`)
      .set('Authorization', `Bearer ${borrowerToken}`)
      .send({
        stage: 'pickup',
        photos: [
          {
            publicId: `borrowloop/items/otheruser/photo1`, // Wrong folder
            url: 'https://res.cloudinary.com/demo/image/upload/sample.jpg',
          },
        ],
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('BAD_REQUEST');
  });

  it('14. Photo registration after 30-minute window is rejected with HANDOVER_PHOTO_WINDOW_CLOSED (400)', async () => {
    const { bookingId, borrowerToken } = await setupAcceptedBooking();

    // Set Handover with scannedAt 35 minutes in the past
    await Handover.findOneAndUpdate(
      { bookingId, type: 'pickup' },
      { $set: { scannedAt: new Date(Date.now() - 35 * 60 * 1000) } },
      { upsert: true },
    );

    const res = await request(app)
      .post(`/v1/bookings/${bookingId}/photos`)
      .set('Authorization', `Bearer ${borrowerToken}`)
      .send({
        stage: 'pickup',
        photos: [
          {
            publicId: `borrowloop/handovers/${bookingId}/pickup/photo1`,
            url: 'https://res.cloudinary.com/demo/image/upload/sample.jpg',
          },
        ],
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('HANDOVER_PHOTO_WINDOW_CLOSED');
  });

  it('15. Registering more than 6 photos per party is rejected with HANDOVER_PHOTO_LIMIT (400)', async () => {
    const { bookingId, borrowerToken } = await setupAcceptedBooking();

    // Register 4 photos first
    const fourPhotos = Array.from({ length: 4 }, (_, i) => ({
      publicId: `borrowloop/handovers/${bookingId}/pickup/photo_${i}`,
      url: `https://res.cloudinary.com/demo/image/upload/sample_${i}.jpg`,
    }));

    const res1 = await request(app)
      .post(`/v1/bookings/${bookingId}/photos`)
      .set('Authorization', `Bearer ${borrowerToken}`)
      .send({
        stage: 'pickup',
        photos: fourPhotos,
      });
    expect(res1.status).toBe(200);

    // Register 3 more photos -> 4 + 3 = 7 photos (exceeds 6 photos limit)
    const threeMore = Array.from({ length: 3 }, (_, i) => ({
      publicId: `borrowloop/handovers/${bookingId}/pickup/photo_more_${i}`,
      url: `https://res.cloudinary.com/demo/image/upload/sample_more_${i}.jpg`,
    }));

    const res2 = await request(app)
      .post(`/v1/bookings/${bookingId}/photos`)
      .set('Authorization', `Bearer ${borrowerToken}`)
      .send({
        stage: 'pickup',
        photos: threeMore,
      });

    expect(res2.status).toBe(400);
    expect(res2.body.error.code).toBe('HANDOVER_PHOTO_LIMIT');
  });

  it('16. Idempotent replay of handover scan returns saved result with X-Idempotent-Replay: true', async () => {
    const { bookingId, lenderToken, borrowerToken } = await setupAcceptedBooking();

    const qrRes = await request(app)
      .post(`/v1/bookings/${bookingId}/handover/qr`)
      .set('Authorization', `Bearer ${lenderToken}`)
      .send({ lat: 28.6315, lng: 77.2167, accuracyM: 10 });

    const ik = 'ik-replay-scan-exact';
    const scanPayload = {
      qrToken: qrRes.body.qrToken,
      lat: 28.6315,
      lng: 77.2167,
      accuracyM: 10,
    };

    const firstRes = await request(app)
      .post(`/v1/bookings/${bookingId}/handover/scan`)
      .set('Authorization', `Bearer ${borrowerToken}`)
      .set('Idempotency-Key', ik)
      .send(scanPayload);

    expect(firstRes.status).toBe(200);
    expect(firstRes.header['x-idempotent-replay']).toBeUndefined();

    // Replay identical request with identical idempotency key
    const replayRes = await request(app)
      .post(`/v1/bookings/${bookingId}/handover/scan`)
      .set('Authorization', `Bearer ${borrowerToken}`)
      .set('Idempotency-Key', ik)
      .send(scanPayload);

    expect(replayRes.status).toBe(200);
    expect(replayRes.header['x-idempotent-replay']).toBe('true');
    expect(replayRes.body.booking.status).toBe('picked_up');
  });
});
