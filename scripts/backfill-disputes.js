/**
 * @file scripts/backfill-disputes.js
 * Backfills missing Dispute documents for historic or legacy bookings in 'disputed' status.
 * Replays handover photos as initial evidence and assigns appropriate reason and source.
 */

import { connectDB, disconnectDB } from '../packages/server-core/src/db.js';
import Booking from '../packages/server-core/src/models/Booking.js';
import Dispute from '../packages/server-core/src/models/Dispute.js';
import Handover from '../packages/server-core/src/models/Handover.js';
import { BUSINESS_CONFIG } from '../packages/shared/src/config.js';

async function main() {
  console.info('Connecting to database...');
  await connectDB();

  console.info('Searching for bookings in disputed status...');
  const disputedBookings = await Booking.find({ status: 'disputed' }).lean();
  console.info(`Found ${disputedBookings.length} bookings in 'disputed' status.`);

  let backfilledCount = 0;
  let alreadyPresentCount = 0;

  for (const booking of disputedBookings) {
    const existing = await Dispute.findOne({ bookingId: booking._id });
    if (existing) {
      alreadyPresentCount++;
      continue;
    }

    const reason = booking.disputeReason || 'damage';
    const isSystem = reason === 'not_returned';
    const openedById = isSystem ? null : booking.lenderId;
    const againstUserId = isSystem
      ? booking.borrowerId
      : openedById?.toString() === booking.borrowerId?.toString()
        ? booking.lenderId
        : booking.borrowerId;

    let initialPhotos = [];
    try {
      const handovers = await Handover.find({ bookingId: booking._id }).lean();
      for (const h of handovers) {
        if (h.photos && Array.isArray(h.photos)) {
          for (const p of h.photos) {
            if (p.url) {
              initialPhotos.push({
                publicId: p.publicId || '',
                url: p.url,
              });
            }
          }
        }
      }
    } catch (err) {
      console.warn(`Failed to read handovers for booking ${booking._id}: ${err.message}`);
    }

    const disputeDate = booking.disputeOpenedAt || booking.updatedAt || new Date();

    try {
      await Dispute.create({
        bookingId: booking._id,
        disputeReason: reason,
        source: isSystem ? 'system' : 'user',
        openedById: openedById || null,
        againstUserId,
        status: 'opened',
        statusHistory: [
          {
            status: 'opened',
            changedBy: openedById || null,
            note: 'Backfilled legacy disputed booking',
            changedAt: disputeDate,
          },
        ],
        evidence: [
          {
            by: openedById || againstUserId,
            notes: isSystem
              ? 'Item overdue by 3+ days with no return'
              : 'Problem reported at return (backfilled)',
            photos: initialPhotos.slice(
              0,
              BUSINESS_CONFIG.DISPUTES.MAX_EVIDENCE_PHOTOS_PER_ENTRY || 6,
            ),
            createdAt: disputeDate,
          },
        ],
      });
      backfilledCount++;
    } catch (err) {
      console.error(`Failed to backfill dispute for booking ${booking._id}: ${err.message}`);
    }
  }

  console.info(
    `Backfill completed: ${backfilledCount} disputes created, ${alreadyPresentCount} already present.`,
  );
  await disconnectDB();
}

main().catch((err) => {
  console.error('Fatal error during backfill-disputes:', err);
  process.exit(1);
});
