import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestDB, teardownTestDB } from '../../../apps/api/tests/setup/dbTestHelper.js';
import {
  User,
  Booking,
  Item,
  ItemDayLock,
  Wallet,
  LedgerEntry,
  Dispute,
  AuditLog,
  TrustEvent,
  settleDisputeDecision,
  freezeBookingFunds,
  addDemoFunds,
} from '../src/index.js';

describe('Dispute Settlement Ledger Operations (Sub-step 8c)', () => {
  let borrower;
  let lender;
  let careAgent;
  let item;

  beforeAll(async () => {
    await setupTestDB();

    borrower = await User.create({
      name: 'Dispute Borrower',
      email: `borrower_${Date.now()}@borrowloop.test`,
      emailVerified: true,
      status: 'active',
      passwordHash: 'hash123',
    });

    lender = await User.create({
      name: 'Dispute Lender',
      email: `lender_${Date.now()}@borrowloop.test`,
      emailVerified: true,
      status: 'active',
      passwordHash: 'hash123',
    });

    careAgent = await User.create({
      name: 'Agent Smith',
      email: `care_${Date.now()}@borrowloop.test`,
      emailVerified: true,
      role: 'care_agent',
      status: 'active',
      passwordHash: 'hash123',
    });

    item = await Item.create({
      ownerId: lender._id,
      title: 'Rotary Hammer Drill',
      description: 'Heavy duty concrete drilling',
      category: 'tools_and_diy',
      condition: 'good',
      photos: [
        `https://res.cloudinary.com/demo_cloud/image/upload/borrowloop/items/${lender._id}/drill.jpg`,
      ],
      rentPerDayPaise: 2500,
      depositPaise: 10000,
      location: {
        type: 'Point',
        coordinates: [77.5946, 12.9716],
        approximateAddress: 'Koramangala, Bangalore',
      },
      status: 'active',
    });
  });

  afterAll(async () => {
    await teardownTestDB();
  });

  let fixtureCounter = 1;

  async function createDisputedBookingFixture(overrides = {}) {
    const rentPaise = overrides.rentPaise ?? 5000;
    const depositPaise = overrides.depositPaise ?? 10000;
    const totalHeld = rentPaise + depositPaise;
    const day = `2026-11-${String((fixtureCounter++ % 28) + 1).padStart(2, '0')}`;

    // Add demo funds to borrower and freeze booking funds to establish legitimate frozen balance
    await addDemoFunds({ userId: borrower._id, amountPaise: totalHeld });
    const booking = await Booking.create({
      itemId: item._id,
      borrowerId: borrower._id,
      lenderId: lender._id,
      startDate: day,
      endDate: day,
      days: 1,
      dueAt: new Date(Date.now() + 86400000),
      expiresAt: new Date(Date.now() + 86400000),
      rentPaise,
      depositPaise,
      totalAmountPaise: totalHeld,
      status: 'disputed',
      disputeReason: overrides.disputeReason || 'damage',
      lateChargePaise: overrides.lateChargePaise ?? 0,
      ...overrides,
    });

    await freezeBookingFunds({
      bookingId: booking._id,
      borrowerId: borrower._id,
      rentPaise,
      depositPaise,
      throwOnAlreadyApplied: false,
    });

    // Create active day lock to verify deletion
    await ItemDayLock.create({
      itemId: item._id,
      bookingId: booking._id,
      day,
      status: 'locked',
    });

    const dispute = await Dispute.create({
      bookingId: booking._id,
      disputeReason: booking.disputeReason,
      source: 'user',
      openedById: lender._id,
      againstUserId: borrower._id,
      status: 'opened',
    });

    return { booking, dispute };
  }

  it('settles damage dispute with rent to lender and partial deposit split, maintaining exact zero sum', async () => {
    // rent = 5000 (₹50), deposit = 10000 (₹100) -> total held = 15000
    const { booking, dispute } = await createDisputedBookingFixture({
      rentPaise: 5000,
      depositPaise: 10000,
    });

    const initialLenderWallet = await Wallet.findOne({ userId: lender._id });
    const initialLenderAvailable = initialLenderWallet?.availablePaise || 0;

    // Decision: damage verified. 6000 deposit to lender (compensation), 4000 deposit returned to borrower.
    // Rent goes to lender.
    const res = await settleDisputeDecision({
      disputeId: dispute._id,
      decidedById: careAgent._id,
      depositToLenderPaise: 6000,
      depositToBorrowerPaise: 4000,
      applyLateCharge: true,
      rentOutcome: 'lender',
      faultUserId: borrower._id,
      penaltyKind: 'lost_dispute',
      borrowerAccountAction: 'strike',
      note: 'Decision rationale: Damage to drill chuck confirmed from handover photos.',
      internalNote: 'CONFIDENTIAL: Chuck was burned from misuse. Lender entitled to compensation.',
    });

    expect(res.settlement).toBeDefined();

    // Check calculations:
    // Lender earnings subject to 15% commission = rent (5000) = 5000
    // Commission = 15% of 5000 = 750 paise
    // Net rent = 4250 paise
    // Deposit compensation = 6000 paise (0% commission)
    // Total lender payout = 4250 + 6000 = 10250 paise
    expect(res.settlement.commissionPaise).toBe(750);
    expect(res.settlement.lenderPayoutPaise).toBe(10250);
    // Borrower refund = 4000 deposit refund
    expect(res.settlement.borrowerRefundPaise).toBe(4000);

    // Verify wallets
    const borrowerWallet = await Wallet.findOne({ userId: borrower._id });
    // Frozen should be decremented by 15000 (to 0 for this booking)
    expect(borrowerWallet.frozenPaise).toBe(0);

    const lenderWallet = await Wallet.findOne({ userId: lender._id });
    expect(lenderWallet.availablePaise).toBe(initialLenderAvailable + 10250);

    // Verify balanced ledger entries in DB
    const entries = await LedgerEntry.find({
      bookingId: booking._id,
      type: {
        $in: ['dispute_settlement', 'deposit_release', 'deposit_compensation', 'commission'],
      },
    });
    const sum = entries.reduce((acc, e) => acc + e.amountPaise, 0);
    expect(sum).toBe(0);

    // Verify booking status transitioned to 'completed' with completedBy: 'care'
    const updatedBooking = await Booking.findById(booking._id);
    expect(updatedBooking.status).toBe('completed');
    expect(updatedBooking.completedBy).toBe('care');

    // Verify day locks deleted
    const remainingLocks = await ItemDayLock.countDocuments({ bookingId: booking._id });
    expect(remainingLocks).toBe(0);

    // Verify dispute updated to 'decided'
    const updatedDispute = await Dispute.findById(dispute._id);
    expect(updatedDispute.status).toBe('decided');
    expect(updatedDispute.decision.settlement.lenderPayoutPaise).toBe(10250);
    expect(updatedDispute.decision.internalNote).toContain('CONFIDENTIAL');

    // Verify strike applied to borrower
    const borrowerUser = await User.findById(borrower._id);
    expect(borrowerUser.strikes).toBeGreaterThanOrEqual(1);

    // Verify audit log entry
    const audit = await AuditLog.findOne({
      targetType: 'dispute',
      targetId: dispute._id,
      action: 'dispute.decided',
    });
    expect(audit).not.toBeNull();
    expect(audit.actorId.toString()).toBe(careAgent._id.toString());
  });

  it('settles dispute with applied late charge and split deposit accurately', async () => {
    // rent = 4000, deposit = 10000, lateCharge = 3000
    // Remaining deposit = 10000 - 3000 = 7000
    const { booking, dispute } = await createDisputedBookingFixture({
      rentPaise: 4000,
      depositPaise: 10000,
      lateChargePaise: 3000,
    });

    // Decision: split remaining 7000 into 5000 to lender and 2000 to borrower
    const res = await settleDisputeDecision({
      disputeId: dispute._id,
      decidedById: careAgent._id,
      depositToLenderPaise: 5000,
      depositToBorrowerPaise: 2000,
      applyLateCharge: true,
      rentOutcome: 'lender',
      note: 'Decision rationale: Late return charge applied and partial damage compensation.',
    });

    // Lender earnings subject to 15% commission = rent (4000) + late (3000) = 7000
    // Commission = 15% of 7000 = 1050 paise
    // Net earnings = 7000 - 1050 = 5950 paise
    // Deposit compensation = 5000 paise (0% commission)
    // Total lender payout = 5950 + 5000 = 10950 paise
    expect(res.settlement.commissionPaise).toBe(1050);
    expect(res.settlement.lenderPayoutPaise).toBe(10950);
    expect(res.settlement.borrowerRefundPaise).toBe(2000);

    const entries = await LedgerEntry.find({ bookingId: booking._id });
    const sum = entries.reduce((acc, e) => acc + e.amountPaise, 0);
    expect(sum).toBe(0);
  });

  it('settles dispute with rentOutcome refund_borrower, refunding rent and full deposit to borrower', async () => {
    // rent = 4000, deposit = 10000
    const { booking, dispute } = await createDisputedBookingFixture({
      rentPaise: 4000,
      depositPaise: 10000,
    });

    const res = await settleDisputeDecision({
      disputeId: dispute._id,
      decidedById: careAgent._id,
      depositToLenderPaise: 0,
      depositToBorrowerPaise: 10000,
      applyLateCharge: false,
      rentOutcome: 'refund_borrower',
      faultUserId: lender._id,
      penaltyKind: 'rejected_damage_claim',
      note: 'Decision rationale: Lender damage claim rejected. Item had pre-existing wear.',
    });

    // Borrower gets full rent (4000) + full deposit (10000) = 14000
    expect(res.settlement.borrowerRefundPaise).toBe(14000);
    expect(res.settlement.lenderPayoutPaise).toBe(0);
    expect(res.settlement.commissionPaise).toBe(0);

    // Verify trust penalty recorded on lender
    const trustEvent = await TrustEvent.findOne({
      userId: lender._id,
      type: 'rejected_damage_claim',
    });
    expect(trustEvent).not.toBeNull();

    const entries = await LedgerEntry.find({ bookingId: booking._id });
    const sum = entries.reduce((acc, e) => acc + e.amountPaise, 0);
    expect(sum).toBe(0);
  });

  it('settles no_show dispute by transitioning booking to cancelled when full refund is granted', async () => {
    const { booking, dispute } = await createDisputedBookingFixture({
      disputeReason: 'no_show',
      rentPaise: 3000,
      depositPaise: 8000,
    });

    const res = await settleDisputeDecision({
      disputeId: dispute._id,
      decidedById: careAgent._id,
      depositToLenderPaise: 0,
      depositToBorrowerPaise: 8000,
      applyLateCharge: false,
      rentOutcome: 'refund_borrower',
      faultUserId: lender._id,
      penaltyKind: 'no_show',
      note: 'Decision rationale: Lender confirmed absent at scheduled pickup.',
    });

    expect(res.booking.status).toBe('cancelled');
    expect(res.booking.completedBy).toBe('care');

    const updatedBooking = await Booking.findById(booking._id);
    expect(updatedBooking.status).toBe('cancelled');
    expect(updatedBooking.completedBy).toBe('care');
  });

  it('proves settle-once guard prevents duplicate dispute settlement (409 OPERATION_ALREADY_APPLIED)', async () => {
    const { dispute } = await createDisputedBookingFixture({
      rentPaise: 2000,
      depositPaise: 5000,
    });

    // First settlement
    await settleDisputeDecision({
      disputeId: dispute._id,
      decidedById: careAgent._id,
      depositToLenderPaise: 2000,
      depositToBorrowerPaise: 3000,
      applyLateCharge: false,
      rentOutcome: 'lender',
      note: 'Decision rationale: First settlement execution.',
    });

    // Second settlement must reject
    await expect(
      settleDisputeDecision({
        disputeId: dispute._id,
        decidedById: careAgent._id,
        depositToLenderPaise: 2000,
        depositToBorrowerPaise: 3000,
        applyLateCharge: false,
        rentOutcome: 'lender',
        note: 'Decision rationale: Duplicate settlement execution attempt.',
      }),
    ).rejects.toThrow();
  });

  it('rejects decision if deposit split does not equal remaining deposit (400 DISPUTE_DECISION_INVALID)', async () => {
    const { dispute } = await createDisputedBookingFixture({
      rentPaise: 2000,
      depositPaise: 5000,
    });

    // Remaining deposit is 5000, but split sums to 4000
    await expect(
      settleDisputeDecision({
        disputeId: dispute._id,
        decidedById: careAgent._id,
        depositToLenderPaise: 2000,
        depositToBorrowerPaise: 2000,
        applyLateCharge: false,
        rentOutcome: 'lender',
        note: 'Decision rationale: Invalid deposit math.',
      }),
    ).rejects.toThrow(/Deposit split .* must equal remaining deposit/);
  });

  it('rejects decision if note is shorter than 20 characters', async () => {
    const { dispute } = await createDisputedBookingFixture();

    await expect(
      settleDisputeDecision({
        disputeId: dispute._id,
        decidedById: careAgent._id,
        depositToLenderPaise: 5000,
        depositToBorrowerPaise: 5000,
        applyLateCharge: false,
        rentOutcome: 'lender',
        note: 'Too short',
      }),
    ).rejects.toThrow(/Decision note must be at least 20 characters/);
  });
});
