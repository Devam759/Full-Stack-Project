/**
 * @file packages/server-core/src/services/bookingTransitions.js
 * Single source of truth for writing booking status transitions.
 * Enforces:
 * - State machine transition validation via canTransition
 * - Atomic conditional update: { _id, status: fromStatus }
 * - Append-only statusHistory audit trail
 * - Zero status writes allowed outside this helper across API and Worker
 */

import Booking from '../models/Booking.js';
import { canTransition, AppError, ERROR_CODES } from '@borrowloop/shared';

/**
 * Validates transition with canTransition and applies atomic conditional status update.
 *
 * @param {object} params
 * @param {import('mongoose').Types.ObjectId | string} params.bookingId
 * @param {string | null} params.fromStatus
 * @param {string} params.toStatus
 * @param {string} params.event
 * @param {string} params.actorRole
 * @param {import('mongoose').Types.ObjectId | string | null} [params.actorId]
 * @param {string | null} [params.reason]
 * @param {object} [params.extraFields]
 * @param {import('mongoose').ClientSession | null} [params.session]
 * @returns {Promise<import('../models/Booking.js').default>}
 */
export async function transitionBookingStatus({
  bookingId,
  fromStatus,
  toStatus,
  event,
  actorRole,
  actorId = null,
  reason = null,
  extraFields = {},
  session = null,
}) {
  const check = canTransition(fromStatus, event, actorRole);
  if (!check.allowed) {
    throw new AppError(
      ERROR_CODES.INVALID_BOOKING_TRANSITION,
      check.reason || `Transition from ${fromStatus} via ${event} not permitted for ${actorRole}`,
      409,
    );
  }

  // Item 14: Verify toStatus === check.transition.to to prevent unauthorized target status
  if (check.transition.to !== toStatus) {
    throw new AppError(
      ERROR_CODES.INVALID_BOOKING_TRANSITION,
      `Target status '${toStatus}' does not match state machine target '${check.transition.to}' for event '${event}'`,
      409,
    );
  }

  const now = new Date();
  const updateQuery = {
    $set: {
      status: toStatus,
      updatedAt: now,
      ...extraFields,
    },
    $push: {
      statusHistory: {
        fromStatus,
        toStatus,
        actorId,
        actorRole,
        reason: reason || `Status transitioned to ${toStatus} via ${event}`,
        timestamp: now,
      },
    },
  };

  const updatedBooking = await Booking.findOneAndUpdate(
    {
      _id: bookingId,
      status: fromStatus,
    },
    updateQuery,
    { session, new: true },
  );

  if (!updatedBooking) {
    throw new AppError(
      ERROR_CODES.INVALID_BOOKING_TRANSITION,
      `Booking state conflict: booking is not in '${fromStatus}' status`,
      409,
    );
  }

  // When a booking is cancelled or expired, mark any pending extension cancelled
  if (toStatus === 'cancelled' || toStatus === 'expired') {
    let hadPending = false;
    if (updatedBooking.extensions && updatedBooking.extensions.length > 0) {
      for (const ext of updatedBooking.extensions) {
        if (ext.status === 'requested') {
          ext.status = 'cancelled';
          ext.respondedAt = now;
          ext.rejectionReason = `Booking was ${toStatus}`;
          hadPending = true;
        }
      }
      if (hadPending) {
        await updatedBooking.save({ session });
      }
    }
  }

  return updatedBooking;
}

export default {
  transitionBookingStatus,
};
