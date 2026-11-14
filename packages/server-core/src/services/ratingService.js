/**
 * @file packages/server-core/src/services/ratingService.js
 * Service for blind 2-way ratings between borrower and lender.
 * Ratings remain blind (unrevealed) until both parties submit or the 7-day reveal window expires.
 */

import { AppError, ERROR_CODES, BUSINESS_CONFIG } from '@borrowloop/shared';
import Booking from '../models/Booking.js';
import Rating from '../models/Rating.js';
import Item from '../models/Item.js';
import Notification from '../models/Notification.js';
import { runInTransactionWithRetry } from './ledgerService.js';
import { recordTrustEvent, recompute } from './trustService.js';
import { saveIdempotencyRecord } from '../common/idempotency.js';

/**
 * Recomputes average rating and count for an item.
 */
export async function recomputeItemRating(itemId, session = null) {
  if (!itemId) return;
  const ratings = await Rating.find({ itemId, isRevealed: true }).session(session);
  const ratingCount = ratings.length;
  const ratingAvg =
    ratingCount > 0
      ? Number((ratings.reduce((acc, r) => acc + r.stars, 0) / ratingCount).toFixed(2))
      : 0;

  await Item.findByIdAndUpdate(
    itemId,
    { $set: { ratingAvg, ratingCount } },
    { session, new: true },
  );
}

/**
 * Strips HTML tags from input string.
 */
export function sanitizeComment(str) {
  if (!str || typeof str !== 'string') return '';
  return str.replace(/<[^>]*>/g, '').trim();
}

/**
 * Submits a rating for a completed booking.
 */
export async function submitRating({ bookingId, stars, comment = '', userId, idempotency = null }) {
  const booking = await Booking.findById(bookingId);
  if (!booking) {
    throw new AppError(ERROR_CODES.BOOKING_NOT_FOUND, 'Booking not found', 404);
  }

  // Must be completed (disputed bookings can only be rated after care resolves to completed)
  if (booking.status !== 'completed') {
    throw new AppError(
      ERROR_CODES.RATING_NOT_ALLOWED,
      'Ratings are only permitted after a booking is completed',
      400,
    );
  }

  const borrowerIdStr = booking.borrowerId.toString();
  const lenderIdStr = booking.lenderId.toString();
  const userIdStr = userId.toString();

  const isBorrower = userIdStr === borrowerIdStr;
  const isLender = userIdStr === lenderIdStr;

  if (!isBorrower && !isLender) {
    throw new AppError(ERROR_CODES.FORBIDDEN, 'Only booking participants may submit ratings', 403);
  }

  // Check if rater already submitted
  const existing = await Rating.findOne({ bookingId: booking._id, raterId: userId });
  if (existing) {
    throw new AppError(
      ERROR_CODES.RATING_ALREADY_SUBMITTED,
      'You have already submitted a rating for this booking',
      409,
    );
  }

  const rateeId = isBorrower ? booking.lenderId : booking.borrowerId;
  const targetRole = isBorrower ? 'lender' : 'borrower';
  const itemId = isBorrower ? booking.itemId : null;
  const cleanedComment = sanitizeComment(comment);
  const now = new Date();

  // Check if the other party already submitted
  const otherRating = await Rating.findOne({ bookingId: booking._id, raterId: rateeId });

  let bothRevealed = false;
  let newRating = null;

  await runInTransactionWithRetry(async (session) => {
    if (otherRating) {
      // Both ratings present: reveal both simultaneously
      bothRevealed = true;

      newRating = new Rating({
        bookingId: booking._id,
        raterId: userId,
        rateeId,
        targetRole,
        itemId,
        stars,
        comment: cleanedComment,
        isRevealed: true,
        revealedAt: now,
      });
      await newRating.save({ session });

      otherRating.isRevealed = true;
      otherRating.revealedAt = now;
      await otherRating.save({ session });

      // Record trust events for both ratings
      await recordTrustEvent({
        userId: rateeId,
        type: 'rating',
        bookingId: booking._id,
        counterpartyId: userId,
        role: targetRole === 'lender' ? 'lend' : 'borrow',
        eventKey: `rating_${newRating._id}`,
        meta: { stars, raterId: userId },
        session,
      });

      await recordTrustEvent({
        userId,
        type: 'rating',
        bookingId: booking._id,
        counterpartyId: rateeId,
        role: targetRole === 'lender' ? 'borrow' : 'lend',
        eventKey: `rating_${otherRating._id}`,
        meta: { stars: otherRating.stars, raterId: rateeId },
        session,
      });

      // Send notifications: "ratings revealed"
      await Notification.insertMany(
        [
          {
            userId,
            type: 'ratings_revealed',
            title: 'Ratings Revealed',
            body: 'Both parties have submitted feedback. Your review is now visible.',
            link: `/bookings/${booking._id}`,
            metadata: { bookingId: booking._id },
          },
          {
            userId: rateeId,
            type: 'ratings_revealed',
            title: 'Ratings Revealed',
            body: 'Both parties have submitted feedback. Your review is now visible.',
            link: `/bookings/${booking._id}`,
            metadata: { bookingId: booking._id },
          },
        ],
        { session },
      );
    } else {
      // First rating: save as unrevealed
      newRating = new Rating({
        bookingId: booking._id,
        raterId: userId,
        rateeId,
        targetRole,
        itemId,
        stars,
        comment: cleanedComment,
        isRevealed: false,
        revealedAt: null,
      });
      await newRating.save({ session });

      // Notify the other party to rate their borrow
      await Notification.insertMany(
        [
          {
            userId: rateeId,
            type: 'rating_reminder',
            title: 'Rate Your Borrow Experience',
            body: 'Your borrowing partner has submitted their rating. Submit yours to unlock reviews!',
            link: `/bookings/${booking._id}`,
            metadata: { bookingId: booking._id },
            dedupeKey: `rating_prompt_${booking._id}_${rateeId}`,
          },
        ],
        { session },
      );
    }

    if (idempotency?.key) {
      await saveIdempotencyRecord({
        userId,
        key: idempotency.key,
        requestHash: idempotency.requestHash,
        statusCode: 201,
        responseBody: {
          rating: newRating.toJSON(),
          isRevealed: bothRevealed,
        },
        session,
      });
    }
  });

  // Recompute user trust scores and item ratings when revealed
  if (bothRevealed) {
    try {
      await recompute(userId);
      await recompute(rateeId);
      if (booking.itemId) {
        await recomputeItemRating(booking.itemId);
      }
    } catch {
      // Background recomputations
    }
  }

  return {
    rating: newRating,
    isRevealed: bothRevealed,
  };
}

/**
 * Lists revealed reviews for a user with keyset pagination.
 */
export async function getUserRatings({
  userId,
  callerId = null,
  before = null,
  limit = BUSINESS_CONFIG.DEFAULT_PAGE_LIMIT || 20,
}) {
  const query = {
    rateeId: userId,
  };

  if (callerId) {
    query.$or = [{ isRevealed: true }, { raterId: callerId }];
  } else {
    query.isRevealed = true;
  }

  if (before) {
    query.createdAt = { $lt: new Date(before) };
  }

  const safeLimit = Math.min(
    Math.max(1, Number(limit) || 20),
    BUSINESS_CONFIG.MAX_PAGE_LIMIT || 100,
  );

  const ratings = await Rating.find(query)
    .sort({ createdAt: -1 })
    .limit(safeLimit + 1)
    .populate('raterId', 'name photoUrl')
    .lean();

  const hasNextPage = ratings.length > safeLimit;
  const items = hasNextPage ? ratings.slice(0, safeLimit) : ratings;
  const nextCursor = hasNextPage && items.length > 0 ? items[items.length - 1].createdAt : null;

  return {
    ratings: items,
    nextCursor,
  };
}

/**
 * Lists ratings for a booking (blind to non-author unless both are revealed).
 */
export async function getBookingRatings({ bookingId, userId }) {
  const allRatings = await Rating.find({ bookingId }).lean();
  const bothRevealed = allRatings.length === 2 && allRatings.every((r) => r.isRevealed);

  if (bothRevealed) {
    return { ratings: allRatings };
  }

  // If unrevealed, caller sees ONLY their own submitted rating
  const userIdStr = userId.toString();
  const callerRatings = allRatings.filter((r) => r.raterId.toString() === userIdStr);

  return { ratings: callerRatings };
}

export default {
  submitRating,
  getUserRatings,
  getBookingRatings,
  recomputeItemRating,
  sanitizeComment,
};
