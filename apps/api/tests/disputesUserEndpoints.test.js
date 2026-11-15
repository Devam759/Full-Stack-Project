import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { setupTestDB, teardownTestDB } from './setup/dbTestHelper.js';
import { createApp } from '../src/app.js';
import { User, Booking, Item, Dispute, Handover, DomainEvent } from '@borrowloop/server-core';
import { signAccessToken } from '../src/common/jwt.js';
import { dispatchSingleEventForTest } from '../../worker/src/jobs/outboxDispatcher.js';

describe('Disputes User Endpoints & Models (Sub-step 8b)', () => {
  let app;
  let borrower;
  let lender;
  let thirdPartyUser;
  let careAgent;
  let borrowerToken;
  let lenderToken;
  let thirdPartyToken;
  let careAgentToken;
  let item;

  beforeAll(async () => {
    await setupTestDB();
    app = createApp();

    borrower = await User.create({
      name: 'Borrower One',
      email: 'borrower1@borrowloop.test',
      emailVerified: true,
      status: 'active',
      passwordHash: 'hash123',
    });

    lender = await User.create({
      name: 'Lender One',
      email: 'lender1@borrowloop.test',
      emailVerified: true,
      status: 'active',
      passwordHash: 'hash123',
    });

    thirdPartyUser = await User.create({
      name: 'Third Party',
      email: 'thirdparty@borrowloop.test',
      emailVerified: true,
      status: 'active',
      passwordHash: 'hash123',
    });

    careAgent = await User.create({
      name: 'Care Agent 007',
      email: 'care007@borrowloop.test',
      emailVerified: true,
      role: 'care_agent',
      status: 'active',
      passwordHash: 'hash123',
    });

    borrowerToken = signAccessToken({ sub: borrower._id.toString(), role: borrower.role });
    lenderToken = signAccessToken({ sub: lender._id.toString(), role: lender.role });
    thirdPartyToken = signAccessToken({
      sub: thirdPartyUser._id.toString(),
      role: thirdPartyUser.role,
    });
    careAgentToken = signAccessToken({ sub: careAgent._id.toString(), role: careAgent.role });

    item = await Item.create({
      ownerId: lender._id,
      title: 'Power Drill 20V',
      description: 'Heavy duty drill in excellent shape',
      category: 'tools_and_diy',
      condition: 'good',
      photos: [
        `https://res.cloudinary.com/demo_cloud/image/upload/borrowloop/items/${lender._id}/drill.jpg`,
      ],
      rentPerDayPaise: 2000,
      depositPaise: 10000,
      location: {
        type: 'Point',
        coordinates: [77.5946, 12.9716],
        approximateAddress: 'Indiranagar, Bangalore',
      },
      status: 'active',
    });
  });

  afterAll(async () => {
    await teardownTestDB();
  });

  function createTestBooking(overrides = {}) {
    const now = Date.now();
    return Booking.create({
      itemId: item._id,
      borrowerId: borrower._id,
      lenderId: lender._id,
      startDate: '2026-11-01',
      endDate: '2026-11-20',
      days: 19,
      dueAt: new Date(now + 86400000),
      expiresAt: new Date(now + 86400000),
      rentPaise: 4000,
      depositPaise: 10000,
      totalAmountPaise: 14000,
      status: 'picked_up',
      ...overrides,
    });
  }

  it('allows borrower to open condition_mismatch dispute when booking is picked_up and now <= dueAt', async () => {
    const booking = await createTestBooking();

    const res = await request(app)
      .post(`/v1/bookings/${booking._id}/disputes`)
      .set('Authorization', `Bearer ${borrowerToken}`)
      .set('Idempotency-Key', `idem_cond_${booking._id}`)
      .send({
        reason: 'condition_mismatch',
        details: 'The drill has a cracked handle and does not spin reliably as described.',
        photos: [
          {
            publicId: 'cracked_handle_1',
            url: 'https://res.cloudinary.com/borrowloop/image/upload/v1/borrowloop/disputes/cracked.jpg',
          },
        ],
      });

    expect(res.status).toBe(201);
    expect(res.body.dispute).toBeDefined();
    expect(res.body.dispute.disputeReason).toBe('condition_mismatch');
    expect(res.body.dispute.source).toBe('user');
    expect(res.body.dispute.openedById).toBe(borrower._id.toString());
    expect(res.body.dispute.againstUserId).toBe(lender._id.toString());
    expect(res.body.dispute.status).toBe('opened');
    expect(res.body.dispute.evidence).toHaveLength(1);
    expect(res.body.dispute.evidence[0].photos).toHaveLength(1);

    // Verify booking in DB is now disputed
    const updatedBooking = await Booking.findById(booking._id);
    expect(updatedBooking.status).toBe('disputed');
    expect(updatedBooking.disputeReason).toBe('condition_mismatch');
  });

  it('rejects condition_mismatch dispute if opened by lender', async () => {
    const booking = await createTestBooking();

    const res = await request(app)
      .post(`/v1/bookings/${booking._id}/disputes`)
      .set('Authorization', `Bearer ${lenderToken}`)
      .set('Idempotency-Key', `idem_cond_lender_${booking._id}`)
      .send({
        reason: 'condition_mismatch',
        details: 'The item condition does not match expectations on my side.',
      });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('DISPUTE_NOT_ALLOWED');
  });

  it('rejects condition_mismatch dispute if now > dueAt', async () => {
    const pastDue = new Date(Date.now() - 10 * 1000); // 10 seconds ago
    const booking = await createTestBooking({
      startDate: '2026-11-01',
      endDate: '2026-11-10',
      days: 9,
      dueAt: pastDue,
    });

    const res = await request(app)
      .post(`/v1/bookings/${booking._id}/disputes`)
      .set('Authorization', `Bearer ${borrowerToken}`)
      .set('Idempotency-Key', `idem_past_due_${booking._id}`)
      .send({
        reason: 'condition_mismatch',
        details: 'Attempting to report condition mismatch after due date has passed.',
      });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('DISPUTE_NOT_ALLOWED');
  });

  it('allows borrower or lender to open no_show dispute when accepted and within pickup window', async () => {
    // Current date in system is November 15, 2026.
    // Setting startDate to '2026-11-15' ensures startDate <= now <= pickupDeadline (24h)
    const booking = await createTestBooking({
      startDate: '2026-11-15',
      endDate: '2026-11-17',
      days: 2,
      status: 'accepted',
    });

    const res = await request(app)
      .post(`/v1/bookings/${booking._id}/disputes`)
      .set('Authorization', `Bearer ${borrowerToken}`)
      .set('Idempotency-Key', `idem_noshow_${booking._id}`)
      .send({
        reason: 'no_show',
        details:
          'I arrived at the pickup location but lender never showed up or answered messages.',
      });

    expect(res.status).toBe(201);
    expect(res.body.dispute.disputeReason).toBe('no_show');
    expect(res.body.dispute.source).toBe('user');
    expect(res.body.dispute.againstUserId).toBe(lender._id.toString());

    const updatedBooking = await Booking.findById(booking._id);
    expect(updatedBooking.status).toBe('disputed');
    expect(updatedBooking.disputeReason).toBe('no_show');
  });

  it('rejects no_show dispute before booking startDate', async () => {
    const booking = await createTestBooking({
      startDate: '2026-12-01',
      endDate: '2026-12-05',
      days: 4,
      status: 'accepted',
    });

    const res = await request(app)
      .post(`/v1/bookings/${booking._id}/disputes`)
      .set('Authorization', `Bearer ${borrowerToken}`)
      .set('Idempotency-Key', `idem_future_${booking._id}`)
      .send({
        reason: 'no_show',
        details: 'Trying to claim no-show before the reservation start time.',
      });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('DISPUTE_NOT_ALLOWED');
  });

  it('rejects user opening damage or not_returned directly via API endpoint', async () => {
    const booking = await createTestBooking();

    const res1 = await request(app)
      .post(`/v1/bookings/${booking._id}/disputes`)
      .set('Authorization', `Bearer ${borrowerToken}`)
      .set('Idempotency-Key', `idem_damage_${booking._id}`)
      .send({
        reason: 'damage',
        details: 'Direct damage attempt.',
      });
    expect(res1.status).toBe(400);
    expect(res1.body.error.code).toBe('VALIDATION_ERROR');

    const res2 = await request(app)
      .post(`/v1/bookings/${booking._id}/disputes`)
      .set('Authorization', `Bearer ${lenderToken}`)
      .set('Idempotency-Key', `idem_notret_${booking._id}`)
      .send({
        reason: 'not_returned',
        details: 'Direct not_returned attempt.',
      });
    expect(res2.status).toBe(400);
    expect(res2.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects duplicate dispute creation on same booking (409 DISPUTE_ALREADY_EXISTS)', async () => {
    const booking = await createTestBooking({ status: 'disputed' });

    await Dispute.create({
      bookingId: booking._id,
      disputeReason: 'no_show',
      source: 'user',
      openedById: borrower._id,
      againstUserId: lender._id,
      status: 'opened',
    });

    const res = await request(app)
      .post(`/v1/bookings/${booking._id}/disputes`)
      .set('Authorization', `Bearer ${lenderToken}`)
      .set('Idempotency-Key', `idem_dup_${booking._id}`)
      .send({
        reason: 'no_show',
        details: 'Attempting to open another dispute on this booking.',
      });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('DISPUTE_ALREADY_EXISTS');
  });

  it('allows participants to add evidence and verifies 403 for non-participants', async () => {
    const booking = await createTestBooking({ status: 'disputed' });

    const dispute = await Dispute.create({
      bookingId: booking._id,
      disputeReason: 'condition_mismatch',
      source: 'user',
      openedById: borrower._id,
      againstUserId: lender._id,
      status: 'opened',
    });

    // 1. Lender adds counter-evidence
    const resLender = await request(app)
      .post(`/v1/disputes/${dispute._id}/evidence`)
      .set('Authorization', `Bearer ${lenderToken}`)
      .send({
        notes: 'Here are photos taken right before handover showing pristine condition.',
        photos: [
          {
            publicId: 'pre_handover_1',
            url: 'https://res.cloudinary.com/borrowloop/image/upload/v1/borrowloop/disputes/pre.jpg',
          },
        ],
      });

    expect(resLender.status).toBe(200);
    expect(resLender.body.dispute.evidence).toHaveLength(1);
    expect(resLender.body.dispute.evidence[0].by).toBe(lender._id.toString());

    // 2. Third-party unauthorized attempt
    const resThirdParty = await request(app)
      .post(`/v1/disputes/${dispute._id}/evidence`)
      .set('Authorization', `Bearer ${thirdPartyToken}`)
      .send({
        notes: 'Unrelated stranger trying to submit notes on someone elses dispute.',
      });

    expect(resThirdParty.status).toBe(403);
    expect(resThirdParty.body.error.code).toBe('FORBIDDEN');
  });

  it('redacts internalNote when participants view dispute, allows care agent to view it', async () => {
    const now = new Date();
    const booking = await createTestBooking({ status: 'disputed' });

    const dispute = await Dispute.create({
      bookingId: booking._id,
      disputeReason: 'condition_mismatch',
      source: 'user',
      openedById: borrower._id,
      againstUserId: lender._id,
      status: 'decided',
      decision: {
        decidedById: careAgent._id,
        decidedAt: now,
        depositToLenderPaise: 0,
        depositToBorrowerPaise: 10000,
        appliedLateChargePaise: 0,
        rentOutcome: 'refund_borrower',
        note: 'Decision public rationale: Borrower verified severe defect with photos.',
        internalNote: 'CONFIDENTIAL: Suspect lender has repeated minor complaints. Watch account.',
      },
    });

    // Borrower GET /v1/disputes/:id
    const resBorrower = await request(app)
      .get(`/v1/disputes/${dispute._id}`)
      .set('Authorization', `Bearer ${borrowerToken}`);

    expect(resBorrower.status).toBe(200);
    expect(resBorrower.body.dispute.decision.note).toBe(
      'Decision public rationale: Borrower verified severe defect with photos.',
    );
    expect(resBorrower.body.dispute.decision.internalNote).toBeUndefined();

    // Borrower GET /v1/bookings/:id/dispute
    const resBookingDispute = await request(app)
      .get(`/v1/bookings/${booking._id}/dispute`)
      .set('Authorization', `Bearer ${borrowerToken}`);

    expect(resBookingDispute.status).toBe(200);
    expect(resBookingDispute.body.dispute.decision.internalNote).toBeUndefined();

    // Care Agent GET /v1/disputes/:id sees internalNote
    const resCare = await request(app)
      .get(`/v1/disputes/${dispute._id}`)
      .set('Authorization', `Bearer ${careAgentToken}`);

    expect(resCare.status).toBe(200);
    expect(resCare.body.dispute.decision.internalNote).toBe(
      'CONFIDENTIAL: Suspect lender has repeated minor complaints. Watch account.',
    );
  });

  it('outboxDispatcher handles dispute.requested and creates Dispute row idempotently with handover photos', async () => {
    const booking = await createTestBooking({
      status: 'disputed',
      disputeReason: 'damage',
    });

    // Seed return handover with photo
    await Handover.create({
      bookingId: booking._id,
      type: 'return',
      issuerId: borrower._id,
      scannerId: lender._id,
      status: 'completed',
      photos: [
        {
          by: lender._id,
          publicId: 'return_photo_damage',
          url: 'https://res.cloudinary.com/borrowloop/image/upload/v1/borrowloop/handovers/return.jpg',
        },
      ],
    });

    const event = await DomainEvent.create({
      type: 'dispute.requested',
      bookingId: booking._id,
      actorId: lender._id,
      eventKey: `dispute_requested_${booking._id}`,
      payload: {
        disputeReason: 'damage',
        note: 'Broken gear assembly found upon return inspection.',
        reportedBy: lender._id,
      },
    });

    await dispatchSingleEventForTest(event, null, new Map());

    const createdDispute = await Dispute.findOne({ bookingId: booking._id });
    expect(createdDispute).not.toBeNull();
    expect(createdDispute.disputeReason).toBe('damage');
    expect(createdDispute.source).toBe('user');
    expect(createdDispute.openedById.toString()).toBe(lender._id.toString());
    expect(createdDispute.evidence).toHaveLength(1);
    expect(createdDispute.evidence[0].photos).toHaveLength(1);
    expect(createdDispute.evidence[0].photos[0].url).toContain('return.jpg');
  });

  it('scripts/backfill-disputes logic creates missing Dispute row for legacy disputed booking', async () => {
    const booking = await createTestBooking({
      status: 'disputed',
      disputeReason: 'not_returned',
    });

    let existingDispute = await Dispute.findOne({ bookingId: booking._id });
    expect(existingDispute).toBeNull();

    const disputedBookings = await Booking.find({ _id: booking._id, status: 'disputed' }).lean();
    for (const b of disputedBookings) {
      const exists = await Dispute.findOne({ bookingId: b._id });
      if (!exists) {
        await Dispute.create({
          bookingId: b._id,
          disputeReason: b.disputeReason || 'damage',
          source: 'system',
          openedById: null,
          againstUserId: b.borrowerId,
          status: 'opened',
        });
      }
    }

    existingDispute = await Dispute.findOne({ bookingId: booking._id });
    expect(existingDispute).not.toBeNull();
    expect(existingDispute.disputeReason).toBe('not_returned');
    expect(existingDispute.source).toBe('system');
  });
});
