import mongoose from 'mongoose';
import {
  Wallet,
  LedgerEntry,
  LedgerOperation,
  Booking,
  ItemDayLock,
  DomainEvent,
  Conversation,
  Message,
  Notification,
} from '@borrowloop/server-core';

const MONGODB_URI =
  process.env.MONGODB_URI ||
  'mongodb://127.0.0.1:27018/borrowloop_test?replicaSet=rs0&directConnection=true';

export async function verifyLiveInvariants(overrideUri) {
  const targetUri = overrideUri || MONGODB_URI;
  console.info('Connecting to live MongoDB replica set:', targetUri);
  await mongoose.connect(targetUri);

  const results = {};

  // 1. ledger sum 0: sum(LedgerEntry.amountPaise) == 0
  const globalSumAgg = await LedgerEntry.aggregate([
    { $group: { _id: null, total: { $sum: '$amountPaise' }, count: { $sum: 1 } } },
  ]);
  const globalSum = globalSumAgg[0]?.total ?? 0;
  const ledgerCount = globalSumAgg[0]?.count ?? 0;
  results.globalLedgerSum = {
    expected: 0,
    actual: globalSum,
    count: ledgerCount,
    pass: globalSum === 0,
  };

  // 2. negative balances count 0: No wallet has negative available, frozen or pending
  const wallets = await Wallet.find().lean();
  const negativeWallets = wallets.filter(
    (w) => (w.availablePaise || 0) < 0 || (w.frozenPaise || 0) < 0 || (w.pendingPaise || 0) < 0,
  );
  results.negativeBalancesCount = {
    count: negativeWallets.length,
    pass: negativeWallets.length === 0,
  };

  // 3. mismatch count 0: For every user, available + frozen + pending == sum(LedgerEntry)
  let walletMismatches = [];
  for (const w of wallets) {
    const userLedgerAgg = await LedgerEntry.aggregate([
      { $match: { userId: w.userId } },
      { $group: { _id: null, total: { $sum: '$amountPaise' } } },
    ]);
    const ledgerSum = userLedgerAgg[0]?.total ?? 0;
    const walletSum = (w.availablePaise || 0) + (w.frozenPaise || 0) + (w.pendingPaise || 0);

    if (ledgerSum !== walletSum) {
      walletMismatches.push({
        userId: w.userId,
        walletSum,
        ledgerSum,
        diff: walletSum - ledgerSum,
      });
    }
  }
  results.mismatchesCount = {
    totalWallets: wallets.length,
    mismatchesCount: walletMismatches.length,
    pass: walletMismatches.length === 0,
  };

  // 4. double refunds count 0: No booking has > 1 refund or settlement operation
  const refundOps = await LedgerOperation.aggregate([
    {
      $match: { operationType: { $in: ['booking_cancel_refund', 'settlement'] }, opRef: 'default' },
    },
    {
      $group: {
        _id: { bookingId: '$bookingId', operationType: '$operationType' },
        count: { $sum: 1 },
      },
    },
    { $match: { count: { $gt: 1 } } },
  ]);
  results.doubleRefundsCount = {
    count: refundOps.length,
    duplicates: refundOps,
    pass: refundOps.length === 0,
  };

  // 5. orphan locks count 0: All ItemDayLocks belong to active bookings and match booked days
  const activeBookings = await Booking.find({
    status: { $in: ['accepted', 'picked_up'] },
  }).lean();
  const activeBookingIds = new Set(activeBookings.map((b) => b._id.toString()));
  const allLocks = await ItemDayLock.find().lean();
  const orphanLocks = allLocks.filter((l) => !activeBookingIds.has(l.bookingId.toString()));
  results.orphanLocksCount = {
    totalLocks: allLocks.length,
    orphanCount: orphanLocks.length,
    pass: orphanLocks.length === 0,
  };

  // 6. overlaps count 0: No two active bookings of the same item overlap
  let overlapsCount = 0;
  const bookingsByItem = new Map();
  for (const b of activeBookings) {
    const key = b.itemId.toString();
    if (!bookingsByItem.has(key)) bookingsByItem.set(key, []);
    bookingsByItem.get(key).push(b);
  }
  for (const [_, itemBookings] of bookingsByItem.entries()) {
    itemBookings.sort((a, b) => a.startDate.localeCompare(b.startDate));
    for (let i = 0; i < itemBookings.length - 1; i++) {
      if (itemBookings[i].endDate >= itemBookings[i + 1].startDate) {
        overlapsCount++;
      }
    }
  }
  results.overlapsCount = {
    activeBookingsAudited: activeBookings.length,
    overlapsCount,
    pass: overlapsCount === 0,
  };

  // 7. duplicate domain events count 0: No duplicate eventKey in DomainEvent
  const dupEvents = await DomainEvent.aggregate([
    { $group: { _id: '$eventKey', count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } },
  ]);
  results.duplicateDomainEventsCount = {
    duplicateEventKeysCount: dupEvents.length,
    duplicates: dupEvents,
    pass: dupEvents.length === 0,
  };

  // 8. leftover test DBs count 0 (including borrowloop_test_*)
  const adminDb = mongoose.connection.db.admin();
  const dbs = await adminDb.listDatabases();
  const leftoverTestDbs = dbs.databases.filter(
    (d) =>
      /^test_[a-zA-Z0-9_-]+$/.test(d.name) ||
      (/^borrowloop_test_[a-zA-Z0-9_-]+$/.test(d.name) && d.name !== 'borrowloop_test'),
  );
  results.leftoverTestDbsCount = {
    count: leftoverTestDbs.length,
    leftoverDbs: leftoverTestDbs.map((d) => d.name),
    pass: leftoverTestDbs.length === 0,
  };

  // 9. Phase 6: Conversations without a booking (0)
  const allConversations = await Conversation.find().lean();
  const allBookingIds = new Set(
    (await Booking.find({}, { _id: 1 }).lean()).map((b) => b._id.toString()),
  );
  const orphanConversations = allConversations.filter(
    (c) => !allBookingIds.has(c.bookingId?.toString()),
  );
  results.orphanConversationsCount = {
    totalConversations: allConversations.length,
    count: orphanConversations.length,
    pass: orphanConversations.length === 0,
  };

  // 10. Phase 6: Bookings without a conversation (0)
  const conversationBookingIds = new Set(
    allConversations.map((c) => c.bookingId?.toString()).filter(Boolean),
  );
  const allBookings = await Booking.find({}, { _id: 1 }).lean();
  const orphanBookings = allBookings.filter((b) => !conversationBookingIds.has(b._id.toString()));
  results.orphanBookingsCount = {
    totalBookings: allBookings.length,
    count: orphanBookings.length,
    pass: orphanBookings.length === 0,
  };

  // 11. Phase 6: Duplicate messages per (conversationId, senderId, clientMessageId) (0)
  const dupMessages = await Message.aggregate([
    {
      $match: { clientMessageId: { $exists: true, $ne: null } },
    },
    {
      $group: {
        _id: {
          conversationId: '$conversationId',
          senderId: '$senderId',
          clientMessageId: '$clientMessageId',
        },
        count: { $sum: 1 },
      },
    },
    { $match: { count: { $gt: 1 } } },
  ]);
  results.duplicateMessagesCount = {
    count: dupMessages.length,
    duplicates: dupMessages,
    pass: dupMessages.length === 0,
  };

  // 12. Phase 6: Duplicate notifications per dedupeKey (0)
  const dupNotifs = await Notification.aggregate([
    {
      $match: { dedupeKey: { $exists: true, $ne: null } },
    },
    {
      $group: {
        _id: '$dedupeKey',
        count: { $sum: 1 },
      },
    },
    { $match: { count: { $gt: 1 } } },
  ]);
  results.duplicateNotificationsCount = {
    count: dupNotifs.length,
    duplicates: dupNotifs,
    pass: dupNotifs.length === 0,
  };

  // 13. Phase 6: domain_events stuck in pending or processing beyond lease (0)
  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
  const now = new Date();
  const stuckEvents = await DomainEvent.find({
    $or: [
      { status: 'pending', createdAt: { $lt: fiveMinAgo } },
      { status: 'processing', leaseExpiresAt: { $lt: now } },
    ],
  }).lean();
  results.stuckDomainEventsCount = {
    count: stuckEvents.length,
    stuckEvents: stuckEvents.map((e) => ({ id: e._id, status: e.status })),
    pass: stuckEvents.length === 0,
  };

  console.info('\n--- POST-RUN 13-CATEGORY INVARIANTS AUDIT (PHASE 4, 5 & 6) ---');
  console.info(
    JSON.stringify(
      {
        '1. Ledger Sum 0': {
          Status: results.globalLedgerSum.pass ? 'PASS' : 'FAIL',
          Details: `Actual: ${results.globalLedgerSum.actual} paise, Entries: ${results.globalLedgerSum.count}`,
        },
        '2. Negative Balances': {
          Status: results.negativeBalancesCount.pass ? 'PASS' : 'FAIL',
          Details: `Count: ${results.negativeBalancesCount.count}`,
        },
        '3. Mismatches Count': {
          Status: results.mismatchesCount.pass ? 'PASS' : 'FAIL',
          Details: `Wallets: ${results.mismatchesCount.totalWallets}, Mismatches: ${results.mismatchesCount.mismatchesCount}`,
        },
        '4. Double Refunds': {
          Status: results.doubleRefundsCount.pass ? 'PASS' : 'FAIL',
          Details: `Count: ${results.doubleRefundsCount.count}`,
        },
        '5. Orphan Locks': {
          Status: results.orphanLocksCount.pass ? 'PASS' : 'FAIL',
          Details: `Total locks: ${results.orphanLocksCount.totalLocks}, Orphan: ${results.orphanLocksCount.orphanCount}`,
        },
        '6. Overlaps Count': {
          Status: results.overlapsCount.pass ? 'PASS' : 'FAIL',
          Details: `Active bookings: ${results.overlapsCount.activeBookingsAudited}, Overlaps: ${results.overlapsCount.overlapsCount}`,
        },
        '7. Duplicate Events': {
          Status: results.duplicateDomainEventsCount.pass ? 'PASS' : 'FAIL',
          Details: `Duplicates: ${results.duplicateDomainEventsCount.duplicateEventKeysCount}`,
        },
        '8. Leftover Test DBs': {
          Status: results.leftoverTestDbsCount.pass ? 'PASS' : 'FAIL',
          Details: `Count: ${results.leftoverTestDbsCount.count}`,
        },
        '9. Orphan Conversations': {
          Status: results.orphanConversationsCount.pass ? 'PASS' : 'FAIL',
          Details: `Count: ${results.orphanConversationsCount.count} / Total: ${results.orphanConversationsCount.totalConversations}`,
        },
        '10. Orphan Bookings': {
          Status: results.orphanBookingsCount.pass ? 'PASS' : 'FAIL',
          Details: `Count: ${results.orphanBookingsCount.count} / Total: ${results.orphanBookingsCount.totalBookings}`,
        },
        '11. Duplicate Messages (clientMessageId)': {
          Status: results.duplicateMessagesCount.pass ? 'PASS' : 'FAIL',
          Details: `Count: ${results.duplicateMessagesCount.count}`,
        },
        '12. Duplicate Notifications (dedupeKey)': {
          Status: results.duplicateNotificationsCount.pass ? 'PASS' : 'FAIL',
          Details: `Count: ${results.duplicateNotificationsCount.count}`,
        },
        '13. Stuck Domain Events (lease expired)': {
          Status: results.stuckDomainEventsCount.pass ? 'PASS' : 'FAIL',
          Details: `Count: ${results.stuckDomainEventsCount.count}`,
        },
      },
      null,
      2,
    ),
  );

  await mongoose.disconnect();

  const allPassed = Object.values(results).every((r) => r.pass);
  console.info(`\nALL 13 INVARIANTS SATISFIED: ${allPassed ? 'YES' : 'NO'}`);
  return allPassed;
}

if (process.argv[1] && process.argv[1].includes('check-invariants.js')) {
  verifyLiveInvariants()
    .then((passed) => process.exit(passed ? 0 : 1))
    .catch((err) => {
      console.error('Invariants check failed:', err);
      process.exit(1);
    });
}
