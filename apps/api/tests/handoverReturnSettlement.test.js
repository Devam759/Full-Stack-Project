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
import { clearRecordedEvents, runReconciliation } from '@borrowloop/server-core';
import { autoCompleteReturnsJob } from '../../worker/src/jobs/autoCompleteReturnJob.js';

describe('Phase 7c: Handover Return and Settlement Integration Tests', () => {
  beforeAll(async () => {
    await setupTestDB();
    await Booking.init();
    await Handover.init();
    await Wallet.init();
    await LedgerEntry.init();
    await LedgerOperation.init();
    await IdempotencyKey.init();
    await TrustEvent.init();
  });

  afterAll(async () => {
    await teardownTestDB();
  });

  beforeEach(async () => {
    await clearTestDB();
    clearRecordedEvents();
  });

  // Helper to setup a picked_up booking
  async function setupPickedUpBooking(overrides = {}) {
    const fixtures = await createBookingFixtures({
      borrowerFundsPaise: overrides.borrowerFundsPaise || 500000,
      rentPerDayPaise: overrides.rentPerDayPaise || 50000,
      depositPaise: overrides.depositPaise || 100000,
    });

    const rand1 = Math.random().toString(36).slice(2);
    const rand2 = Math.random().toString(36).slice(2);
    const rand3 = Math.random().toString(36).slice(2);

    const createRes = await request(app)
      .post('/v1/bookings')
      .set('Authorization', `Bearer ${fixtures.borrowerToken}`)
      .set('Idempotency-Key', `ik_create_${Date.now()}_${rand1}`)
      .send({
        itemId: fixtures.item._id.toString(),
        startDate: overrides.startDate || '2026-12-10',
        endDate: overrides.endDate || '2026-12-12',
      });
    expect(createRes.status).toBe(201);
    const bookingId = createRes.body.booking._id;

    const acceptRes = await request(app)
      .post(`/v1/bookings/${bookingId}/accept`)
      .set('Authorization', `Bearer ${fixtures.lenderToken}`)
      .set('Idempotency-Key', `ik_accept_${Date.now()}_${rand2}`);
    expect(acceptRes.status).toBe(200);

    // Pickup via fallback code
    const qrRes = await request(app)
      .post(`/v1/bookings/${bookingId}/handover/qr`)
      .set('Authorization', `Bearer ${fixtures.lenderToken}`)
      .send({});
    expect(qrRes.status).toBe(200);
    const { fallbackCode } = qrRes.body;

    const pickupRes = await request(app)
      .post(`/v1/bookings/${bookingId}/handover/code`)
      .set('Authorization', `Bearer ${fixtures.borrowerToken}`)
      .set('Idempotency-Key', `ik_pickup_${Date.now()}_${rand3}`)
      .send({ code: fallbackCode });
    expect(pickupRes.status).toBe(200);
    expect(pickupRes.body.booking.status).toBe('picked_up');

    return { ...fixtures, bookingId };
  }

  // Helper to transition from picked_up to returned via fallback code
  async function returnItem(bookingId, borrowerToken, lenderToken) {
    const qrRes = await request(app)
      .post(`/v1/bookings/${bookingId}/return/qr`)
      .set('Authorization', `Bearer ${borrowerToken}`)
      .send({});
    expect(qrRes.status).toBe(200);
    const { fallbackCode } = qrRes.body;

    const rand = Math.random().toString(36).slice(2);
    const returnRes = await request(app)
      .post(`/v1/bookings/${bookingId}/return/code`)
      .set('Authorization', `Bearer ${lenderToken}`)
      .set('Idempotency-Key', `ik_return_${Date.now()}_${rand}`)
      .send({ code: fallbackCode });
    expect(returnRes.status).toBe(200);
    expect(returnRes.body.booking.status).toBe('returned');
    expect(returnRes.body.booking.returnConfirmDeadline).toBeTruthy();
    return returnRes.body.booking;
  }

  it('1. Full happy path: return scan -> lender confirms "ok" -> settles with 15% commission and deposit refund', async () => {
    const { bookingId, borrowerToken, lenderToken, borrower, lender } =
      await setupPickedUpBooking();

    // 1. Borrower issues return QR and lender enters return code
    const returnedBooking = await returnItem(bookingId, borrowerToken, lenderToken);
    expect(returnedBooking.status).toBe('returned');

    // 2. Lender confirms return: outcome 'ok'
    const rand = Math.random().toString(36).slice(2);
    const confirmRes = await request(app)
      .post(`/v1/bookings/${bookingId}/return/confirm`)
      .set('Authorization', `Bearer ${lenderToken}`)
      .set('Idempotency-Key', `ik_confirm_${Date.now()}_${rand}`)
      .send({ outcome: 'ok' });

    expect(confirmRes.status).toBe(200);
    expect(confirmRes.body.booking.status).toBe('completed');
    expect(confirmRes.body.booking.completedBy).toBe('lender');
    expect(confirmRes.body.booking.completedAt).toBeTruthy();

    // Check balances
    const borrowerWallet = await Wallet.findOne({ userId: borrower._id });
    const lenderWallet = await Wallet.findOne({ userId: lender._id });

    // Borrower frozen should be 0, deposit refunded back to available
    expect(borrowerWallet.frozenPaise).toBe(0);
    // Rent was 150000 (3 days * 50000), deposit was 100000. Total held 250000.
    // Borrower started with 500000. 250000 held. 100000 deposit refunded. Available = 350000.
    expect(borrowerWallet.availablePaise).toBe(350000);

    // Lender rent was 150000. Commission = round(15% of 150000) = 22500.
    // Lender payout = 150000 - 22500 = 127500.
    expect(lenderWallet.availablePaise).toBe(127500);

    // Check ledger zero-sum
    const ledgerEntries = await LedgerEntry.find({ bookingId });
    const sum = ledgerEntries.reduce((acc, e) => acc + e.amountPaise, 0);
    expect(sum).toBe(0);

    // Check on-time trust events written
    const borrowerTrustEvents = await TrustEvent.find({ userId: borrower._id });
    expect(borrowerTrustEvents.some((e) => e.type === 'on_time_completed')).toBe(true);
  });

  it('2. Problem path: lender reports problem with required note -> transitions to disputed, funds stay frozen', async () => {
    const { bookingId, borrowerToken, lenderToken, borrower } = await setupPickedUpBooking();

    await returnItem(bookingId, borrowerToken, lenderToken);

    // Attempt without note should fail 400
    const failRes = await request(app)
      .post(`/v1/bookings/${bookingId}/return/confirm`)
      .set('Authorization', `Bearer ${lenderToken}`)
      .set('Idempotency-Key', `ik_fail_${Date.now()}`)
      .send({ outcome: 'problem' });
    expect(failRes.status).toBe(400);

    // Report problem with note
    const rand = Math.random().toString(36).slice(2);
    const problemRes = await request(app)
      .post(`/v1/bookings/${bookingId}/return/confirm`)
      .set('Authorization', `Bearer ${lenderToken}`)
      .set('Idempotency-Key', `ik_problem_${Date.now()}_${rand}`)
      .send({ outcome: 'problem', note: 'Item arrived damaged with cracked lens' });

    expect(problemRes.status).toBe(200);
    expect(problemRes.body.disputed).toBe(true);
    expect(problemRes.body.booking.status).toBe('disputed');
    expect(problemRes.body.booking.disputeReason).toBe('damage');

    // Funds stay frozen: zero settlement ledger entries
    const settlements = await LedgerEntry.find({ bookingId, type: 'settlement' });
    expect(settlements.length).toBe(0);

    const borrowerWallet = await Wallet.findOne({ userId: borrower._id });
    expect(borrowerWallet.frozenPaise).toBe(250000); // Funds remain frozen
  });

  it('3. Settle twice: second settlement call from API or worker is idempotent (alreadyApplied, balances unchanged)', async () => {
    const { bookingId, borrowerToken, lenderToken, lender } = await setupPickedUpBooking();

    await returnItem(bookingId, borrowerToken, lenderToken);

    const rand1 = Math.random().toString(36).slice(2);
    const firstRes = await request(app)
      .post(`/v1/bookings/${bookingId}/return/confirm`)
      .set('Authorization', `Bearer ${lenderToken}`)
      .set('Idempotency-Key', `ik_first_${Date.now()}_${rand1}`)
      .send({ outcome: 'ok' });
    expect(firstRes.status).toBe(200);

    const lenderWallet1 = await Wallet.findOne({ userId: lender._id });

    // Run auto-complete background worker job on the completed booking
    const jobResult = await autoCompleteReturnsJob();
    expect(jobResult.success).toBe(true);

    const lenderWallet2 = await Wallet.findOne({ userId: lender._id });
    // Balance must be identical: no double credit
    expect(lenderWallet2.availablePaise).toBe(lenderWallet1.availablePaise);
  });

  it('4. Commission math: verifies half-up rounding on odd rent amounts (e.g., 9999 paise)', async () => {
    const { bookingId, borrowerToken, lenderToken } = await setupPickedUpBooking({
      rentPerDayPaise: 3333, // 3 days = 9999 paise rent
    });

    await returnItem(bookingId, borrowerToken, lenderToken);

    const rand = Math.random().toString(36).slice(2);
    const confirmRes = await request(app)
      .post(`/v1/bookings/${bookingId}/return/confirm`)
      .set('Authorization', `Bearer ${lenderToken}`)
      .set('Idempotency-Key', `ik_odd_${Date.now()}_${rand}`)
      .send({ outcome: 'ok' });
    expect(confirmRes.status).toBe(200);

    // 15% of 9999 = 1499.85 -> 1500 paise commission
    const commissionEntry = await LedgerEntry.findOne({
      bookingId,
      account: 'platform_revenue',
      type: 'commission',
    });
    expect(commissionEntry.amountPaise).toBe(1500);

    const lenderPayoutEntry = await LedgerEntry.findOne({
      bookingId,
      account: 'available',
      type: 'settlement',
    });
    // 9999 - 1500 = 8499 paise
    expect(lenderPayoutEntry.amountPaise).toBe(8499);
  });

  it('5. Payout above the Rs 50,000 cap is accepted without cap restriction', async () => {
    const { bookingId, borrowerToken, lenderToken, lender } = await setupPickedUpBooking({
      borrowerFundsPaise: 1000000,
      rentPerDayPaise: 200000, // 3 days = 600,000 paise (Rs 6,000)
    });

    // Seed lender wallet with 49,000,000 paise (Rs 49,000 - close to 50,000 cap)
    await Wallet.findOneAndUpdate(
      { userId: lender._id },
      { $set: { availablePaise: 4900000 } },
      { new: true },
    );

    await returnItem(bookingId, borrowerToken, lenderToken);

    const rand = Math.random().toString(36).slice(2);
    const confirmRes = await request(app)
      .post(`/v1/bookings/${bookingId}/return/confirm`)
      .set('Authorization', `Bearer ${lenderToken}`)
      .set('Idempotency-Key', `ik_high_${Date.now()}_${rand}`)
      .send({ outcome: 'ok' });
    expect(confirmRes.status).toBe(200);

    // Payout should succeed despite exceeding cap
    const updatedLenderWallet = await Wallet.findOne({ userId: lender._id });
    expect(updatedLenderWallet.availablePaise).toBeGreaterThan(5000000);
  });

  it('6. Ledger reconciliation reports zero mismatches after return settlement', async () => {
    const { bookingId, borrowerToken, lenderToken } = await setupPickedUpBooking();

    await returnItem(bookingId, borrowerToken, lenderToken);

    const rand = Math.random().toString(36).slice(2);
    await request(app)
      .post(`/v1/bookings/${bookingId}/return/confirm`)
      .set('Authorization', `Bearer ${lenderToken}`)
      .set('Idempotency-Key', `ik_recon_${Date.now()}_${rand}`)
      .send({ outcome: 'ok' });

    // Run reconciliation check
    const report = await runReconciliation();
    expect(report.mismatchesCount).toBe(0);
    expect(report.status).toBe('completed');
  });

  it('7. Accepted extension settles on the new rentPaise', async () => {
    const { bookingId, borrowerToken, lenderToken } = await setupPickedUpBooking({
      rentPerDayPaise: 50000,
      startDate: '2026-12-10',
      endDate: '2026-12-12', // 3 days = 150000 rent
    });

    const rand1 = Math.random().toString(36).slice(2);
    const rand2 = Math.random().toString(36).slice(2);
    const rand3 = Math.random().toString(36).slice(2);

    // Request extension for 1 additional day
    const extRes = await request(app)
      .post(`/v1/bookings/${bookingId}/extensions`)
      .set('Authorization', `Bearer ${borrowerToken}`)
      .set('Idempotency-Key', `ik_ext_${Date.now()}_${rand1}`)
      .send({ newEndDate: '2026-12-13' });
    expect(extRes.status).toBe(201);

    // Accept extension
    const acceptExtRes = await request(app)
      .post(`/v1/bookings/${bookingId}/extensions/accept`)
      .set('Authorization', `Bearer ${lenderToken}`)
      .set('Idempotency-Key', `ik_ext_acc_${Date.now()}_${rand2}`);
    expect(acceptExtRes.status).toBe(200);

    // Now total rent is 4 days * 50000 = 200000 paise
    await returnItem(bookingId, borrowerToken, lenderToken);

    const confirmRes = await request(app)
      .post(`/v1/bookings/${bookingId}/return/confirm`)
      .set('Authorization', `Bearer ${lenderToken}`)
      .set('Idempotency-Key', `ik_ext_conf_${Date.now()}_${rand3}`)
      .send({ outcome: 'ok' });
    expect(confirmRes.status).toBe(200);

    // Commission should be 15% of 200000 = 30000 paise
    const commissionEntry = await LedgerEntry.findOne({
      bookingId,
      account: 'platform_revenue',
      type: 'commission',
    });
    expect(commissionEntry.amountPaise).toBe(30000);
  });
});
