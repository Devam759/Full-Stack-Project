import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { setupTestDB, teardownTestDB, clearTestDB } from './setup/dbTestHelper.js';
import User from '../src/models/User.js';
import Wallet from '../src/models/Wallet.js';
import LedgerEntry from '../src/models/LedgerEntry.js';
import ledgerService from '../src/modules/wallet/ledgerService.js';

describe('Suite 5: Financial Operations (Hold, Extension, Release, Refund, Settlement)', () => {
  let borrower;
  let lender;
  const bookingId = new mongoose.Types.ObjectId();

  beforeAll(async () => {
    await setupTestDB();
  });

  afterAll(async () => {
    await teardownTestDB();
  });

  beforeEach(async () => {
    await clearTestDB();

    borrower = await User.create({
      name: 'Borrower Ben',
      email: 'ben@example.com',
      emailVerified: true,
      status: 'active',
      passwordHash: 'dummyhash',
    });

    lender = await User.create({
      name: 'Lender Lisa',
      email: 'lisa@example.com',
      emailVerified: true,
      status: 'active',
      passwordHash: 'dummyhash',
    });

    // Initial borrower wallet funding
    await ledgerService.addDemoFunds({
      userId: borrower._id,
      amountPaise: 100000, // ₹1,000
    });
  });

  it('freezes booking hold funds atomically and tracks balanceAfterPaise', async () => {
    const rentPaise = 20000; // ₹200
    const depositPaise = 50000; // ₹500

    const result = await ledgerService.freezeBookingFunds({
      borrowerId: borrower._id,
      bookingId,
      rentPaise,
      depositPaise,
    });

    expect(result.availablePaise).toBe(30000); // 100000 - 70000
    expect(result.frozenPaise).toBe(70000);

    const entries = await LedgerEntry.find({ bookingId, type: 'booking_hold' });
    expect(entries.length).toBe(2);

    const availableEntry = entries.find((e) => e.account === 'available');
    const frozenEntry = entries.find((e) => e.account === 'frozen');

    expect(availableEntry.amountPaise).toBe(-70000);
    expect(availableEntry.balanceAfterPaise).toBe(30000);
    expect(frozenEntry.amountPaise).toBe(70000);
    expect(frozenEntry.balanceAfterPaise).toBe(70000);
  });

  it('holds extension funds when approved', async () => {
    await ledgerService.freezeBookingFunds({
      borrowerId: borrower._id,
      bookingId,
      rentPaise: 20000,
      depositPaise: 50000,
    });

    const extensionRes = await ledgerService.holdExtensionFunds({
      borrowerId: borrower._id,
      bookingId,
      extraRentPaise: 10000, // ₹100 extra
    });

    expect(extensionRes.availablePaise).toBe(20000); // 30000 - 10000
    expect(extensionRes.frozenPaise).toBe(80000); // 70000 + 10000
  });

  it('refunds all frozen funds when booking is cancelled before pickup', async () => {
    await ledgerService.freezeBookingFunds({
      borrowerId: borrower._id,
      bookingId,
      rentPaise: 20000,
      depositPaise: 50000,
    });

    const refundRes = await ledgerService.refundCancelledBooking({
      borrowerId: borrower._id,
      bookingId,
      totalFrozenPaise: 70000,
    });

    expect(refundRes.availablePaise).toBe(100000);
    expect(refundRes.frozenPaise).toBe(0);

    const entries = await LedgerEntry.find({ type: 'booking_cancel_refund' });
    expect(entries.length).toBe(2);
    expect(entries.reduce((acc, curr) => acc + curr.amountPaise, 0)).toBe(0);
  });

  it('settles booking completion with 15% platform commission and deposit release', async () => {
    const rentPaise = 20000; // ₹200
    const depositPaise = 50000; // ₹500

    await ledgerService.freezeBookingFunds({
      borrowerId: borrower._id,
      bookingId,
      rentPaise,
      depositPaise,
    });

    // Settle with zero late charge
    const settlement = await ledgerService.settleBookingCompletion({
      bookingId,
      lenderId: lender._id,
      borrowerId: borrower._id,
      rentPaise,
      depositPaise,
      lateChargePaise: 0,
    });

    // 15% of 20000 = 3000 paise commission
    // Lender payout = 17000 paise
    // Borrower refund = 50000 paise deposit
    expect(settlement.commissionPaise).toBe(3000);
    expect(settlement.lenderPayoutPaise).toBe(17000);
    expect(settlement.borrowerRefundPaise).toBe(50000);

    // Verify wallets
    const borrowerWallet = await Wallet.findOne({ userId: borrower._id });
    expect(borrowerWallet.frozenPaise).toBe(0);
    expect(borrowerWallet.availablePaise).toBe(80000); // 30000 + 50000

    const lenderWallet = await Wallet.findOne({ userId: lender._id });
    expect(lenderWallet.availablePaise).toBe(17000);

    // Verify all settlement entries sum to zero
    const settlementEntries = await LedgerEntry.find({
      bookingId,
      type: { $in: ['settlement', 'deposit_release', 'commission'] },
    });
    const sum = settlementEntries.reduce((acc, curr) => acc + curr.amountPaise, 0);
    expect(sum).toBe(0);
  });

  it('prevents double settlement and leaves balances unchanged', async () => {
    const rentPaise = 20000;
    const depositPaise = 50000;

    await ledgerService.freezeBookingFunds({
      borrowerId: borrower._id,
      bookingId,
      rentPaise,
      depositPaise,
    });

    // Also add extra frozen funds to borrower from another imaginary hold
    await Wallet.updateOne({ userId: borrower._id }, { $inc: { frozenPaise: 100000 } });

    // First settlement
    const first = await ledgerService.settleBookingCompletion({
      bookingId,
      lenderId: lender._id,
      borrowerId: borrower._id,
      rentPaise,
      depositPaise,
    });
    expect(first.lenderPayoutPaise).toBe(17000);

    const lenderBalAfterFirst = (await Wallet.findOne({ userId: lender._id })).availablePaise;
    const borrowerBalAfterFirst = (await Wallet.findOne({ userId: borrower._id })).availablePaise;

    // Second settlement attempt for the same booking
    const second = await ledgerService.settleBookingCompletion({
      bookingId,
      lenderId: lender._id,
      borrowerId: borrower._id,
      rentPaise,
      depositPaise,
    });
    expect(second.alreadyApplied).toBe(true);

    // Balances MUST be unchanged
    const lenderBalAfterSecond = (await Wallet.findOne({ userId: lender._id })).availablePaise;
    const borrowerBalAfterSecond = (await Wallet.findOne({ userId: borrower._id })).availablePaise;
    expect(lenderBalAfterSecond).toBe(lenderBalAfterFirst);
    expect(borrowerBalAfterSecond).toBe(borrowerBalAfterFirst);

    // If throwOnAlreadyApplied is true, it throws 409 OPERATION_ALREADY_APPLIED
    await expect(
      ledgerService.settleBookingCompletion({
        bookingId,
        lenderId: lender._id,
        borrowerId: borrower._id,
        rentPaise,
        depositPaise,
        throwOnAlreadyApplied: true,
      }),
    ).rejects.toMatchObject({
      code: 'OPERATION_ALREADY_APPLIED',
      statusCode: 409,
    });
  });

  it('prevents double deposit release and double refund', async () => {
    const singleBookingId = new mongoose.Types.ObjectId();
    await ledgerService.freezeBookingFunds({
      borrowerId: borrower._id,
      bookingId: singleBookingId,
      rentPaise: 10000,
      depositPaise: 20000,
    });

    // 1. Release deposit
    const rel1 = await ledgerService.releaseDeposit({
      borrowerId: borrower._id,
      bookingId: singleBookingId,
      depositPaise: 20000,
    });
    expect(rel1.releasedPaise).toBe(20000);

    // Second release deposit
    const rel2 = await ledgerService.releaseDeposit({
      borrowerId: borrower._id,
      bookingId: singleBookingId,
      depositPaise: 20000,
    });
    expect(rel2.alreadyApplied).toBe(true);

    // 2. Refund cancelled booking on a new booking
    const cancelBookingId = new mongoose.Types.ObjectId();
    await ledgerService.freezeBookingFunds({
      borrowerId: borrower._id,
      bookingId: cancelBookingId,
      rentPaise: 10000,
      depositPaise: 20000,
    });

    const ref1 = await ledgerService.refundCancelledBooking({
      borrowerId: borrower._id,
      bookingId: cancelBookingId,
      totalFrozenPaise: 30000,
    });
    expect(ref1.refundedPaise).toBe(30000);

    const ref2 = await ledgerService.refundCancelledBooking({
      borrowerId: borrower._id,
      bookingId: cancelBookingId,
      totalFrozenPaise: 30000,
    });
    expect(ref2.alreadyApplied).toBe(true);
  });

  it('allows two extension holds with different opRef for the same booking', async () => {
    const extBookingId = new mongoose.Types.ObjectId();
    await ledgerService.freezeBookingFunds({
      borrowerId: borrower._id,
      bookingId: extBookingId,
      rentPaise: 10000,
      depositPaise: 20000,
    });

    const ext1 = await ledgerService.holdExtensionFunds({
      borrowerId: borrower._id,
      bookingId: extBookingId,
      extraRentPaise: 5000,
      opRef: 'ext_1',
    });
    expect(ext1.extraHeldPaise).toBe(5000);

    const ext2 = await ledgerService.holdExtensionFunds({
      borrowerId: borrower._id,
      bookingId: extBookingId,
      extraRentPaise: 5000,
      opRef: 'ext_2',
    });
    expect(ext2.extraHeldPaise).toBe(5000);

    // Duplicate ext1 should be rejected
    const ext1Dup = await ledgerService.holdExtensionFunds({
      borrowerId: borrower._id,
      bookingId: extBookingId,
      extraRentPaise: 5000,
      opRef: 'ext_1',
    });
    expect(ext1Dup.alreadyApplied).toBe(true);
  });

  it('executes exactly one settlement when two concurrent settlements run for the same booking', async () => {
    const concBookingId = new mongoose.Types.ObjectId();
    await ledgerService.freezeBookingFunds({
      borrowerId: borrower._id,
      bookingId: concBookingId,
      rentPaise: 20000,
      depositPaise: 50000,
    });

    const results = await Promise.all([
      ledgerService.settleBookingCompletion({
        bookingId: concBookingId,
        lenderId: lender._id,
        borrowerId: borrower._id,
        rentPaise: 20000,
        depositPaise: 50000,
      }),
      ledgerService.settleBookingCompletion({
        bookingId: concBookingId,
        lenderId: lender._id,
        borrowerId: borrower._id,
        rentPaise: 20000,
        depositPaise: 50000,
      }),
    ]);

    const successes = results.filter((r) => r.lenderPayoutPaise === 17000);
    const duplicates = results.filter((r) => r.alreadyApplied === true);

    expect(successes.length).toBe(1);
    expect(duplicates.length).toBe(1);

    // Global ledger sum must be zero
    const allEntries = await LedgerEntry.find({ bookingId: concBookingId });
    const globalSum = allEntries.reduce((acc, curr) => acc + curr.amountPaise, 0);
    expect(globalSum).toBe(0);
  });
});
