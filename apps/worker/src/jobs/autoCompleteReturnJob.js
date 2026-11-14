/**
 * @file apps/worker/src/jobs/autoCompleteReturnJob.js
 * Background worker job that:
 * 1. Sends reminder notifications to lenders 4 hours before the return confirmation deadline.
 * 2. Automatically settles and completes bookings when the return confirmation deadline passes with no dispute.
 */

import { BUSINESS_CONFIG } from '@borrowloop/shared';
import {
  Booking,
  Notification,
  ItemDayLock,
  runInTransactionWithRetry,
  runWithRedisLock,
  emitDomainEvent,
  settleBookingCompletion,
  recordTrustEvent,
  recompute,
} from '@borrowloop/server-core';
import logger from '../logger.js';

export async function autoCompleteReturnsJob({ redisClient } = {}) {
  const executeJob = async () => {
    const now = new Date();
    let processed = 0;
    let remindersSent = 0;

    // 1. Send reminders 4 hours before returnConfirmDeadline
    const reminderWindowMs =
      (BUSINESS_CONFIG.RETURN_CONFIRM_REMINDER_HOURS_BEFORE || 4) * 60 * 60 * 1000;
    const reminderThreshold = new Date(now.getTime() + reminderWindowMs);

    const impendingReturns = await Booking.find({
      status: 'returned',
      returnConfirmDeadline: { $gt: now, $lte: reminderThreshold },
    }).lean();

    for (const b of impendingReturns) {
      try {
        const dedupeKey = `return_confirm_reminder_${b._id}`;
        const existing = await Notification.findOne({ dedupeKey });
        if (!existing) {
          await Notification.create({
            userId: b.lenderId,
            type: 'return_confirm_reminder',
            title: 'Action required: Confirm item return',
            body: 'Please confirm that your item was returned in good condition, or report any issues before the review window closes.',
            link: `/bookings/${b._id}`,
            metadata: { bookingId: b._id },
            dedupeKey,
          });
          remindersSent++;
        }
      } catch (err) {
        logger.warn(`Failed to send return confirm reminder for booking ${b._id}: ${err.message}`);
      }
    }

    // 2. Auto-complete returned bookings past returnConfirmDeadline
    const expiredReturns = await Booking.find({
      status: 'returned',
      returnConfirmDeadline: { $lte: now },
    });

    for (const expiredBooking of expiredReturns) {
      let borrowerIdForTrust = null;
      let lenderIdForTrust = null;
      let isOnTime = false;

      try {
        await runInTransactionWithRetry(async (session) => {
          const b = await Booking.findById(expiredBooking._id).session(session);
          if (!b || b.status !== 'returned' || b.returnConfirmDeadline > now) {
            return;
          }

          b.status = 'completed';
          b.completedAt = now;
          b.completedBy = 'system';
          b.statusHistory.push({
            fromStatus: 'returned',
            toStatus: 'completed',
            actorId: null,
            actorRole: 'system',
            reason: 'Auto-completed by system after review window expired',
            timestamp: now,
          });

          // Release day locks
          await ItemDayLock.deleteMany({ bookingId: b._id }).session(session);

          // Settle funds via ledger
          const settlementResult = await settleBookingCompletion({
            bookingId: b._id,
            lenderId: b.lenderId,
            borrowerId: b.borrowerId,
            rentPaise: b.rentPaise,
            depositPaise: b.depositPaise,
            lateChargePaise: b.lateChargePaise || 0,
            session,
            throwOnAlreadyApplied: false,
          });

          borrowerIdForTrust = b.borrowerId;
          lenderIdForTrust = b.lenderId;
          isOnTime = b.returnAt && b.dueAt && new Date(b.returnAt) <= new Date(b.dueAt);

          if (isOnTime) {
            await recordTrustEvent({
              userId: b.borrowerId,
              type: 'on_time_completed',
              counterpartyId: b.lenderId,
              role: 'borrow',
              bookingId: b._id,
              eventKey: `on_time_${b._id}_${b.borrowerId}`,
              session,
            });

            await recordTrustEvent({
              userId: b.lenderId,
              type: 'on_time_completed',
              counterpartyId: b.borrowerId,
              role: 'lend',
              bookingId: b._id,
              eventKey: `on_time_${b._id}_${b.lenderId}`,
              session,
            });
          }

          await b.save({ session });

          await emitDomainEvent({
            type: 'booking.completed',
            bookingId: b._id,
            actorId: b.lenderId,
            payload: {
              completedBy: 'system',
              settlement: settlementResult,
            },
            session,
          });

          processed++;
        });

        if (isOnTime && borrowerIdForTrust && lenderIdForTrust) {
          try {
            await recompute(borrowerIdForTrust);
            await recompute(lenderIdForTrust);
          } catch {
            // Ignore background trust recompute errors
          }
        }
      } catch (err) {
        logger.error(`Error auto-completing booking ${expiredBooking._id}: ${err.message}`);
      }
    }

    return {
      success: true,
      processed,
      remindersSent,
    };
  };

  if (redisClient && redisClient.status === 'ready') {
    return runWithRedisLock({
      name: 'auto_complete_returns_job',
      lockTtlMs: 60000,
      redisClient,
      logger,
      handler: executeJob,
    });
  }

  return executeJob();
}

export default autoCompleteReturnsJob;
