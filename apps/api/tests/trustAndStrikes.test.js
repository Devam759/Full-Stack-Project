import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { setupTestDB, teardownTestDB, clearTestDB } from './setup/dbTestHelper.js';
import { createBookingFixtures } from './setup/bookingTestFixture.js';
import app from '../src/app.js';
import User from '../src/models/User.js';
import Booking from '../src/models/Booking.js';
import TrustEvent from '../src/models/TrustEvent.js';
import { Notification, clearRecordedEvents } from '@borrowloop/server-core';
import {
  applyStrike,
  reverseStrike,
  assertNotSuspended,
} from '@borrowloop/server-core/services/strikeService.js';
import { recordTrustEvent, recompute } from '@borrowloop/server-core/services/trustService.js';

describe('Phase 7e: Trust Events, Trust Score, and Strikes Integration Tests', () => {
  beforeAll(async () => {
    await setupTestDB();
    await User.init();
    await Booking.init();
    await Notification.init();
    await TrustEvent.init();
  });

  afterAll(async () => {
    await teardownTestDB();
  });

  beforeEach(async () => {
    await clearTestDB();
    clearRecordedEvents();
  });

  it('1. Strike ladder: Strike 1 warning notification, Strike 2 7-day ban with active status, Strike 3 permanent ban', async () => {
    const fixtures = await createBookingFixtures();
    const userId = fixtures.borrower._id;

    // Strike 1
    const strike1 = await applyStrike({ userId, reason: 'Late cancellation within 2 hours' });
    expect(strike1.strikes).toBe(1);
    expect(strike1.status).toBe('active');
    expect(strike1.banUntil).toBeNull();

    const notif1 = await Notification.findOne({ userId, type: 'strike_warning' });
    expect(notif1).toBeTruthy();

    // Strike 2
    const strike2 = await applyStrike({ userId, reason: 'Repeated late cancellation' });
    expect(strike2.strikes).toBe(2);
    expect(strike2.status).toBe('active');
    expect(strike2.banUntil).toBeTruthy();
    expect(new Date(strike2.banUntil).getTime()).toBeGreaterThan(Date.now());

    const notif2 = await Notification.findOne({ userId, type: 'suspension_started' });
    expect(notif2).toBeTruthy();

    // Strike 3
    const strike3 = await applyStrike({ userId, reason: 'Fraudulent item claim' });
    expect(strike3.strikes).toBe(3);
    expect(strike3.status).toBe('banned');
  });

  it('2. Ban expiry by timestamp: assertNotSuspended succeeds when banUntil is in the past', async () => {
    const fixtures = await createBookingFixtures();
    const user = fixtures.borrower;

    // Set banUntil to 1 minute ago
    user.banUntil = new Date(Date.now() - 60000);
    user.status = 'active';
    await user.save();

    // Should not throw
    expect(() => assertNotSuspended(user)).not.toThrow();
  });

  it('3. Strike reversal restores status and banUntil', async () => {
    const fixtures = await createBookingFixtures();
    const userId = fixtures.borrower._id;

    // Bring to strike 3 (banned)
    await applyStrike({ userId, reason: 'Issue 1' });
    await applyStrike({ userId, reason: 'Issue 2' });
    await applyStrike({ userId, reason: 'Issue 3' });

    let u = await User.findById(userId);
    expect(u.status).toBe('banned');

    // Reverse strike 3 -> back to active with temporary ban
    const rev1 = await reverseStrike({ userId, reason: 'Appeal accepted' });
    expect(rev1.strikes).toBe(2);
    expect(rev1.status).toBe('active');

    // Reverse strike 2 -> banUntil cleared
    const rev2 = await reverseStrike({ userId, reason: 'Appeal accepted' });
    expect(rev2.strikes).toBe(1);
    expect(rev2.banUntil).toBeNull();
  });

  it('4. Suspended user is blocked from creating bookings and items', async () => {
    const fixtures = await createBookingFixtures();
    const user = fixtures.borrower;

    // Apply 7-day ban
    await applyStrike({ userId: user._id, reason: 'Violation 1' });
    await applyStrike({ userId: user._id, reason: 'Violation 2' });

    // Booking create should fail with ACCOUNT_SUSPENDED (403)
    const bookingRes = await request(app)
      .post('/v1/bookings')
      .set('Authorization', `Bearer ${fixtures.borrowerToken}`)
      .set('Idempotency-Key', `ik_blocked_${Date.now()}`)
      .send({
        itemId: fixtures.item._id.toString(),
        startDate: '2026-12-20',
        endDate: '2026-12-22',
      });
    expect(bookingRes.status).toBe(403);
    expect(bookingRes.body.error.code).toBe('ACCOUNT_SUSPENDED');

    // Item create should fail with ACCOUNT_SUSPENDED (403)
    const itemRes = await request(app)
      .post('/v1/items')
      .set('Authorization', `Bearer ${fixtures.borrowerToken}`)
      .send({
        title: 'Blocked Item',
        description: 'Should not be allowed to list while suspended',
        category: 'electronics',
        condition: 'good',
        rentPerDayPaise: 5000,
        depositPaise: 10000,
        communityId: fixtures.community._id.toString(),
      });
    expect(itemRes.status).toBe(403);
    expect(itemRes.body.error.code).toBe('ACCOUNT_SUSPENDED');
  });

  it('5. Suspended user CAN still return an item they hold', async () => {
    const fixtures = await createBookingFixtures();

    const rand1 = Math.random().toString(36).slice(2);
    const rand2 = Math.random().toString(36).slice(2);
    const rand3 = Math.random().toString(36).slice(2);

    // Create & accept booking
    const createRes = await request(app)
      .post('/v1/bookings')
      .set('Authorization', `Bearer ${fixtures.borrowerToken}`)
      .set('Idempotency-Key', `ik_c_${Date.now()}_${rand1}`)
      .send({
        itemId: fixtures.item._id.toString(),
        startDate: '2026-12-10',
        endDate: '2026-12-12',
      });
    const bookingId = createRes.body.booking._id;

    await request(app)
      .post(`/v1/bookings/${bookingId}/accept`)
      .set('Authorization', `Bearer ${fixtures.lenderToken}`)
      .set('Idempotency-Key', `ik_a_${Date.now()}_${rand2}`);

    // Pickup
    const qrRes = await request(app)
      .post(`/v1/bookings/${bookingId}/handover/qr`)
      .set('Authorization', `Bearer ${fixtures.lenderToken}`)
      .send({});
    await request(app)
      .post(`/v1/bookings/${bookingId}/handover/code`)
      .set('Authorization', `Bearer ${fixtures.borrowerToken}`)
      .set('Idempotency-Key', `ik_p_${Date.now()}_${rand3}`)
      .send({ code: qrRes.body.fallbackCode });

    // Suspend borrower AFTER item is picked up
    await applyStrike({ userId: fixtures.borrower._id, reason: 'Suspended during borrow' });
    await applyStrike({ userId: fixtures.borrower._id, reason: 'Suspended during borrow' });

    // Borrower must still be allowed to generate return QR!
    const returnQrRes = await request(app)
      .post(`/v1/bookings/${bookingId}/return/qr`)
      .set('Authorization', `Bearer ${fixtures.borrowerToken}`)
      .send({});

    expect(returnQrRes.status).toBe(200);
    expect(returnQrRes.body.qrToken).toBeTruthy();
  });

  it('6. Recompute is idempotent and replayed events do not double count', async () => {
    const fixtures = await createBookingFixtures();
    const userId = fixtures.borrower._id;

    // Record a penalty trust event
    const event1 = await recordTrustEvent({
      userId,
      type: 'late_cancel',
      eventKey: `test_penalty_1`,
      meta: { reason: 'late_cancel' },
    });
    expect(event1).toBeTruthy();

    // Replay identical eventKey
    const duplicate = await recordTrustEvent({
      userId,
      type: 'late_cancel',
      eventKey: `test_penalty_1`,
      meta: { reason: 'late_cancel' },
    });
    expect(duplicate._id.toString()).toBe(event1._id.toString());

    // Only 1 document exists
    const totalEvents = await TrustEvent.countDocuments({ userId });
    expect(totalEvents).toBe(1);

    // Recompute score: 50 base - 3 (late_cancel) = 47
    const result1 = await recompute(userId);
    expect(result1.trustScore).toBe(47);

    // Second recompute yields identical score
    const result2 = await recompute(userId);
    expect(result2.trustScore).toBe(47);

    const user = await User.findById(userId);
    expect(user.trustScore).toBe(47);
  });
});
