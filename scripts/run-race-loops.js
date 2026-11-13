/**
 * @file scripts/run-race-loops.js
 * Executes 20 iterations each of the 5 critical race scenarios against Docker MongoDB replica set:
 * 1. 50-parallel withdrawals (10 successes, 40 failures)
 * 2. 20 simultaneous accepts (1 success, 19 409s)
 * 3. Accept vs Cancel
 * 4. Accept vs Expiry
 * 5. Accept extension vs Cancel
 */

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error';

import mongoose from 'mongoose';
import request from 'supertest';
import app from '../apps/api/src/app.js';
import {
  User,
  Wallet,
  LedgerOperation,
  Booking,
  ItemDayLock,
  Item,
  Community,
  Membership,
  DomainEvent,
} from '@borrowloop/server-core';
import * as ledgerService from '../apps/api/src/modules/wallet/ledgerService.js';
import { signAccessToken } from '../apps/api/src/common/jwt.js';
import { executeBookingExpiryJob } from '../apps/worker/src/jobs/bookingExpiryJob.js';
import { getRedisClient } from '../apps/api/src/redis.js';

const MONGODB_URI =
  process.env.MONGODB_URI ||
  'mongodb://127.0.0.1:27018/borrowloop_test?replicaSet=rs0&directConnection=true';

async function resetDB() {
  const collections = mongoose.connection.collections;
  for (const key of Object.keys(collections)) {
    await collections[key].deleteMany({});
  }
  try {
    const redis = getRedisClient();
    if (redis && redis.status === 'ready') {
      const keys = await redis.keys('rl:*');
      if (keys.length > 0) {
        await redis.del(keys);
      }
    }
  } catch {
    // Ignore redis error in cleanup
  }
}

async function createFixtures(prefix = 'fix') {
  const ts = Date.now() + Math.floor(Math.random() * 1000000);
  const lender = await User.create({
    name: `Lender ${prefix}`,
    email: `lender_${prefix}_${ts}@example.com`,
    emailVerified: true,
    status: 'active',
    passwordHash: 'dummy',
  });

  const borrower = await User.create({
    name: `Borrower ${prefix}`,
    email: `borrower_${prefix}_${ts}@example.com`,
    emailVerified: true,
    status: 'active',
    passwordHash: 'dummy',
  });

  const community = await Community.create({
    name: `Community ${prefix}`,
    slug: `comm-${prefix}-${ts}`,
    ownerId: lender._id,
    city: 'Jaipur',
    type: 'public',
    location: { type: 'Point', coordinates: [75.8, 26.9] },
  });

  await Membership.create([
    { communityId: community._id, userId: lender._id, role: 'owner', status: 'active' },
    { communityId: community._id, userId: borrower._id, role: 'member', status: 'active' },
  ]);

  const item = await Item.create({
    ownerId: lender._id,
    communityIds: [community._id],
    title: `Item ${prefix}`,
    description: 'Test Item Description Detailed',
    category: 'tools_and_diy',
    condition: 'good',
    photos: ['https://example.com/item.jpg'],
    rentPerDayPaise: 50000,
    depositPaise: 100000,
    minDays: 1,
    maxDays: 30,
    location: { type: 'Point', coordinates: [75.8, 26.9] },
    status: 'active',
  });

  await ledgerService.addDemoFunds({
    userId: borrower._id,
    amountPaise: 500000,
  });

  const lenderToken = signAccessToken({ sub: lender._id.toString(), role: 'user' });
  const borrowerToken = signAccessToken({ sub: borrower._id.toString(), role: 'user' });

  return { lender, borrower, community, item, lenderToken, borrowerToken };
}

async function main() {
  console.info('Connecting to Docker MongoDB replica set:', MONGODB_URI);
  await mongoose.connect(MONGODB_URI);

  await Booking.init();
  await ItemDayLock.init();
  await LedgerOperation.init();
  await DomainEvent.init();

  const ITERATIONS = 20;
  const loopResults = {
    parallel50Withdrawals: { passed: 0, failed: 0, details: [] },
    simultaneous20Accepts: { passed: 0, failed: 0, details: [] },
    acceptVsCancel: { passed: 0, failed: 0, details: [] },
    acceptVsExpiry: { passed: 0, failed: 0, details: [] },
    acceptExtensionVsCancel: { passed: 0, failed: 0, details: [] },
  };

  // 1. 50-Parallel Withdrawals (20x)
  console.info(`\n[1/5] Running 50-Parallel Withdrawals (${ITERATIONS} iterations)...`);
  for (let iter = 1; iter <= ITERATIONS; iter++) {
    await resetDB();
    const user = await User.create({
      name: `Racer ${iter}`,
      email: `racer_${iter}_${Date.now()}@example.com`,
      emailVerified: true,
      status: 'active',
      passwordHash: 'dummy',
    });

    await ledgerService.addDemoFunds({
      userId: user._id,
      amountPaise: 100000,
    });

    const promises = Array.from({ length: 50 }, (_, i) =>
      ledgerService.withdrawDemoFunds({
        userId: user._id,
        amountPaise: 10000,
        meta: { iter, attempt: i + 1 },
      }),
    );

    const outcomes = await Promise.allSettled(promises);
    const successes = outcomes.filter((o) => o.status === 'fulfilled');
    const failures = outcomes.filter((o) => o.status === 'rejected');

    const wallet = await Wallet.findOne({ userId: user._id });
    const isPass =
      successes.length === 10 &&
      failures.length === 40 &&
      wallet.availablePaise === 0 &&
      wallet.frozenPaise === 0;

    if (isPass) {
      loopResults.parallel50Withdrawals.passed++;
    } else {
      loopResults.parallel50Withdrawals.failed++;
      loopResults.parallel50Withdrawals.details.push(
        `Iter ${iter}: succ=${successes.length}, fail=${failures.length}, avail=${wallet.availablePaise}`,
      );
    }
  }
  console.info(
    `✓ 50-Parallel Withdrawals: ${loopResults.parallel50Withdrawals.passed}/${ITERATIONS} passed`,
  );

  // 2. 20 Simultaneous Accepts (20x)
  console.info(`\n[2/5] Running 20 Simultaneous Accepts (${ITERATIONS} iterations)...`);
  for (let iter = 1; iter <= ITERATIONS; iter++) {
    await resetDB();
    const fixtures = await createFixtures(`race20_${iter}`);
    const bookingIds = [];

    // Create 20 bookings from distinct borrowers
    for (let i = 1; i <= 20; i++) {
      const u = await User.create({
        name: `B_${iter}_${i}`,
        email: `b_${iter}_${i}_${Date.now()}@example.com`,
        emailVerified: true,
        status: 'active',
        passwordHash: 'dummy',
      });
      await Membership.create({
        communityId: fixtures.community._id,
        userId: u._id,
        role: 'member',
        status: 'active',
      });
      await ledgerService.addDemoFunds({
        userId: u._id,
        amountPaise: 500000,
      });

      const token = signAccessToken({ sub: u._id.toString(), role: 'user' });
      const res = await request(app)
        .post('/v1/bookings')
        .set('Authorization', `Bearer ${token}`)
        .set('Idempotency-Key', `ik-race20-${iter}-${i}`)
        .send({
          itemId: fixtures.item._id.toString(),
          startDate: '2026-12-01',
          endDate: '2026-12-05',
        });
      bookingIds.push(res.body.booking._id);
    }

    const acceptPromises = bookingIds.map((bId, idx) =>
      request(app)
        .post(`/v1/bookings/${bId}/accept`)
        .set('Authorization', `Bearer ${fixtures.lenderToken}`)
        .set('Idempotency-Key', `ik-acc-${iter}-${idx}-${bId}`),
    );

    const responses = await Promise.all(acceptPromises);
    const s200 = responses.filter((r) => r.status === 200);
    const s409 = responses.filter((r) => r.status === 409);

    const locks = await ItemDayLock.find({ itemId: fixtures.item._id });
    const isPass = s200.length === 1 && s409.length === 19 && locks.length === 5;

    if (isPass) {
      loopResults.simultaneous20Accepts.passed++;
    } else {
      loopResults.simultaneous20Accepts.failed++;
      loopResults.simultaneous20Accepts.details.push(
        `Iter ${iter}: 200s=${s200.length}, 409s=${s409.length}, locks=${locks.length}`,
      );
    }
  }
  console.info(
    `✓ 20 Simultaneous Accepts: ${loopResults.simultaneous20Accepts.passed}/${ITERATIONS} passed`,
  );

  // 3. Accept vs Cancel (20x)
  console.info(`\n[3/5] Running Accept vs Cancel (${ITERATIONS} iterations)...`);
  for (let iter = 1; iter <= ITERATIONS; iter++) {
    await resetDB();
    const fixtures = await createFixtures(`avc_${iter}`);

    const createRes = await request(app)
      .post('/v1/bookings')
      .set('Authorization', `Bearer ${fixtures.borrowerToken}`)
      .set('Idempotency-Key', `ik-avc-c-${iter}`)
      .send({
        itemId: fixtures.item._id.toString(),
        startDate: '2026-12-10',
        endDate: '2026-12-12',
      });
    const bookingId = createRes.body.booking._id;

    const [accRes, cancRes] = await Promise.all([
      request(app)
        .post(`/v1/bookings/${bookingId}/accept`)
        .set('Authorization', `Bearer ${fixtures.lenderToken}`)
        .set('Idempotency-Key', `ik-avc-a-${iter}`),
      request(app)
        .post(`/v1/bookings/${bookingId}/cancel`)
        .set('Authorization', `Bearer ${fixtures.borrowerToken}`)
        .set('Idempotency-Key', `ik-avc-can-${iter}`)
        .send({ reason: 'Trip cancelled' }),
    ]);

    const booking = await Booking.findById(bookingId);
    const locks = await ItemDayLock.find({ bookingId });
    const wallet = await Wallet.findOne({ userId: fixtures.borrower._id });

    let isPass = false;
    if (booking.status === 'cancelled') {
      isPass = locks.length === 0 && wallet.frozenPaise === 0 && wallet.availablePaise === 500000;
    } else if (booking.status === 'accepted') {
      isPass =
        accRes.status === 200 &&
        cancRes.status === 409 &&
        locks.length === 3 &&
        wallet.frozenPaise === 250000;
    }

    if (isPass) {
      loopResults.acceptVsCancel.passed++;
    } else {
      loopResults.acceptVsCancel.failed++;
      loopResults.acceptVsCancel.details.push(
        `Iter ${iter}: bStatus=${booking.status}, locks=${locks.length}, frozen=${wallet.frozenPaise}`,
      );
    }
  }
  console.info(`✓ Accept vs Cancel: ${loopResults.acceptVsCancel.passed}/${ITERATIONS} passed`);

  // 4. Accept vs Expiry (20x)
  console.info(`\n[4/5] Running Accept vs Expiry (${ITERATIONS} iterations)...`);
  for (let iter = 1; iter <= ITERATIONS; iter++) {
    await resetDB();
    const fixtures = await createFixtures(`ave_${iter}`);

    const createRes = await request(app)
      .post('/v1/bookings')
      .set('Authorization', `Bearer ${fixtures.borrowerToken}`)
      .set('Idempotency-Key', `ik-ave-c-${iter}`)
      .send({
        itemId: fixtures.item._id.toString(),
        startDate: '2026-12-10',
        endDate: '2026-12-12',
      });
    const bookingId = createRes.body.booking._id;

    // Backdate expiresAt to past
    await Booking.updateOne(
      { _id: bookingId },
      { $set: { expiresAt: new Date(Date.now() - 1000) } },
    );

    const [accRes, _jobRes] = await Promise.allSettled([
      request(app)
        .post(`/v1/bookings/${bookingId}/accept`)
        .set('Authorization', `Bearer ${fixtures.lenderToken}`)
        .set('Idempotency-Key', `ik-ave-a-${iter}`),
      executeBookingExpiryJob(),
    ]);

    const booking = await Booking.findById(bookingId);
    const locks = await ItemDayLock.find({ bookingId });
    const wallet = await Wallet.findOne({ userId: fixtures.borrower._id });

    let isPass = false;
    if (booking.status === 'accepted') {
      isPass = accRes.value?.status === 200 && locks.length === 3 && wallet.frozenPaise === 250000;
    } else if (booking.status === 'expired') {
      isPass =
        accRes.value?.status === 409 &&
        locks.length === 0 &&
        wallet.frozenPaise === 0 &&
        wallet.availablePaise === 500000;
    }

    if (isPass) {
      loopResults.acceptVsExpiry.passed++;
    } else {
      loopResults.acceptVsExpiry.failed++;
      loopResults.acceptVsExpiry.details.push(
        `Iter ${iter}: status=${booking.status}, locks=${locks.length}, frozen=${wallet.frozenPaise}`,
      );
    }
  }
  console.info(`✓ Accept vs Expiry: ${loopResults.acceptVsExpiry.passed}/${ITERATIONS} passed`);

  // 5. Accept Extension vs Cancel (20x)
  console.info(`\n[5/5] Running Accept Extension vs Cancel (${ITERATIONS} iterations)...`);
  for (let iter = 1; iter <= ITERATIONS; iter++) {
    await resetDB();
    const fixtures = await createFixtures(`aevc_${iter}`);

    const createRes = await request(app)
      .post('/v1/bookings')
      .set('Authorization', `Bearer ${fixtures.borrowerToken}`)
      .set('Idempotency-Key', `ik-aevc-c-${iter}`)
      .send({
        itemId: fixtures.item._id.toString(),
        startDate: '2026-12-10',
        endDate: '2026-12-12',
      });
    const bookingId = createRes.body.booking._id;

    await request(app)
      .post(`/v1/bookings/${bookingId}/accept`)
      .set('Authorization', `Bearer ${fixtures.lenderToken}`)
      .set('Idempotency-Key', `ik-aevc-a-${iter}`);

    await request(app)
      .post(`/v1/bookings/${bookingId}/extensions`)
      .set('Authorization', `Bearer ${fixtures.borrowerToken}`)
      .set('Idempotency-Key', `ik-aevc-r-${iter}`)
      .send({ requestedEndDate: '2026-12-14' });

    const [accExtRes, cancRes] = await Promise.all([
      request(app)
        .post(`/v1/bookings/${bookingId}/extensions/accept`)
        .set('Authorization', `Bearer ${fixtures.lenderToken}`)
        .set('Idempotency-Key', `ik-aevc-acc-${iter}`),
      request(app)
        .post(`/v1/bookings/${bookingId}/cancel`)
        .set('Authorization', `Bearer ${fixtures.borrowerToken}`)
        .set('Idempotency-Key', `ik-aevc-canc-${iter}`)
        .send({ reason: 'Cancel whole trip' }),
    ]);

    const booking = await Booking.findById(bookingId);
    const locks = await ItemDayLock.find({ bookingId });
    const wallet = await Wallet.findOne({ userId: fixtures.borrower._id });

    let isPass = false;
    if (cancRes.status === 200) {
      isPass =
        booking.status === 'cancelled' &&
        locks.length === 0 &&
        wallet.frozenPaise === 0 &&
        wallet.availablePaise === 500000;
    } else if (cancRes.status === 409 && accExtRes.status === 200) {
      isPass = booking.status === 'accepted' && wallet.frozenPaise === 350000;
    }

    if (isPass) {
      loopResults.acceptExtensionVsCancel.passed++;
    } else {
      loopResults.acceptExtensionVsCancel.failed++;
      loopResults.acceptExtensionVsCancel.details.push(
        `Iter ${iter}: cancRes=${cancRes.status}, accExt=${accExtRes.status}, status=${booking.status}, frozen=${wallet.frozenPaise}`,
      );
    }
  }
  console.info(
    `✓ Accept Extension vs Cancel: ${loopResults.acceptExtensionVsCancel.passed}/${ITERATIONS} passed`,
  );

  console.info('\n[6/6] Running Chat Send vs Cancel Race (20 iterations)...');
  loopResults.chatSendVsCancel = { passed: 0, failed: 0, details: [] };
  for (let iter = 1; iter <= ITERATIONS; iter++) {
    const fixtures = await createFixtures(`chat_race_${iter}`);
    const token = signAccessToken({ sub: fixtures.borrower._id.toString(), role: 'user' });
    const bRes = await request(app)
      .post('/v1/bookings')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', `ik-crace-${iter}`)
      .send({
        itemId: fixtures.item._id.toString(),
        startDate: '2026-12-01',
        endDate: '2026-12-05',
      });
    const bookingId = bRes.body.booking._id;

    // Concurrently race sending a message and cancelling booking
    const cMsgId = `cmsg-race-${iter}-${Date.now()}`;
    const [sendRes, cancelRes] = await Promise.all([
      request(app)
        .post(`/v1/bookings/${bookingId}/messages`)
        .set('Authorization', `Bearer ${token}`)
        .send({ clientMessageId: cMsgId, type: 'text', text: `Race msg ${iter}` }),
      request(app)
        .post(`/v1/bookings/${bookingId}/cancel`)
        .set('Authorization', `Bearer ${token}`)
        .set('Idempotency-Key', `ik-crace-canc-${iter}`)
        .send({ reason: 'Race cancellation' }),
    ]);

    const afterSend = await request(app)
      .post(`/v1/bookings/${bookingId}/messages`)
      .set('Authorization', `Bearer ${token}`)
      .send({ clientMessageId: `cmsg-after-${iter}`, type: 'text', text: 'After cancel' });

    if (
      (sendRes.status === 201 || sendRes.status === 409) &&
      cancelRes.status === 200 &&
      afterSend.status === 409 &&
      afterSend.body.error?.code === 'BOOKING_TERMINAL_CHAT_CLOSED'
    ) {
      loopResults.chatSendVsCancel.passed++;
    } else {
      loopResults.chatSendVsCancel.failed++;
      loopResults.chatSendVsCancel.details.push(
        `Iter ${iter}: send=${sendRes.status}, cancel=${cancelRes.status}, afterSend=${afterSend.status}`,
      );
    }
  }
  console.info(
    `✓ Chat Send vs Cancel: ${loopResults.chatSendVsCancel.passed}/${ITERATIONS} passed`,
  );

  console.info('\n=== 20x RACE LOOPS SUMMARY TABLE ===');
  console.info(
    JSON.stringify(
      {
        '50-Parallel Withdrawals': {
          Iterations: ITERATIONS,
          Passed: loopResults.parallel50Withdrawals.passed,
          Failed: loopResults.parallel50Withdrawals.failed,
        },
        '20 Simultaneous Accepts': {
          Iterations: ITERATIONS,
          Passed: loopResults.simultaneous20Accepts.passed,
          Failed: loopResults.simultaneous20Accepts.failed,
        },
        'Accept vs Cancel': {
          Iterations: ITERATIONS,
          Passed: loopResults.acceptVsCancel.passed,
          Failed: loopResults.acceptVsCancel.failed,
        },
        'Accept vs Expiry': {
          Iterations: ITERATIONS,
          Passed: loopResults.acceptVsExpiry.passed,
          Failed: loopResults.acceptVsExpiry.failed,
        },
        'Accept Extension vs Cancel': {
          Iterations: ITERATIONS,
          Passed: loopResults.acceptExtensionVsCancel.passed,
          Failed: loopResults.acceptExtensionVsCancel.failed,
        },
        'Chat Send vs Cancel': {
          Iterations: ITERATIONS,
          Passed: loopResults.chatSendVsCancel.passed,
          Failed: loopResults.chatSendVsCancel.failed,
        },
      },
      null,
      2,
    ),
  );

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('Race loops error:', err);
  process.exit(1);
});
