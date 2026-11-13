/**
 * @file apps/api/src/services/bookingGuard.js
 * Checks if an item has active bookings that block deletion, community removal,
 * or edits to prices, deposits, and day limits.
 *
 * Active booking statuses: 'accepted', 'picked_up', 'returned', 'disputed'.
 */

import Booking from '../models/Booking.js';
import { BUSINESS_CONFIG } from '@borrowloop/shared';

/**
 * Checks if an item currently has an active booking.
 *
 * @param {string | import('mongoose').Types.ObjectId} itemId
 * @param {import('mongoose').ClientSession} [session]
 * @returns {Promise<boolean>}
 */
export async function hasActiveBookings(itemId, session = null) {
  if (!itemId) return false;

  const query = Booking.exists({
    itemId,
    status: { $in: BUSINESS_CONFIG.ACTIVE_BOOKING_STATUSES },
  });

  if (session) {
    query.session(session);
  }

  const existing = await query;
  return Boolean(existing);
}

export default {
  hasActiveBookings,
};
