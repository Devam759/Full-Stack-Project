/**
 * @file apps/worker/src/jobs/revealRatingsJob.js
 * Daily background worker job:
 * 1. Reveals single unrevealed ratings at completedAt + 7 days (RATING_REVEAL_SECONDS).
 * 2. Writes rating trust events, recomputes user trust scores, and recomputes item rating statistics.
 * 3. Sends day 5 rating reminders to participants who have not yet submitted feedback.
 */

import { BUSINESS_CONFIG } from '@borrowloop/shared';
import {
  Booking,
  Rating,
  Notification,
  runInTransactionWithRetry,
  runWithRedisLock,
  recordTrustEvent,
  recompute,
} from '@borrowloop/server-core';
import { recomputeItemRating } from '@borrowloop/server-core/services/ratingService.js';
import logger from '../logger.js';

export async function revealRatingsJob({ redisClient } = {}) {
  const executeJob = async () => {
    const now = new Date();
    const revealMs = (BUSINESS_CONFIG.RATING_REVEAL_SECONDS || 7 * 24 * 60 * 60) * 1000;
    const day5Ms = 5 * 24 * 60 * 60 * 1000;

    let revealedCount = 0;
    let remindersSent = 0;

    // 1. Send Day 5 reminders
    const day5Threshold = new Date(now.getTime() - day5Ms);
    const day7Threshold = new Date(now.getTime() - revealMs);

    const eligibleForReminder = await Booking.find({
      status: 'completed',
      completedAt: { $lte: day5Threshold, $gt: day7Threshold },
    }).lean();

    for (const b of eligibleForReminder) {
      const existingRatings = await Rating.find({ bookingId: b._id }).lean();
      const ratedUserIds = new Set(existingRatings.map((r) => r.raterId.toString()));

      // Check borrower
      if (!ratedUserIds.has(b.borrowerId.toString())) {
        const dedupeKey = `rating_day5_reminder_${b._id}_${b.borrowerId}`;
        const existing = await Notification.findOne({ dedupeKey });
        if (!existing) {
          await Notification.create({
            userId: b.borrowerId,
            type: 'rating_reminder',
            title: 'Friendly Reminder: Rate your borrow',
            body: 'Only 2 days remaining to leave feedback for your borrow before reviews are locked!',
            link: `/bookings/${b._id}`,
            metadata: { bookingId: b._id },
            dedupeKey,
          });
          remindersSent++;
        }
      }

      // Check lender
      if (!ratedUserIds.has(b.lenderId.toString())) {
        const dedupeKey = `rating_day5_reminder_${b._id}_${b.lenderId}`;
        const existing = await Notification.findOne({ dedupeKey });
        if (!existing) {
          await Notification.create({
            userId: b.lenderId,
            type: 'rating_reminder',
            title: 'Friendly Reminder: Rate your borrower',
            body: 'Only 2 days remaining to leave feedback for your borrower before reviews are locked!',
            link: `/bookings/${b._id}`,
            metadata: { bookingId: b._id },
            dedupeKey,
          });
          remindersSent++;
        }
      }
    }

    // 2. Reveal unrevealed ratings on bookings past 7 days
    const completedPast7Days = await Booking.find({
      status: 'completed',
      completedAt: { $lte: day7Threshold },
    }).lean();

    const bookingIds = completedPast7Days.map((b) => b._id);
    if (bookingIds.length > 0) {
      const unrevealedRatings = await Rating.find({
        bookingId: { $in: bookingIds },
        isRevealed: false,
      });

      for (const rating of unrevealedRatings) {
        const rateeId = rating.rateeId;
        const itemId = rating.itemId;

        try {
          await runInTransactionWithRetry(async (session) => {
            const r = await Rating.findById(rating._id).session(session);
            if (!r || r.isRevealed) return;

            r.isRevealed = true;
            r.revealedAt = now;
            await r.save({ session });

            await recordTrustEvent({
              userId: rateeId,
              type: 'rating',
              bookingId: r.bookingId,
              counterpartyId: r.raterId,
              role: r.targetRole === 'lender' ? 'lend' : 'borrow',
              eventKey: `rating_timed_reveal_${r._id}`,
              meta: { stars: r.stars, raterId: r.raterId },
              session,
            });

            await Notification.create(
              [
                {
                  userId: rateeId,
                  type: 'ratings_revealed',
                  title: 'New Rating Revealed',
                  body: `A ${rating.stars}-star review from your borrow has now been revealed.`,
                  link: `/bookings/${r.bookingId}`,
                  metadata: { bookingId: r.bookingId },
                },
              ],
              { session },
            );
          });

          // Recompute stats outside transaction
          await recompute(rateeId);
          if (itemId) {
            await recomputeItemRating(itemId);
          }

          revealedCount++;
        } catch (err) {
          logger.error(`Failed to reveal rating ${rating._id}: ${err.message}`);
        }
      }
    }

    return {
      success: true,
      revealedCount,
      remindersSent,
    };
  };

  if (redisClient && redisClient.status === 'ready') {
    return runWithRedisLock({
      name: 'reveal_ratings_job',
      lockTtlMs: 60000,
      redisClient,
      logger,
      handler: executeJob,
    });
  }

  return executeJob();
}

export default revealRatingsJob;
