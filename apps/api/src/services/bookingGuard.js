/**
 * @file apps/api/src/services/bookingGuard.js
 * Checks if an item has active bookings that block deletion, community removal,
 * or edits to prices, deposits, and day limits.
 *
 * Active booking statuses: 'accepted', 'picked_up', 'returned', 'disputed'.
 * (Stubbed for Phase 3; checks Booking model if registered, otherwise false).
 */

import mongoose from 'mongoose';
import { BUSINESS_CONFIG } from '@borrowloop/shared';

/**
 * Checks if an item currently has an active booking.
 *
 * @param {string | mongoose.Types.ObjectId} itemId
 * @param {mongoose.ClientSession} [session]
 * @returns {Promise<boolean>}
 */
export async function hasActiveBookings(itemId, session = null) {
  if (!itemId) return false;

  // If Booking model is not yet registered (Phase 3), return false
  if (!mongoose.models.Booking) {
    return false;
  }

  const query = mongoose.models.Booking.exists({
    itemId,
    status: { $in: BUSINESS_CONFIG.ACTIVE_BOOKING_STATUSES },
  });

  if (session) {
    query.session(session);
  }

  const existing = await query;
  return Boolean(existing);
}
