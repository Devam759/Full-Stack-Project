/**
 * @file packages/server-core/src/services/trustService.js
 * Service for recording trust events and deterministically recomputing trust scores.
 * Idempotent by construction: derives score from revealed ratings and append-only trust events.
 */

import {
  calculateTrustScore,
  computeDistinctOnTimeCount,
  PENALTY_DELTAS,
} from '@borrowloop/shared';
import User from '../models/User.js';
import Rating from '../models/Rating.js';
import TrustEvent from '../models/TrustEvent.js';

/**
 * Records an append-only trust event. Idempotent based on unique eventKey.
 */
export async function recordTrustEvent({
  userId,
  type,
  delta = null,
  bookingId = null,
  counterpartyId = null,
  role = null,
  eventKey,
  meta = {},
  session = null,
}) {
  try {
    const doc = await TrustEvent.findOneAndUpdate(
      { eventKey },
      {
        $setOnInsert: {
          userId,
          type,
          delta,
          bookingId,
          counterpartyId,
          role,
          eventKey,
          meta,
          createdAt: new Date(),
        },
      },
      { upsert: true, new: true, session },
    );
    return doc;
  } catch (err) {
    if (err.code === 11000) {
      return TrustEvent.findOne({ eventKey }).session(session);
    }
    throw err;
  }
}

/**
 * Recomputes and caches trustScore, ratingAvg, and ratingCount for a user.
 * Derived cache fields are written only via recompute, never via direct $inc.
 */
export async function recompute(userId, session = null) {
  const user = await User.findById(userId).session(session);
  if (!user) return null;

  // 1. Fetch revealed ratings where ratee is this user
  const ratings = await Rating.find({ rateeId: userId, isRevealed: true }).session(session);
  const ratingCount = ratings.length;
  const ratingAvg =
    ratingCount > 0
      ? Number((ratings.reduce((acc, r) => acc + r.stars, 0) / ratingCount).toFixed(2))
      : 0;

  // 2. Fetch all trust events for this user
  const events = await TrustEvent.find({ userId }).session(session);

  // 3. Compute distinct on-time completions per counterparty and role
  const onTimeEvents = events
    .filter((e) => e.type === 'on_time_completed')
    .map((e) => ({
      counterpartyId: e.counterpartyId,
      role: e.role === 'lender' ? 'lend' : e.role === 'borrower' ? 'borrow' : e.role,
    }));
  const onTimeCount = computeDistinctOnTimeCount(onTimeEvents);

  // 4. Gather penalties
  let penaltySum = 0;
  for (const e of events) {
    if (
      e.type === 'lost_dispute' ||
      e.type === 'late_cancel' ||
      e.type === 'rejected_damage_claim' ||
      e.type === 'no_show'
    ) {
      if (typeof e.delta === 'number') {
        penaltySum += e.delta;
      } else if (PENALTY_DELTAS[e.type] !== undefined) {
        penaltySum += PENALTY_DELTAS[e.type];
      }
    }
  }

  // 5. Calculate new trust score [0 - 100]
  const trustScore = calculateTrustScore({
    ratingAvg,
    ratingCount,
    onTimeCount,
    penalties: penaltySum,
  });

  // 6. Write derived cache fields to User document
  await User.findByIdAndUpdate(
    userId,
    {
      $set: {
        trustScore,
        ratingAvg,
        ratingCount,
      },
    },
    { session, new: true },
  );

  return {
    trustScore,
    ratingAvg,
    ratingCount,
    onTimeCount,
    penaltySum,
  };
}

export default {
  recordTrustEvent,
  recompute,
};
