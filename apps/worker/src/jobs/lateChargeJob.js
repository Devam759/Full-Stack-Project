/**
 * @file apps/worker/src/jobs/lateChargeJob.js
 * Background worker job running every ACCRUE_LATE_CHARGES_MINUTES.
 * Scans picked_up bookings past dueAt in batches of EXPIRY_BATCH_SIZE:
 * 1. Computes absolute lateChargePaise = f(now) using calculateLateCharge and updates booking (never +=).
 * 2. Emits daily "late charge accruing" notification per user with dedupeKey by date.
 * 3. At now >= dueAt + OVERDUE_DISPUTE_SECONDS:
 *    Executes OPEN_NOT_RETURNED_DISPUTE transition, sets disputeReason: 'not_returned',
 *    freezes borrower (status: 'frozen'), emits dispute.requested.
 *    No money moves and no strike applied in Phase 7.
 */

import { BUSINESS_CONFIG, calculateLateCharge } from '@borrowloop/shared';
import {
  Booking,
  User,
  Notification,
  runInTransactionWithRetry,
  runWithRedisLock,
  emitDomainEvent,
} from '@borrowloop/server-core';
import logger from '../logger.js';

export async function accrueLateChargesJob({ redisClient } = {}) {
  const executeJob = async () => {
    const now = new Date();
    const batchSize = BUSINESS_CONFIG.BACKGROUND_JOBS?.EXPIRY_BATCH_SIZE || 100;
    const overdueDisputeMs = (BUSINESS_CONFIG.OVERDUE_DISPUTE_SECONDS || 3 * 24 * 60 * 60) * 1000;

    let processedCount = 0;
    let disputesOpened = 0;
    let notificationsSent = 0;

    let hasMore = true;
    let lastId = null;

    while (hasMore) {
      const query = {
        status: 'picked_up',
        dueAt: { $lt: now },
      };
      if (lastId) {
        query._id = { $gt: lastId };
      }

      const overdueBookings = await Booking.find(query).sort({ _id: 1 }).limit(batchSize);

      if (overdueBookings.length === 0) {
        hasMore = false;
        break;
      }

      for (const booking of overdueBookings) {
        lastId = booking._id;

        const isDisputeDue = now.getTime() >= booking.dueAt.getTime() + overdueDisputeMs;

        if (isDisputeDue) {
          // Open not-returned dispute within transaction
          try {
            await runInTransactionWithRetry(async (session) => {
              const b = await Booking.findById(booking._id).session(session);
              if (!b || b.status !== 'picked_up') return;

              // Compute final late charge up to deposit
              const { lateChargePaise } = calculateLateCharge({
                dueAt: b.dueAt,
                returnAt: null,
                lateFeePerDayPaise: b.itemSnapshot?.lateFeePerDayPaise || b.lateFeePerDayPaise,
                depositPaise: b.depositPaise,
                now,
              });
              b.lateChargePaise = lateChargePaise;

              b.status = 'disputed';
              b.disputeReason = 'not_returned';
              b.disputeOpenedAt = now;
              b.statusHistory.push({
                fromStatus: 'picked_up',
                toStatus: 'disputed',
                actorId: null,
                actorRole: 'system',
                reason: 'Auto-disputed: 3 days overdue with no return',
                timestamp: now,
              });
              await b.save({ session });

              // Freeze borrower account
              await User.findByIdAndUpdate(
                b.borrowerId,
                { $set: { status: 'frozen' } },
                { session },
              );

              await emitDomainEvent({
                type: 'dispute.requested',
                bookingId: b._id,
                actorId: b.borrowerId,
                eventKey: `dispute_requested_${b._id}`,
                payload: {
                  disputeReason: 'not_returned',
                  openedBy: 'system',
                  lateChargePaise: b.lateChargePaise,
                },
                session,
              });

              disputesOpened++;
            });
          } catch (err) {
            logger.error(
              `Failed to open not-returned dispute for booking ${booking._id}: ${err.message}`,
            );
          }
        } else {
          // Calculate and write absolute lateChargePaise = f(now)
          const { lateDays, lateChargePaise } = calculateLateCharge({
            dueAt: booking.dueAt,
            returnAt: null,
            lateFeePerDayPaise:
              booking.itemSnapshot?.lateFeePerDayPaise || booking.lateFeePerDayPaise,
            depositPaise: booking.depositPaise,
            now,
          });

          await Booking.findByIdAndUpdate(booking._id, {
            $set: { lateChargePaise },
          });

          // Daily notification to borrower
          const dateStr = now.toISOString().slice(0, 10);
          const dedupeKey = `late_charge_accruing_${booking._id}_${dateStr}`;

          try {
            const existingNotif = await Notification.findOne({ dedupeKey });
            if (!existingNotif) {
              await Notification.create({
                userId: booking.borrowerId,
                type: 'late_charge_accruing',
                title: 'Item Overdue: Late Charge Accruing',
                body: `Your borrow is overdue by ${lateDays} day(s). Late charges are accruing against your security deposit.`,
                link: `/bookings/${booking._id}`,
                metadata: {
                  bookingId: booking._id,
                  lateDays,
                  lateChargePaise,
                },
                dedupeKey,
              });
              notificationsSent++;
            }
          } catch (err) {
            logger.warn(
              `Failed to send late charge notification for booking ${booking._id}: ${err.message}`,
            );
          }

          processedCount++;
        }
      }

      if (overdueBookings.length < batchSize) {
        hasMore = false;
      }
    }

    return {
      success: true,
      processedCount,
      disputesOpened,
      notificationsSent,
    };
  };

  if (redisClient && redisClient.status === 'ready') {
    return runWithRedisLock({
      name: 'accrue_late_charges_job',
      lockTtlMs: 60000,
      redisClient,
      logger,
      handler: executeJob,
    });
  }

  return executeJob();
}

export default accrueLateChargesJob;
