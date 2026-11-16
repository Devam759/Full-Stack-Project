/**
 * @file scripts/seed-dev.js
 * Rich development database seeder for local demonstration.
 * Creates users, communities, memberships, items, wallets, and double-entry ledger records.
 */

import mongoose from 'mongoose';
import { User, Community, Membership, Item, Wallet, LedgerEntry } from '@borrowloop/server-core';
import { hashPassword } from '../apps/api/src/common/crypto.js';
import { generateTotpSecret } from '../apps/api/src/services/totpService.js';

const MONGODB_URI =
  process.env.MONGODB_URI ||
  'mongodb://127.0.0.1:27018/borrowloop?replicaSet=rs0&directConnection=true';

async function seed() {
  console.info('Connecting to MongoDB:', MONGODB_URI);
  await mongoose.connect(MONGODB_URI);

  console.info('Resetting database...');
  await mongoose.connection.db.dropDatabase();

  const defaultPassword = await hashPassword('Password123!');

  // 1. Create Staff with TOTP
  const adminTotp = generateTotpSecret('admin@borrowloop.test');
  const agentTotp = generateTotpSecret('agent@borrowloop.test');

  await User.create({
    name: 'Super Admin',
    email: 'admin@borrowloop.test',
    passwordHash: defaultPassword,
    role: 'admin',
    status: 'active',
    emailVerified: true,
    totpSecret: adminTotp.encryptedSecret,
    termsAcceptedAt: new Date(),
    ageConfirmedAt: new Date(),
  });

  await User.create({
    name: 'Care Agent Priya',
    email: 'agent@borrowloop.test',
    passwordHash: defaultPassword,
    role: 'care_agent',
    status: 'active',
    emailVerified: true,
    totpSecret: agentTotp.encryptedSecret,
    termsAcceptedAt: new Date(),
    ageConfirmedAt: new Date(),
  });

  // 2. Create Regular Users (Borrower & Lender)
  const borrower = await User.create({
    name: 'Aarav Mehta (Borrower)',
    email: 'borrower@borrowloop.test',
    passwordHash: defaultPassword,
    role: 'user',
    status: 'active',
    emailVerified: true,
    trustScore: 92,
    termsAcceptedAt: new Date(),
    ageConfirmedAt: new Date(),
    approxLocation: {
      type: 'Point',
      coordinates: [77.1925, 28.545],
    },
  });

  const lender = await User.create({
    name: 'Ananya Sharma (Lender)',
    email: 'lender@borrowloop.test',
    passwordHash: defaultPassword,
    role: 'user',
    status: 'active',
    emailVerified: true,
    trustScore: 98,
    termsAcceptedAt: new Date(),
    ageConfirmedAt: new Date(),
    approxLocation: {
      type: 'Point',
      coordinates: [77.193, 28.546],
    },
  });

  // 3. Create Communities & Memberships
  const campusCommunity = await Community.create({
    name: 'IIT Delhi Campus',
    description: 'Students and faculty sharing academic gear, electronics, and tools.',
    slug: 'iit-delhi-campus',
    type: 'public',
    city: 'New Delhi',
    ownerId: lender._id,
    location: {
      type: 'Point',
      coordinates: [77.1925, 28.545],
    },
  });

  const cityCommunity = await Community.create({
    name: 'South Delhi Community',
    description: 'Neighborhood sharing and borrowing for residents in South Delhi.',
    slug: 'south-delhi-community',
    type: 'public',
    city: 'New Delhi',
    ownerId: lender._id,
    location: {
      type: 'Point',
      coordinates: [77.21, 28.55],
    },
  });

  await Membership.create([
    { communityId: campusCommunity._id, userId: lender._id, role: 'owner', status: 'active' },
    { communityId: campusCommunity._id, userId: borrower._id, role: 'member', status: 'active' },
    { communityId: cityCommunity._id, userId: lender._id, role: 'owner', status: 'active' },
    { communityId: cityCommunity._id, userId: borrower._id, role: 'member', status: 'active' },
  ]);

  // 4. Create Items
  const itemsData = [
    {
      title: 'Sony Alpha A7 IV Mirrorless Camera',
      description:
        'Full-frame mirrorless camera with 28-70mm lens. Great for campus events and filmmaking.',
      category: 'electronics_and_gadgets',
      condition: 'like_new',
      rentPerDayPaise: 120000,
      depositPaise: 500000,
      minDays: 1,
      maxDays: 7,
      ownerId: lender._id,
      communityIds: [campusCommunity._id, cityCommunity._id],
      status: 'active',
      photos: [
        'https://images.unsplash.com/photo-1516035069371-29a1b244cc32?auto=format&fit=crop&w=800&q=80',
      ],
      location: {
        type: 'Point',
        coordinates: [77.193, 28.546],
      },
    },
    {
      title: 'Camping Tent (4-Person Waterproof)',
      description: 'Spacious 4-person waterproof dome tent with carrying bag and ground tarp.',
      category: 'outdoor_and_camping',
      condition: 'good',
      rentPerDayPaise: 35000,
      depositPaise: 150000,
      minDays: 2,
      maxDays: 10,
      ownerId: lender._id,
      communityIds: [campusCommunity._id],
      status: 'active',
      photos: [
        'https://images.unsplash.com/photo-1504280390367-361c6d9f38f4?auto=format&fit=crop&w=800&q=80',
      ],
      location: {
        type: 'Point',
        coordinates: [77.193, 28.546],
      },
    },
    {
      title: 'Bosch Professional Cordless Drill Set',
      description:
        '18V cordless drill with 2 lithium-ion batteries, charger, and 30-piece drill bit set.',
      category: 'tools_and_diy',
      condition: 'good',
      rentPerDayPaise: 25000,
      depositPaise: 100000,
      minDays: 1,
      maxDays: 5,
      ownerId: lender._id,
      communityIds: [campusCommunity._id, cityCommunity._id],
      status: 'active',
      photos: [
        'https://images.unsplash.com/photo-1504148455328-c376907d081c?auto=format&fit=crop&w=800&q=80',
      ],
      location: {
        type: 'Point',
        coordinates: [77.193, 28.546],
      },
    },
    {
      title: 'Nintendo Switch OLED + 2 Pro Controllers',
      description:
        'Nintendo Switch OLED console with Mario Kart 8 Deluxe and Super Smash Bros Ultimate.',
      category: 'electronics_and_gadgets',
      condition: 'like_new',
      rentPerDayPaise: 60000,
      depositPaise: 300000,
      minDays: 1,
      maxDays: 4,
      ownerId: lender._id,
      communityIds: [campusCommunity._id],
      status: 'active',
      photos: [
        'https://images.unsplash.com/photo-1578303512597-81e6cc155b3e?auto=format&fit=crop&w=800&q=80',
      ],
      location: {
        type: 'Point',
        coordinates: [77.193, 28.546],
      },
    },
    {
      title: 'Bose QuietComfort 45 Headphones',
      description:
        'Active noise-cancelling wireless headphones. Perfect for focused study and long flights.',
      category: 'electronics_and_gadgets',
      condition: 'like_new',
      rentPerDayPaise: 40000,
      depositPaise: 200000,
      minDays: 1,
      maxDays: 7,
      ownerId: lender._id,
      communityIds: [campusCommunity._id],
      status: 'active',
      photos: [
        'https://images.unsplash.com/photo-1546435770-a3e426bf472b?auto=format&fit=crop&w=800&q=80',
      ],
      location: {
        type: 'Point',
        coordinates: [77.193, 28.546],
      },
    },
    {
      title: 'Yamaha F310 Acoustic Guitar with Case',
      description:
        'Full-sized steel string acoustic guitar with padded gig bag, tuner, and spare strings.',
      category: 'musical_instruments',
      condition: 'good',
      rentPerDayPaise: 30000,
      depositPaise: 150000,
      minDays: 1,
      maxDays: 14,
      ownerId: lender._id,
      communityIds: [campusCommunity._id, cityCommunity._id],
      status: 'active',
      photos: [
        'https://images.unsplash.com/photo-1510915361894-db8b60106cb1?auto=format&fit=crop&w=800&q=80',
      ],
      location: {
        type: 'Point',
        coordinates: [77.193, 28.546],
      },
    },
  ];

  const createdItems = await Item.insertMany(itemsData);

  // 5. Seed Wallets and Balanced Double-Entry Ledger
  await Wallet.create({
    userId: borrower._id,
    availablePaise: 500000, // ₹5,000 demo funds
    frozenPaise: 0,
    pendingPaise: 0,
  });

  await Wallet.create({
    userId: lender._id,
    availablePaise: 500000, // ₹5,000 demo funds
    frozenPaise: 0,
    pendingPaise: 0,
  });

  // Borrower Funding Journal
  await LedgerEntry.create([
    {
      txnId: 'seed_borrower_topup_txn',
      account: 'demo_funding',
      userId: null,
      amountPaise: -500000,
      balanceAfterPaise: -500000,
      type: 'deposit_funds',
      idempotencyKey: 'seed_borrower_topup_key',
    },
    {
      txnId: 'seed_borrower_topup_txn',
      account: 'available',
      userId: borrower._id,
      amountPaise: 500000,
      balanceAfterPaise: 500000,
      type: 'deposit_funds',
      idempotencyKey: 'seed_borrower_topup_key',
    },
  ]);

  // Lender Funding Journal
  await LedgerEntry.create([
    {
      txnId: 'seed_lender_topup_txn',
      account: 'demo_funding',
      userId: null,
      amountPaise: -500000,
      balanceAfterPaise: -1000000,
      type: 'deposit_funds',
      idempotencyKey: 'seed_lender_topup_key',
    },
    {
      txnId: 'seed_lender_topup_txn',
      account: 'available',
      userId: lender._id,
      amountPaise: 500000,
      balanceAfterPaise: 500000,
      type: 'deposit_funds',
      idempotencyKey: 'seed_lender_topup_key',
    },
  ]);

  console.info('\n========================================================');
  console.info('DATABASE SEED COMPLETE');
  console.info('========================================================');
  console.info('Users Created:');
  console.info('  1. Borrower: borrower@borrowloop.test / Password123! (Balance: ₹5,000)');
  console.info('  2. Lender:   lender@borrowloop.test   / Password123! (Balance: ₹5,000)');
  console.info(
    '  3. Agent:    agent@borrowloop.test    / Password123! (TOTP: 123456 or setup in app)',
  );
  console.info(
    '  4. Admin:    admin@borrowloop.test    / Password123! (TOTP: 123456 or setup in app)',
  );
  console.info(`Communities: ${campusCommunity.name}, ${cityCommunity.name}`);
  console.info(`Items Catalog: ${createdItems.length} active items available across campus.`);
  console.info('========================================================\n');

  await mongoose.disconnect();
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
