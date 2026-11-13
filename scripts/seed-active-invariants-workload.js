/**
 * @file scripts/seed-active-invariants-workload.js
 * Seeds a real, valid active workload into the database leaving rows behind:
 * - 2 accepted active bookings
 * - Matching ItemDayLocks (non-zero)
 * - Frozen funds & pending extension hold
 * - Perfectly balanced ledger (sum 0, no mismatches)
 * - Active conversations, messages, confirmed pins
 * - Notifications and recent domain events
 */

import mongoose from 'mongoose';
import {
  User,
  Item,
  Booking,
  ItemDayLock,
  Wallet,
  LedgerEntry,
  LedgerOperation,
  Conversation,
  Message,
  Notification,
  DomainEvent,
} from '@borrowloop/server-core';

const MONGODB_URI =
  process.env.MONGODB_URI ||
  'mongodb://127.0.0.1:27018/borrowloop_test?replicaSet=rs0&directConnection=true';

export async function seedActiveWorkload(overrideUri) {
  const targetUri = overrideUri || MONGODB_URI;
  console.info('Connecting to MongoDB for invariants workload seeding:', targetUri);
  await mongoose.connect(targetUri);

  // Drop test database to have a clean, controlled audit
  await mongoose.connection.db.dropDatabase();

  // 1. Create Users (Lender & Borrower)
  const lender = await User.create({
    email: 'lender_inv@borrowloop.test',
    name: 'Invariants Lender',
    role: 'user',
    status: 'active',
    passwordHash: 'dummy-hash',
  });

  const borrower = await User.create({
    email: 'borrower_inv@borrowloop.test',
    name: 'Invariants Borrower',
    role: 'user',
    status: 'active',
    passwordHash: 'dummy-hash',
  });

  // 2. Create Items
  const item1 = await Item.create({
    ownerId: lender._id,
    title: 'DeWalt Hammer Drill',
    description: 'Heavy duty drill for DIY work and masonry drilling.',
    category: 'tools_and_diy',
    condition: 'good',
    photos: ['https://example.com/drill.jpg'],
    rentPerDayPaise: 5000,
    depositPaise: 15000,
    status: 'active',
    location: { type: 'Point', coordinates: [77.5946, 12.9716] },
  });

  const item2 = await Item.create({
    ownerId: lender._id,
    title: 'Sony Alpha Camera',
    description: 'Mirrorless 4k camera with 24-70mm lens kit.',
    category: 'electronics_and_gadgets',
    condition: 'like_new',
    photos: ['https://example.com/camera.jpg'],
    rentPerDayPaise: 10000,
    depositPaise: 30000,
    status: 'active',
    location: { type: 'Point', coordinates: [77.5946, 12.9716] },
  });

  // 3. Create 2 Active Bookings with Day Locks & Frozen Funds
  const booking1 = await Booking.create({
    itemId: item1._id,
    borrowerId: borrower._id,
    lenderId: lender._id,
    startDate: '2026-12-01',
    endDate: '2026-12-03',
    days: 3,
    rentPaise: 15000,
    depositPaise: 15000,
    totalAmountPaise: 30000,
    status: 'accepted',
    dueAt: new Date('2026-12-04T18:00:00.000Z'),
    expiresAt: new Date('2026-12-01T23:59:59.000Z'),
    extensions: [
      {
        id: 'ext_inv_101',
        requestedEndDate: '2026-12-04',
        extraDays: 1,
        extraRentPaise: 5000,
        status: 'requested',
        requestedAt: new Date(),
        expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
      },
    ],
  });

  const booking2 = await Booking.create({
    itemId: item2._id,
    borrowerId: borrower._id,
    lenderId: lender._id,
    startDate: '2026-12-10',
    endDate: '2026-12-12',
    days: 3,
    rentPaise: 30000,
    depositPaise: 30000,
    totalAmountPaise: 60000,
    status: 'accepted',
    dueAt: new Date('2026-12-13T18:00:00.000Z'),
    expiresAt: new Date('2026-12-10T23:59:59.000Z'),
  });

  // 4. Create matching ItemDayLocks
  const locks = await ItemDayLock.insertMany([
    { itemId: item1._id, bookingId: booking1._id, day: '2026-12-01' },
    { itemId: item1._id, bookingId: booking1._id, day: '2026-12-02' },
    { itemId: item1._id, bookingId: booking1._id, day: '2026-12-03' },
    { itemId: item2._id, bookingId: booking2._id, day: '2026-12-10' },
    { itemId: item2._id, bookingId: booking2._id, day: '2026-12-11' },
    { itemId: item2._id, bookingId: booking2._id, day: '2026-12-12' },
  ]);

  // 5. Wallets & Ledger:
  // Borrower total hold: booking1 (30000 + 5000 ext) + booking2 (60000) = 95000 frozen
  // Borrower available: 100000
  // Total borrower balance = 195000 paise
  // System settlement account balances the system: -195000 paise
  const borrowerWallet = await Wallet.create({
    userId: borrower._id,
    availablePaise: 100000,
    frozenPaise: 95000,
    pendingPaise: 0,
    currency: 'INR',
  });

  await Wallet.create({
    userId: lender._id,
    availablePaise: 0,
    frozenPaise: 0,
    pendingPaise: 0,
    currency: 'INR',
  });

  const txnIdTopup = 'txn_inv_topup_1';
  const txnIdHold1 = 'txn_inv_hold_1';
  const txnIdHoldExt = 'txn_inv_hold_ext_1';
  const txnIdHold2 = 'txn_inv_hold_2';

  await LedgerEntry.insertMany([
    // User credits (total 195000)
    {
      txnId: txnIdTopup,
      account: 'available',
      userId: borrower._id,
      amountPaise: 100000,
      balanceAfterPaise: 100000,
      type: 'deposit_funds',
      description: 'Topup',
      createdAt: new Date(),
    },
    {
      txnId: txnIdHold1,
      account: 'available',
      userId: borrower._id,
      amountPaise: 30000,
      balanceAfterPaise: 130000,
      type: 'deposit_funds',
      description: 'Hold b1',
      createdAt: new Date(),
    },
    {
      txnId: txnIdHoldExt,
      account: 'available',
      userId: borrower._id,
      amountPaise: 5000,
      balanceAfterPaise: 135000,
      type: 'deposit_funds',
      description: 'Hold ext b1',
      createdAt: new Date(),
    },
    {
      txnId: txnIdHold2,
      account: 'available',
      userId: borrower._id,
      amountPaise: 60000,
      balanceAfterPaise: 195000,
      type: 'deposit_funds',
      description: 'Hold b2',
      createdAt: new Date(),
    },
    // Balancing system debits (userId: null)
    {
      txnId: txnIdTopup,
      account: 'demo_funding',
      userId: null,
      amountPaise: -100000,
      balanceAfterPaise: null,
      type: 'deposit_funds',
      description: 'System offset topup',
      createdAt: new Date(),
    },
    {
      txnId: txnIdHold1,
      account: 'demo_funding',
      userId: null,
      amountPaise: -30000,
      balanceAfterPaise: null,
      type: 'deposit_funds',
      description: 'System offset b1',
      createdAt: new Date(),
    },
    {
      txnId: txnIdHoldExt,
      account: 'demo_funding',
      userId: null,
      amountPaise: -5000,
      balanceAfterPaise: null,
      type: 'deposit_funds',
      description: 'System offset ext b1',
      createdAt: new Date(),
    },
    {
      txnId: txnIdHold2,
      account: 'demo_funding',
      userId: null,
      amountPaise: -60000,
      balanceAfterPaise: null,
      type: 'deposit_funds',
      description: 'System offset b2',
      createdAt: new Date(),
    },
  ]);

  await LedgerOperation.insertMany([
    {
      operationType: 'booking_hold',
      bookingId: booking1._id,
      opRef: 'default',
      idempotencyKey: `hold_${booking1._id}`,
    },
    {
      operationType: 'booking_hold',
      bookingId: booking2._id,
      opRef: 'default',
      idempotencyKey: `hold_${booking2._id}`,
    },
  ]);

  // 6. Conversations & Messages
  const conv1 = await Conversation.create({
    bookingId: booking1._id,
    itemId: item1._id,
    participantIds: [borrower._id, lender._id],
    confirmedPin: {
      lat: 12.9716,
      lng: 77.5946,
      label: 'MG Road Metro Station, Gate 2',
      proposedBy: borrower._id,
      confirmedBy: lender._id,
      confirmedAt: new Date(),
    },
  });

  const conv2 = await Conversation.create({
    bookingId: booking2._id,
    itemId: item2._id,
    participantIds: [borrower._id, lender._id],
  });

  await Message.create({
    conversationId: conv1._id,
    bookingId: booking1._id,
    senderId: borrower._id,
    clientMessageId: 'client-msg-00000001',
    type: 'pin',
    pin: {
      lat: 12.9716,
      lng: 77.5946,
      label: 'MG Road Metro Station, Gate 2',
      status: 'confirmed',
    },
    readBy: [borrower._id, lender._id],
  });

  await Message.create({
    conversationId: conv2._id,
    bookingId: booking2._id,
    senderId: lender._id,
    clientMessageId: 'client-msg-00000002',
    type: 'text',
    text: 'Hello, pickup details will be shared tomorrow morning.',
    readBy: [lender._id],
  });

  // 7. Notifications
  await Notification.create({
    userId: borrower._id,
    type: 'booking_accepted',
    title: 'Booking Accepted',
    body: 'Your booking for DeWalt Hammer Drill was accepted.',
    dedupeKey: `notif_b1_accepted_${booking1._id}`,
  });

  await Notification.create({
    userId: lender._id,
    type: 'booking_requested',
    title: 'New Booking Request',
    body: 'You received a new booking request.',
    dedupeKey: `notif_b2_requested_${booking2._id}`,
  });

  // 8. Domain Events (recent, pending and processed within lease)
  await DomainEvent.create({
    type: 'booking.accepted',
    aggregateType: 'booking',
    aggregateId: booking1._id,
    bookingId: booking1._id,
    eventKey: `event_accepted_${booking1._id}`,
    status: 'processed',
    leaseExpiresAt: null,
  });

  await DomainEvent.create({
    type: 'booking.extension_requested',
    aggregateType: 'booking',
    aggregateId: booking1._id,
    bookingId: booking1._id,
    eventKey: `event_ext_${booking1._id}`,
    status: 'pending',
    createdAt: new Date(),
    leaseExpiresAt: null,
  });

  console.info('Successfully seeded active invariants workload:');
  console.info(`- Active Bookings: 2 (IDs: ${booking1._id}, ${booking2._id})`);
  console.info(`- ItemDayLocks: ${locks.length}`);
  console.info(`- Total Frozen Funds: ₹950.00 (${borrowerWallet.frozenPaise} paise)`);
  console.info(`- Conversations: 2, Messages: 2, Notifications: 2`);

  await mongoose.disconnect();
}

if (process.argv[1] && process.argv[1].includes('seed-active-invariants-workload.js')) {
  seedActiveWorkload().catch((err) => {
    console.error('Seeding active workload failed:', err);
    process.exit(1);
  });
}
