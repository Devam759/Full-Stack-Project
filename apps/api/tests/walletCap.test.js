import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { setupTestDB, teardownTestDB, clearTestDB } from './setup/dbTestHelper.js';
import User from '../src/models/User.js';
import Wallet from '../src/models/Wallet.js';
import ledgerService from '../src/modules/wallet/ledgerService.js';

describe('Suite 7: Wallet Cap Threshold & Payout Exemption Rules', () => {
  let user;
  let lender;

  beforeAll(async () => {
    await setupTestDB();
  });

  afterAll(async () => {
    await teardownTestDB();
  });

  beforeEach(async () => {
    await clearTestDB();

    user = await User.create({
      name: 'Charlie Cap',
      email: 'cap@example.com',
      emailVerified: true,
      status: 'active',
      passwordHash: 'dummyhash',
    });

    lender = await User.create({
      name: 'Lender Rich',
      email: 'rich@example.com',
      emailVerified: true,
      status: 'active',
      passwordHash: 'dummyhash',
    });
  });

  it('rejects adding money that would exceed the Rs 50,000 wallet cap', async () => {
    // Add Rs 49,000
    await ledgerService.addDemoFunds({
      userId: user._id,
      amountPaise: 49_000_00,
    });

    // Try adding Rs 2,000 (total would be 51,000 > 50,000)
    await expect(
      ledgerService.addDemoFunds({
        userId: user._id,
        amountPaise: 2_000_00,
      }),
    ).rejects.toThrow(/cap/i);

    // Wallet remains at Rs 49,000
    const wallet = await Wallet.findOne({ userId: user._id });
    expect(wallet.availablePaise).toBe(49_000_00);
  });

  it('permits booking payout that pushes balance above the cap, but keeps manual add blocked', async () => {
    // Lender already has Rs 48,000
    await ledgerService.addDemoFunds({
      userId: lender._id,
      amountPaise: 48_000_00,
    });

    // Borrower has Rs 10,000
    await ledgerService.addDemoFunds({
      userId: user._id,
      amountPaise: 10_000_00,
    });

    const bookingId = new mongoose.Types.ObjectId();
    const rentPaise = 5_000_00; // Rs 5,000 rent
    const depositPaise = 2_000_00; // Rs 2,000 deposit

    await ledgerService.freezeBookingFunds({
      borrowerId: user._id,
      bookingId,
      rentPaise,
      depositPaise,
    });

    // Settle booking: 15% of 5000 = 750, lender gets 4250.
    // Lender's new balance: 48000 + 4250 = Rs 52,250 (above Rs 50,000 cap!)
    const settlement = await ledgerService.settleBookingCompletion({
      bookingId,
      lenderId: lender._id,
      borrowerId: user._id,
      rentPaise,
      depositPaise,
    });

    expect(settlement.lenderPayoutPaise).toBe(4_250_00);

    const lenderWallet = await Wallet.findOne({ userId: lender._id });
    expect(lenderWallet.availablePaise).toBe(52_250_00); // Exceeded cap successfully!

    // Now, verify that adding money remains blocked for lender while above cap
    await expect(
      ledgerService.addDemoFunds({
        userId: lender._id,
        amountPaise: 100_00,
      }),
    ).rejects.toThrow(/cap/i);
  });
});
