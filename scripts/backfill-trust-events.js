/**
 * @file scripts/backfill-trust-events.js
 * Backfills append-only trust events from historic domain_events.
 * Replays existing late-cancel penalty events and skips automatic no-show events.
 */

import { connectDB, disconnectDB } from '../packages/server-core/src/db.js';
import DomainEvent from '../packages/server-core/src/models/DomainEvent.js';
import { recordTrustEvent, recompute } from '../packages/server-core/src/services/trustService.js';

async function main() {
  console.info('Connecting to database...');
  await connectDB();

  console.info('Searching for historic trust_score.penalty domain events...');
  const penaltyEvents = await DomainEvent.find({ type: 'trust_score.penalty' }).lean();
  console.info(`Found ${penaltyEvents.length} penalty events to evaluate.`);

  let replayed = 0;
  let skippedNoShow = 0;
  const userIdsToRecompute = new Set();

  for (const ev of penaltyEvents) {
    const reason = ev.payload?.reason;
    const userId = ev.payload?.userId || ev.actorId;

    if (reason === 'no_show') {
      skippedNoShow++;
      continue;
    }

    if (!userId) {
      continue;
    }

    const eventKey = ev.eventKey ? `backfill_${ev.eventKey}` : `backfill_${ev._id}`;

    await recordTrustEvent({
      userId,
      type: reason || 'late_cancel',
      delta: typeof ev.payload?.delta === 'number' ? ev.payload.delta : null,
      bookingId: ev.bookingId,
      eventKey,
      meta: { backfilledFrom: ev._id, ...ev.payload },
    });

    userIdsToRecompute.add(userId.toString());
    replayed++;
  }

  console.info(
    `Replayed ${replayed} trust events (skipped ${skippedNoShow} legacy no-show events).`,
  );
  console.info(`Recomputing trust scores for ${userIdsToRecompute.size} users...`);

  for (const uid of userIdsToRecompute) {
    await recompute(uid);
  }

  console.info('Backfill completed successfully.');
  await disconnectDB();
}

if (process.argv[1] && process.argv[1].includes('backfill-trust-events.js')) {
  main().catch((err) => {
    console.error('Backfill error:', err);
    process.exit(1);
  });
}

export default main;
