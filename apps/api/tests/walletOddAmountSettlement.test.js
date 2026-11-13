import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { setupTestDB, teardownTestDB, clearTestDB } from './setup/dbTestHelper.js';
import User from '../src/models/User.js';
import LedgerEntry from '../src/models/LedgerEntry.js';
import ledgerService from '../src/modules/wallet/ledgerService.js';

describe('Suite 6: Odd-Amount Settlement Conservation Test', () => {
  let borrower;
  let lender;

  beforeAll(async () => {
    await setupTestDB();
  });

  afterAll(async () => {
    await teardownTestDB();
  });

  beforeEach(async () => {
    await clearTestDB();

    borrower = await User.create({
      name: 'Borrower Odd',
      email: 'odd.borrower@example.com',
      emailVerified: true,
      status: 'active',
      passwordHash: 'dummyhash',
    });

    lender = await User.create({
      name: 'Lender Odd',
      email: 'odd.lender@example.com',
      emailVerified: true,
      status: 'active',
      passwordHash: 'dummyhash',
    });

    await ledgerService.addDemoFunds({
      userId: borrower._id,
      amountPaise: 50000,
    });
  });

  it('settles an odd amount (3,333 paise) with zero money creation or destruction', async () => {
    const bookingId = new mongoose.Types.ObjectId();
    const rentPaise = 3333; // ₹33.33 (odd amount)
    const depositPaise = 10001; // ₹100.01 (odd amount)

    await ledgerService.freezeBookingFunds({
      borrowerId: borrower._id,
      bookingId,
      rentPaise,
      depositPaise,
    });

    const result = await ledgerService.settleBookingCompletion({
      bookingId,
      lenderId: lender._id,
      borrowerId: borrower._id,
      rentPaise,
      depositPaise,
      lateChargePaise: 0,
    });

    // Commission: Math.round(3333 * 0.15) = Math.round(499.95) = 500 paise
    // Lender payout: 3333 - 500 = 2833 paise
    expect(result.commissionPaise).toBe(500);
    expect(result.lenderPayoutPaise).toBe(2833);
    expect(result.commissionPaise + result.lenderPayoutPaise).toBe(rentPaise);

    // Verify all entries for this booking sum to exactly zero
    const entries = await LedgerEntry.find({
      bookingId,
      type: { $in: ['settlement', 'deposit_release', 'commission'] },
    });
    const netSum = entries.reduce((acc, curr) => acc + curr.amountPaise, 0);
    expect(netSum).toBe(0);

    // Global ledger sum across the entire system must be exactly zero
    const globalEntries = await LedgerEntry.find();
    const globalSum = globalEntries.reduce((acc, curr) => acc + curr.amountPaise, 0);
    expect(globalSum).toBe(0);
  });
});
