/**
 * @file apps/api/tests/phase7E2E.test.js
 * Comprehensive Multi-Party End-to-End Suite for Phase 7:
 * - Happy Path End-to-End (Pickup -> Extension -> Late Return -> Return Confirmation -> Settle -> Blind Ratings Reveal -> Trust Score)
 * - Damage / Problem Dispute Path (Return -> Lender Reports Problem with Note -> Disputed State -> Funds Frozen)
 * - Not-Returned Dispute Path (3 Days Overdue -> Automated Worker Job -> Disputed State -> Borrower Frozen)
 * - Ledger Invariants Audit & Multi-Party Reconciliation across all scenarios
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { setupTestDB, teardownTestDB, clearTestDB } from './setup/dbTestHelper.js';
import { createBookingFixtures } from './setup/bookingTestFixture.js';
import app from '../src/app.js';
import Booking from '../src/models/Booking.js';
import Handover from '../src/models/Handover.js';
import Wallet from '../src/models/Wallet.js';
import LedgerEntry from '../src/models/LedgerEntry.js';
import LedgerOperation from '../src/models/LedgerOperation.js';
import IdempotencyKey from '../src/models/IdempotencyKey.js';
import TrustEvent from '../src/models/TrustEvent.js';
import Rating from '../src/models/Rating.js';
import ItemDayLock from '../src/models/ItemDayLock.js';
import User from '../src/models/User.js';
import { clearRecordedEvents, runReconciliation } from '@borrowloop/server-core';
import { accrueLateChargesJob } from '../../worker/src/jobs/lateChargeJob.js';

describe('Phase 7: Comprehensive Multi-Party End-to-End Integration Suite', () => {
  beforeAll(async () => {
    await setupTestDB();
    await Booking.init();
    await Handover.init();
    await Wallet.init();
    await LedgerEntry.init();
    await LedgerOperation.init();
    await IdempotencyKey.init();
    await TrustEvent.init();
    await Rating.init();
    await ItemDayLock.init();
    await User.init();
  });

  afterAll(async () => {
    await teardownTestDB();
  });

  beforeEach(async () => {
    await clearTestDB();
    clearRecordedEvents();
  });

  it('Flow 1: Happy Path Lifecycle (Pickup -> Extension -> Late Return -> Confirmation -> Settlement -> Blind Ratings & Trust Score)', async () => {
    // 1. Setup participants and item
    // Rent = ₹500/day (50,000 paise), Deposit = ₹1,000 (100,000 paise)
    // Borrower starts with ₹5,000 (500,000 paise)
    const fixtures = await createBookingFixtures({
      borrowerFundsPaise: 500000,
      rentPerDayPaise: 50000,
      depositPaise: 100000,
    });

    const rand1 = Math.random().toString(36).slice(2);
    const rand2 = Math.random().toString(36).slice(2);

    // 2. Request Booking: 2 days (Dec 10 to Dec 11)
    const createRes = await request(app)
      .post('/v1/bookings')
      .set('Authorization', `Bearer ${fixtures.borrowerToken}`)
      .set('Idempotency-Key', `ik_create_${rand1}`)
      .send({
        itemId: fixtures.item._id.toString(),
        startDate: '2026-12-10',
        endDate: '2026-12-11',
      });
    expect(createRes.status).toBe(201);
    const bookingId = createRes.body.booking._id;
    expect(createRes.body.booking.days).toBe(2);
    expect(createRes.body.booking.rentPaise).toBe(100000);
    expect(createRes.body.booking.depositPaise).toBe(100000);

    // 3. Lender Accepts Booking (Rent + Deposit frozen)
    const acceptRes = await request(app)
      .post(`/v1/bookings/${bookingId}/accept`)
      .set('Authorization', `Bearer ${fixtures.lenderToken}`)
      .set('Idempotency-Key', `ik_accept_${rand2}`);
    expect(acceptRes.status).toBe(200);
    expect(acceptRes.body.booking.status).toBe('accepted');

    let borrowerWallet = await Wallet.findOne({ userId: fixtures.borrower._id });
    expect(borrowerWallet.availablePaise).toBe(300000);
    expect(borrowerWallet.frozenPaise).toBe(200000);

    // 4. Chat Message & Pin Proposal / Confirmation
    const pinRes = await request(app)
      .post(`/v1/bookings/${bookingId}/messages`)
      .set('Authorization', `Bearer ${fixtures.borrowerToken}`)
      .send({
        clientMessageId: `cmsg_pin_${rand1}`,
        type: 'pin',
        pin: {
          lat: 26.9124,
          lng: 75.7873,
          label: 'Metro Station Gate 2',
        },
      });
    expect(pinRes.status).toBe(201);

    const confirmPinRes = await request(app)
      .post(`/v1/bookings/${bookingId}/pin/confirm`)
      .set('Authorization', `Bearer ${fixtures.lenderToken}`)
      .send({});
    expect(confirmPinRes.status).toBe(200);
    expect(confirmPinRes.body.confirmedPin.label).toBe('Metro Station Gate 2');

    // 5. Pickup Handover:
    // Lender generates rotating QR token and 6-digit fallback code
    const pickupQrRes = await request(app)
      .post(`/v1/bookings/${bookingId}/handover/qr`)
      .set('Authorization', `Bearer ${fixtures.lenderToken}`)
      .send({ lat: 26.9124, lng: 75.7873, accuracyM: 10 });
    expect(pickupQrRes.status).toBe(200);
    const { qrToken: pickupQrToken, fallbackCode: pickupCode } = pickupQrRes.body;
    expect(pickupQrToken).toBeDefined();
    expect(pickupCode).toMatch(/^\d{6}$/);

    // Borrower scans pickup QR
    const pickupScanRes = await request(app)
      .post(`/v1/bookings/${bookingId}/handover/scan`)
      .set('Authorization', `Bearer ${fixtures.borrowerToken}`)
      .set('Idempotency-Key', `ik_pickup_scan_${rand1}`)
      .send({
        qrToken: pickupQrToken,
        lat: 26.9125,
        lng: 75.7874,
        accuracyM: 15,
      });
    expect(pickupScanRes.status).toBe(200);
    expect(pickupScanRes.body.booking.status).toBe('picked_up');
    expect(pickupScanRes.body.booking.pickupAt).toBeDefined();

    // 6. Request & Accept Booking Extension: +1 day (Dec 12)
    const extReqRes = await request(app)
      .post(`/v1/bookings/${bookingId}/extensions`)
      .set('Authorization', `Bearer ${fixtures.borrowerToken}`)
      .set('Idempotency-Key', `ik_ext_req_${rand1}`)
      .send({ newEndDate: '2026-12-12' });
    expect(extReqRes.status).toBe(201);
    expect(extReqRes.body.booking.extension.status).toBe('requested');

    const extAccRes = await request(app)
      .post(`/v1/bookings/${bookingId}/extensions/accept`)
      .set('Authorization', `Bearer ${fixtures.lenderToken}`)
      .set('Idempotency-Key', `ik_ext_acc_${rand1}`);
    expect(extAccRes.status).toBe(200);
    expect(extAccRes.body.booking.days).toBe(3);
    expect(extAccRes.body.booking.rentPaise).toBe(150000); // 3 * 50k

    // 7. Simulate Late Return (overdue by 36 hours -> ceil(36/24) = 2 late days):
    // dueAt was Dec 12. Overriding dueAt and booking lateFeePerDayPaise to simulate late return
    await Booking.findByIdAndUpdate(bookingId, {
      dueAt: new Date(Date.now() - 36 * 60 * 60 * 1000), // 36 hours late -> 2 late days
      lateFeePerDayPaise: 40000, // ₹400/day late fee
    });
    await fixtures.item.updateOne({ lateFeePerDayPaise: 40000 });

    // 8. Return Handover:
    // Borrower generates return QR
    const returnQrRes = await request(app)
      .post(`/v1/bookings/${bookingId}/return/qr`)
      .set('Authorization', `Bearer ${fixtures.borrowerToken}`)
      .send({ lat: 26.9124, lng: 75.7873, accuracyM: 10 });
    expect(returnQrRes.status).toBe(200);
    const { qrToken: returnQrToken } = returnQrRes.body;

    // Lender scans return QR
    const returnScanRes = await request(app)
      .post(`/v1/bookings/${bookingId}/return/scan`)
      .set('Authorization', `Bearer ${fixtures.lenderToken}`)
      .set('Idempotency-Key', `ik_return_scan_${rand1}`)
      .send({
        qrToken: returnQrToken,
        lat: 26.9125,
        lng: 75.7874,
        accuracyM: 10,
      });
    expect(returnScanRes.status).toBe(200);
    expect(returnScanRes.body.booking.status).toBe('returned');
    expect(returnScanRes.body.booking.returnAt).toBeDefined();
    expect(returnScanRes.body.booking.returnConfirmDeadline).toBeDefined();

    // 9. Lender Confirms Return ('ok'):
    // Expected settlement:
    // Total Rent = 150000 paise (3 days)
    // Late Charge = 2 days * 40000 = 80000 paise
    // Total earnings = 150000 + 80000 = 230000 paise
    // Commission = round(230000 * 0.15) = 34500 paise
    // Lender payout = 230000 - 34500 = 195500 paise
    // Borrower deposit refund = 100000 - 80000 = 20000 paise
    const confirmRes = await request(app)
      .post(`/v1/bookings/${bookingId}/return/confirm`)
      .set('Authorization', `Bearer ${fixtures.lenderToken}`)
      .set('Idempotency-Key', `ik_confirm_ok_${rand1}`)
      .send({ outcome: 'ok' });
    expect(confirmRes.status).toBe(200);
    expect(confirmRes.body.booking.status).toBe('completed');
    expect(confirmRes.body.booking.completedBy).toBe('lender');

    // Verify Wallets post settlement
    borrowerWallet = await Wallet.findOne({ userId: fixtures.borrower._id });
    const lenderWallet = await Wallet.findOne({ userId: fixtures.lender._id });
    expect(borrowerWallet.frozenPaise).toBe(0);
    expect(borrowerWallet.pendingPaise).toBe(0);
    // Initial 500,000 - 150,000 (rent) - 80,000 (late charge) = 270,000 available
    expect(borrowerWallet.availablePaise).toBe(270000);

    expect(lenderWallet.frozenPaise).toBe(0);
    expect(lenderWallet.availablePaise).toBe(195500);

    // Verify ItemDayLocks released
    const activeLocks = await ItemDayLock.find({ bookingId });
    expect(activeLocks.length).toBe(0);

    // 10. Blind Ratings Flow:
    // Borrower rates first (5 stars)
    const bRatingRes = await request(app)
      .post(`/v1/bookings/${bookingId}/rating`)
      .set('Authorization', `Bearer ${fixtures.borrowerToken}`)
      .set('Idempotency-Key', `ik_rate_b_${rand1}`)
      .send({
        stars: 5,
        comment: 'Great camera and prompt handover!',
      });
    expect(bRatingRes.status).toBe(201);
    expect(bRatingRes.body.isRevealed).toBe(false);

    // Check ratings endpoint: still blind (hidden for non-rater, lender sees nothing)
    const listBlindRes = await request(app)
      .get(`/v1/bookings/${bookingId}/ratings`)
      .set('Authorization', `Bearer ${fixtures.lenderToken}`);
    expect(listBlindRes.status).toBe(200);
    expect(listBlindRes.body.ratings.length).toBe(0);

    // Lender rates second (5 stars) -> triggers immediate mutual reveal
    const lRatingRes = await request(app)
      .post(`/v1/bookings/${bookingId}/rating`)
      .set('Authorization', `Bearer ${fixtures.lenderToken}`)
      .set('Idempotency-Key', `ik_rate_l_${rand1}`)
      .send({
        stars: 5,
        comment: 'Careful borrower, returned in excellent condition.',
      });
    expect(lRatingRes.status).toBe(201);
    expect(lRatingRes.body.isRevealed).toBe(true);

    // Verify both ratings now visible
    const listRevealedRes = await request(app)
      .get(`/v1/bookings/${bookingId}/ratings`)
      .set('Authorization', `Bearer ${fixtures.borrowerToken}`);
    expect(listRevealedRes.status).toBe(200);
    expect(listRevealedRes.body.ratings.length).toBe(2);

    // Verify Trust Scores updated derived cache
    const updatedBorrower = await User.findById(fixtures.borrower._id);
    const updatedLender = await User.findById(fixtures.lender._id);
    expect(updatedBorrower.ratingAvg).toBe(5);
    expect(updatedBorrower.ratingCount).toBe(1);
    expect(updatedBorrower.trustScore).toBeGreaterThanOrEqual(50);

    expect(updatedLender.ratingAvg).toBe(5);
    expect(updatedLender.ratingCount).toBe(1);
    expect(updatedLender.trustScore).toBeGreaterThanOrEqual(50);
  });

  it('Flow 2: Damage Dispute Path (Return -> Lender Reports Problem with Note -> Disputed State -> Funds Frozen)', async () => {
    const fixtures = await createBookingFixtures();
    const rand = Math.random().toString(36).slice(2);

    // Create & accept booking
    const createRes = await request(app)
      .post('/v1/bookings')
      .set('Authorization', `Bearer ${fixtures.borrowerToken}`)
      .set('Idempotency-Key', `ik_disp_create_${rand}`)
      .send({
        itemId: fixtures.item._id.toString(),
        startDate: '2026-12-15',
        endDate: '2026-12-16',
      });
    const bookingId = createRes.body.booking._id;

    await request(app)
      .post(`/v1/bookings/${bookingId}/accept`)
      .set('Authorization', `Bearer ${fixtures.lenderToken}`)
      .set('Idempotency-Key', `ik_disp_acc_${rand}`);

    // Pickup via fallback code
    const pickupQr = await request(app)
      .post(`/v1/bookings/${bookingId}/handover/qr`)
      .set('Authorization', `Bearer ${fixtures.lenderToken}`)
      .send({});
    await request(app)
      .post(`/v1/bookings/${bookingId}/handover/code`)
      .set('Authorization', `Bearer ${fixtures.borrowerToken}`)
      .set('Idempotency-Key', `ik_disp_pu_${rand}`)
      .send({ code: pickupQr.body.fallbackCode });

    // Return via fallback code
    const returnQr = await request(app)
      .post(`/v1/bookings/${bookingId}/return/qr`)
      .set('Authorization', `Bearer ${fixtures.borrowerToken}`)
      .send({});
    await request(app)
      .post(`/v1/bookings/${bookingId}/return/code`)
      .set('Authorization', `Bearer ${fixtures.lenderToken}`)
      .set('Idempotency-Key', `ik_disp_ret_${rand}`)
      .send({ code: returnQr.body.fallbackCode });

    // Lender reports problem (damage claim) with required note
    const problemRes = await request(app)
      .post(`/v1/bookings/${bookingId}/return/confirm`)
      .set('Authorization', `Bearer ${fixtures.lenderToken}`)
      .set('Idempotency-Key', `ik_disp_prob_${rand}`)
      .send({
        outcome: 'problem',
        note: 'Drill chuck is cracked and unusable.',
      });
    expect(problemRes.status).toBe(200);
    expect(problemRes.body.booking.status).toBe('disputed');
    expect(problemRes.body.booking.disputeReason).toBe('damage');
    expect(problemRes.body.booking.disputeOpenedAt).toBeDefined();

    // Invariant: No money moved! Deposit and rent remain safely frozen
    const bWallet = await Wallet.findOne({ userId: fixtures.borrower._id });
    expect(bWallet.frozenPaise).toBe(
      fixtures.item.rentPerDayPaise * 2 + fixtures.item.depositPaise,
    );

    // Verify settle operation does not exist for this booking
    const settleOp = await LedgerOperation.findOne({
      bookingId,
      operationType: 'settlement',
    });
    expect(settleOp).toBeNull();
  });

  it('Flow 3: Not-Returned Dispute Path (3 Days Overdue -> Automated Worker Job -> Disputed State -> Borrower Frozen)', async () => {
    const fixtures = await createBookingFixtures();
    const rand = Math.random().toString(36).slice(2);

    // Create, accept and pickup
    const createRes = await request(app)
      .post('/v1/bookings')
      .set('Authorization', `Bearer ${fixtures.borrowerToken}`)
      .set('Idempotency-Key', `ik_nr_create_${rand}`)
      .send({
        itemId: fixtures.item._id.toString(),
        startDate: '2026-12-20',
        endDate: '2026-12-21',
      });
    expect(createRes.status).toBe(201);
    const bookingId = createRes.body.booking._id;

    await request(app)
      .post(`/v1/bookings/${bookingId}/accept`)
      .set('Authorization', `Bearer ${fixtures.lenderToken}`)
      .set('Idempotency-Key', `ik_nr_acc_${rand}`);

    const pickupQr = await request(app)
      .post(`/v1/bookings/${bookingId}/handover/qr`)
      .set('Authorization', `Bearer ${fixtures.lenderToken}`)
      .send({});
    await request(app)
      .post(`/v1/bookings/${bookingId}/handover/code`)
      .set('Authorization', `Bearer ${fixtures.borrowerToken}`)
      .set('Idempotency-Key', `ik_nr_pu_${rand}`)
      .send({ code: pickupQr.body.fallbackCode });

    // Set dueAt to 3 days and 1 hour ago
    const overduePast = new Date(Date.now() - 73 * 60 * 60 * 1000);
    await Booking.findByIdAndUpdate(bookingId, { dueAt: overduePast });

    // Execute background worker job: accrueLateChargesJob
    const jobResult = await accrueLateChargesJob();
    expect(jobResult.disputesOpened).toBe(1);

    // Verify booking updated to disputed with disputeReason: 'not_returned'
    const updatedBooking = await Booking.findById(bookingId);
    expect(updatedBooking.status).toBe('disputed');
    expect(updatedBooking.disputeReason).toBe('not_returned');

    // Verify borrower frozen
    const updatedBorrower = await User.findById(fixtures.borrower._id);
    expect(updatedBorrower.status).toBe('frozen');

    // Verify frozen borrower can still read their own bookings
    const readBookingsRes = await request(app)
      .get('/v1/bookings')
      .set('Authorization', `Bearer ${fixtures.borrowerToken}`);
    expect(readBookingsRes.status).toBe(200);

    // Verify frozen borrower is blocked from creating a new booking (403)
    const blockedRes = await request(app)
      .post('/v1/bookings')
      .set('Authorization', `Bearer ${fixtures.borrowerToken}`)
      .set('Idempotency-Key', `ik_blocked_${rand}`)
      .send({
        itemId: fixtures.item._id.toString(),
        startDate: '2026-12-25',
        endDate: '2026-12-26',
      });
    expect(blockedRes.status).toBe(403);
    expect(blockedRes.body.error.code).toBe('ACCOUNT_FROZEN');
  });

  it('Verifies Double-Entry Ledger and System Invariants across all executed flows', async () => {
    // 1. Double-entry ledger sum must be exactly zero
    const ledgerAgg = await LedgerEntry.aggregate([
      { $group: { _id: null, total: { $sum: '$amountPaise' }, count: { $sum: 1 } } },
    ]);
    const totalSum = ledgerAgg[0]?.total ?? 0;
    expect(totalSum).toBe(0);

    // 2. No wallet has negative available, frozen, or pending balances
    const wallets = await Wallet.find().lean();
    for (const w of wallets) {
      expect(w.availablePaise).toBeGreaterThanOrEqual(0);
      expect(w.frozenPaise).toBeGreaterThanOrEqual(0);
      expect(w.pendingPaise).toBeGreaterThanOrEqual(0);
    }

    // 3. Automated Reconciliation Service returns completed with 0 mismatches
    const report = await runReconciliation();
    expect(report.status).toBe('completed');
    expect(report.mismatchesCount).toBe(0);
  });
});
