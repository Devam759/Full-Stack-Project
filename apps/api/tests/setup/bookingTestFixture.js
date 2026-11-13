/**
 * @file apps/api/tests/setup/bookingTestFixture.js
 * Fixtures and helper functions for booking lifecycle integration tests.
 */

import mongoose from 'mongoose';
import User from '../../src/models/User.js';
import Community from '../../src/models/Community.js';
import Membership from '../../src/models/Membership.js';
import Item from '../../src/models/Item.js';
import Wallet from '../../src/models/Wallet.js';
import LedgerEntry from '../../src/models/LedgerEntry.js';
import { signAccessToken } from '../../src/common/jwt.js';
import { hashPassword } from '../../src/common/crypto.js';

export async function createBookingFixtures(options = {}) {
  const {
    borrowerFundsPaise = 500000, // ₹5,000
    rentPerDayPaise = 50000, // ₹500/day
    depositPaise = 100000, // ₹1,000 deposit
    minDays = 1,
    maxDays = 30,
    itemStatus = 'active',
  } = options;

  const rand = Math.random().toString(36).substring(2, 8);
  const passwordHash = await hashPassword('Password123!');

  // 1. Create Lender
  const lender = await User.create({
    name: `Lender ${rand}`,
    email: `lender_${rand}@test.com`,
    emailVerified: true,
    status: 'active',
    passwordHash,
  });

  // 2. Create Borrower
  const borrower = await User.create({
    name: `Borrower ${rand}`,
    email: `borrower_${rand}@test.com`,
    emailVerified: true,
    status: 'active',
    passwordHash,
  });

  // 3. Create Community
  const community = await Community.create({
    name: `Community ${rand}`,
    slug: `community-${rand}`,
    description: 'Test community',
    type: 'public',
    ownerId: lender._id,
    city: 'Jaipur',
    location: {
      type: 'Point',
      coordinates: [75.8, 26.9],
    },
    memberCount: 2,
  });

  // 4. Memberships
  await Membership.create([
    {
      communityId: community._id,
      userId: lender._id,
      role: 'owner',
      status: 'active',
      joinedAt: new Date(),
    },
    {
      communityId: community._id,
      userId: borrower._id,
      role: 'member',
      status: 'active',
      joinedAt: new Date(),
    },
  ]);

  // 5. Create Item
  const item = await Item.create({
    title: `Item ${rand}`,
    description: 'A test item for borrowing within the neighborhood',
    ownerId: lender._id,
    communityIds: [community._id],
    category: 'tools_and_diy',
    rentPerDayPaise,
    depositPaise,
    minDays,
    maxDays,
    status: itemStatus,
    condition: 'good',
    photos: ['https://example.com/photo.jpg'],
    location: {
      type: 'Point',
      coordinates: [75.8, 26.9],
    },
  });

  // 6. Create Wallets
  await Wallet.create({
    userId: lender._id,
    availablePaise: 0,
    frozenPaise: 0,
    pendingPaise: 0,
  });

  const borrowerWallet = await Wallet.create({
    userId: borrower._id,
    availablePaise: borrowerFundsPaise,
    frozenPaise: 0,
    pendingPaise: 0,
  });

  // Create initial funding ledger entry if borrower has balance
  if (borrowerFundsPaise > 0) {
    const txnId = new mongoose.Types.ObjectId();
    await LedgerEntry.create([
      {
        txnId,
        userId: borrower._id,
        account: 'available',
        amountPaise: borrowerFundsPaise,
        balanceAfterPaise: borrowerFundsPaise,
        type: 'deposit_funds',
        idempotencyKey: `init_funding_${borrower._id}`,
      },
      {
        txnId,
        userId: null,
        account: 'demo_funding',
        amountPaise: -borrowerFundsPaise,
        type: 'deposit_funds',
        idempotencyKey: `init_funding_demo_${borrower._id}`,
      },
    ]);
  }

  // Tokens
  const lenderToken = signAccessToken({
    sub: lender._id.toString(),
    role: 'user',
  });

  const borrowerToken = signAccessToken({
    sub: borrower._id.toString(),
    role: 'user',
  });

  return {
    lender,
    borrower,
    community,
    item,
    borrowerWallet,
    lenderToken,
    borrowerToken,
  };
}
