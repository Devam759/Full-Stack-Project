/**
 * @file apps/api/src/modules/bookings/bookingService.js
 * Core business logic and transaction orchestration for the booking lifecycle.
 * Enforces:
 * - Single source of truth state transition helper (transitionBookingStatus)
 * - Double-entry ledger integration via ledgerService
 * - Atomic conditional state updates
 * - ItemDayLock double-booking prevention
 * - Overlapping pending requests auto-rejection
 * - Settle-once LedgerOperations and persisted DomainEvents
 */

import mongoose from 'mongoose';
import { BUSINESS_CONFIG, AppError, ERROR_CODES } from '@borrowloop/shared';
import Booking from '../../models/Booking.js';
import Item from '../../models/Item.js';
import ItemDayLock from '../../models/ItemDayLock.js';
import User from '../../models/User.js';
import Membership from '../../models/Membership.js';
import Wallet from '../../models/Wallet.js';
import Block from '../../models/Block.js';
import { Conversation, Message } from '@borrowloop/server-core';
import { getTodayIST, getDaysInRange, monthsDiff } from '../../common/dates.js';
import {
  runInTransactionWithRetry,
  freezeBookingFunds,
  holdExtensionFunds,
  refundCancelledBooking,
  assertUserEligibleForWallet,
} from '../wallet/ledgerService.js';
import {
  saveIdempotencyRecord,
  isIdempotencyDuplicateError,
  handleIdempotencyConflict,
} from '../../common/idempotencyMiddleware.js';
import { emitDomainEvent } from '@borrowloop/server-core';

/**
 * Calculates dueAt (23:59:59.999 IST on endDate, which is 18:29:59.999 UTC).
 *
 * @param {string} endDateStr - YYYY-MM-DD
 * @returns {Date}
 */
export function calculateDueAtIST(endDateStr) {
  // IST is UTC + 5:30. End of day in IST is 23:59:59.999, which is 18:29:59.999 UTC.
  return new Date(`${endDateStr}T18:29:59.999Z`);
}

/**
 * Calculates pickup deadline (23:59:59.999 IST on startDate).
 *
 * @param {string} startDateStr - YYYY-MM-DD
 * @returns {Date}
 */
export function calculatePickupDeadlineIST(startDateStr) {
  return new Date(`${startDateStr}T18:29:59.999Z`);
}

/**
 * Calculates late cancellation threshold timestamp (6 hours before start date 00:00:00 IST).
 *
 * @param {string} startDateStr - YYYY-MM-DD
 * @returns {number} Timestamp in ms
 */
export function calculateLateCancelThresholdMs(startDateStr) {
  // 00:00:00 IST is 18:30:00.000 UTC of previous day.
  // 6 hours prior is 12:30:00.000 UTC of previous day.
  const startDayZeroIST = new Date(`${startDateStr}T00:00:00.000+05:30`).getTime();
  return startDayZeroIST - BUSINESS_CONFIG.LATE_CANCEL_THRESHOLD_SECONDS * 1000;
}

export { transitionBookingStatus } from '@borrowloop/server-core';
import { transitionBookingStatus } from '@borrowloop/server-core';

/**
 * Creates a new booking request.
 */
export async function createBookingRequest({
  borrowerId,
  itemId,
  startDate,
  endDate,
  idempotency = null,
}) {
  try {
    return await runInTransactionWithRetry(async (session) => {
      // 1. Borrower checks
      const borrower = await User.findById(borrowerId).session(session);
      assertUserEligibleForWallet(borrower);

      // 2. Item checks
      const item = await Item.findById(itemId).session(session);
      if (!item || item.status === 'removed') {
        throw new AppError(ERROR_CODES.ITEM_NOT_FOUND, 'Item not found', 404);
      }
      if (item.status !== 'active') {
        throw new AppError(
          ERROR_CODES.ITEM_NOT_ACTIVE,
          'Item is not currently active for borrowing',
          403,
        );
      }

      // Cannot borrow own item
      if (item.ownerId.toString() === borrowerId.toString()) {
        throw new AppError(
          ERROR_CODES.CANNOT_BORROW_OWN_ITEM,
          'You cannot borrow your own item',
          403,
        );
      }

      // 3. Lender checks
      const lender = await User.findById(item.ownerId).session(session);
      if (!lender || lender.status !== 'active') {
        throw new AppError(
          ERROR_CODES.LENDER_UNAVAILABLE,
          'Item owner is currently unavailable',
          403,
        );
      }

      // 4. Mutual block check
      const blocked = await Block.exists({
        $or: [
          { blockerId: borrowerId, blockedId: item.ownerId },
          { blockerId: item.ownerId, blockedId: borrowerId },
        ],
      }).session(session);
      if (blocked) {
        throw new AppError(
          ERROR_CODES.FORBIDDEN,
          'Action not permitted between blocked users',
          403,
        );
      }

      // 5. Common community membership check (Rule 1)
      const sharedMembership = await Membership.exists({
        userId: borrowerId,
        communityId: { $in: item.communityIds },
        status: 'active',
      }).session(session);

      if (!sharedMembership) {
        throw new AppError(
          ERROR_CODES.COMMUNITY_MEMBERSHIP_REQUIRED,
          'You must be an active member of the item community to borrow this item',
          403,
        );
      }

      // 6. Date validations
      const today = getTodayIST();
      if (startDate < today) {
        throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Start date cannot be in the past', 400);
      }
      if (endDate < startDate) {
        throw new AppError(
          ERROR_CODES.VALIDATION_ERROR,
          'End date cannot be before start date',
          400,
        );
      }

      const daysList = getDaysInRange(startDate, endDate);
      const totalDays = daysList.length;

      const minDays = item.minDays || BUSINESS_CONFIG.MIN_BOOKING_DAYS;
      const maxDays = item.maxDays || BUSINESS_CONFIG.MAX_BOOKING_DAYS;

      if (totalDays < minDays) {
        throw new AppError(
          ERROR_CODES.VALIDATION_ERROR,
          `Booking duration must be at least ${minDays} days`,
          400,
        );
      }
      if (totalDays > maxDays) {
        throw new AppError(
          ERROR_CODES.VALIDATION_ERROR,
          `Booking duration cannot exceed ${maxDays} days`,
          400,
        );
      }

      const maxAhead = monthsDiff(today, startDate);
      if (maxAhead > BUSINESS_CONFIG.AVAILABILITY_MAX_MONTHS_AHEAD) {
        throw new AppError(
          ERROR_CODES.VALIDATION_ERROR,
          `Bookings cannot be made more than ${BUSINESS_CONFIG.AVAILABILITY_MAX_MONTHS_AHEAD} months in advance`,
          400,
        );
      }

      // 7. Check for locked days
      const conflictingLocks = await ItemDayLock.find({
        itemId,
        day: { $in: daysList },
      }).session(session);

      if (conflictingLocks.length > 0) {
        throw new AppError(
          ERROR_CODES.DATES_NOT_AVAILABLE,
          'Selected dates are not available for this item',
          409,
        );
      }

      // 8. Financial calculation
      const rentPaise = totalDays * item.rentPerDayPaise;
      const depositPaise = item.depositPaise || 0;
      const totalRequiredPaise = rentPaise + depositPaise;

      const wallet = await Wallet.findOne({ userId: borrowerId }).session(session);
      const availablePaise = wallet?.availablePaise || 0;
      if (availablePaise < totalRequiredPaise) {
        throw new AppError(
          ERROR_CODES.INSUFFICIENT_FUNDS,
          `Insufficient available wallet balance. Required: ₹${(totalRequiredPaise / 100).toFixed(2)}, available: ₹${(availablePaise / 100).toFixed(2)}`,
          409,
        );
      }

      // 9. Create booking document in 'requested' state
      const now = new Date();
      const expiresAt = new Date(now.getTime() + BUSINESS_CONFIG.REQUEST_EXPIRY_SECONDS * 1000);
      const dueAt = calculateDueAtIST(endDate);

      const [booking] = await Booking.create(
        [
          {
            itemId,
            borrowerId,
            lenderId: item.ownerId,
            startDate,
            endDate,
            dueAt,
            expiresAt,
            days: totalDays,
            rentPaise,
            depositPaise,
            lateFeePerDayPaise: item.lateFeePerDayPaise || 0,
            commissionBps: BUSINESS_CONFIG.COMMISSION_BPS,
            status: 'requested',
            extensions: [],
            statusHistory: [
              {
                fromStatus: null,
                toStatus: 'requested',
                actorId: borrowerId,
                actorRole: 'borrower',
                reason: 'Initial booking request submitted',
                timestamp: now,
              },
            ],
          },
        ],
        { session },
      );

      // Create booking conversation and initial system message (Phase 6)
      const [conversation] = await Conversation.create(
        [
          {
            bookingId: booking._id,
            participantIds: [borrowerId, item.ownerId],
            lastMessageAt: now,
          },
        ],
        { session },
      );

      await Message.create(
        [
          {
            conversationId: conversation._id,
            bookingId: booking._id,
            senderId: borrowerId,
            clientMessageId: `sys-req-${booking._id}`,
            type: 'system',
            text: 'Booking requested',
            readBy: [borrowerId],
          },
        ],
        { session },
      );

      const responseData = {
        booking,
        demo: true,
      };

      if (idempotency?.key) {
        await saveIdempotencyRecord({
          userId: borrowerId,
          key: idempotency.key,
          requestHash: idempotency.requestHash,
          statusCode: 201,
          responseBody: responseData,
          session,
        });
      }

      await emitDomainEvent(
        'booking.requested',
        {
          bookingId: booking._id,
          borrowerId,
          lenderId: item.ownerId,
          itemId,
          startDate,
          endDate,
          rentPaise,
          depositPaise,
        },
        {
          session,
          bookingId: booking._id,
          actorId: borrowerId,
          eventKey: `booking_requested_${booking._id}_init`,
        },
      );

      return responseData;
    });
  } catch (error) {
    if (isIdempotencyDuplicateError(error) && idempotency) {
      return await handleIdempotencyConflict({
        userId: borrowerId,
        key: idempotency.key,
        requestHash: idempotency.requestHash,
      });
    }
    throw error;
  }
}

/**
 * Accepts a booking request.
 * Atomically updates status, freezes wallet funds, acquires day locks, and auto-rejects overlapping requests.
 */
export async function acceptBooking({ bookingId, lenderId, idempotency = null }) {
  try {
    return await runInTransactionWithRetry(async (session) => {
      const booking = await Booking.findById(bookingId).session(session);
      if (!booking) {
        throw new AppError(ERROR_CODES.BOOKING_NOT_FOUND, 'Booking not found', 404);
      }

      if (booking.lenderId.toString() !== lenderId.toString()) {
        throw new AppError(
          ERROR_CODES.FORBIDDEN,
          'Only the item owner can accept this booking',
          403,
        );
      }

      // C1 Validation: Booking expiresAt passed
      if (booking.expiresAt <= new Date()) {
        throw new AppError(ERROR_CODES.BOOKING_REQUEST_EXPIRED, 'Booking request has expired', 409);
      }

      // C1 Validation: Start date in past
      if (booking.startDate < getTodayIST()) {
        throw new AppError(
          ERROR_CODES.BOOKING_START_DATE_PASSED,
          'Booking start date is in the past',
          400,
        );
      }

      // C1 Validation: Item active check
      const item = await Item.findById(booking.itemId).session(session);
      if (!item || item.status !== 'active') {
        throw new AppError(
          ERROR_CODES.ITEM_UNAVAILABLE,
          'Item is not currently active for borrowing',
          409,
        );
      }

      // C1 Validation: Borrower active, not frozen, banned, or deleted
      const borrower = await User.findById(booking.borrowerId).session(session);
      if (!borrower || ['frozen', 'banned', 'deleted'].includes(borrower.status)) {
        throw new AppError(ERROR_CODES.USER_NOT_ELIGIBLE, 'Borrower account is not eligible', 403);
      }
      assertUserEligibleForWallet(borrower);

      // C1 Validation: Lender active, not frozen, banned, or deleted
      const lender = await User.findById(lenderId).session(session);
      if (!lender || ['frozen', 'banned', 'deleted'].includes(lender.status)) {
        throw new AppError(ERROR_CODES.USER_NOT_ELIGIBLE, 'Lender account is not eligible', 403);
      }
      assertUserEligibleForWallet(lender);

      // C1 Validation: Borrower common community membership
      const borrowerMember = await Membership.exists({
        userId: booking.borrowerId,
        communityId: { $in: item.communityIds },
        status: 'active',
      }).session(session);
      if (!borrowerMember) {
        throw new AppError(
          ERROR_CODES.NOT_COMMUNITY_MEMBER,
          'Borrower is no longer an active member of the item community',
          403,
        );
      }

      // C1 Validation: Mutual block check
      const blocked = await Block.exists({
        $or: [
          { blockerId: booking.borrowerId, blockedId: lenderId },
          { blockerId: lenderId, blockedId: booking.borrowerId },
        ],
      }).session(session);
      if (blocked) {
        throw new AppError(
          ERROR_CODES.USER_BLOCKED,
          'Action not permitted between blocked users',
          403,
        );
      }

      // 1. Acquire ItemDayLocks inside transaction (throws duplicate key if already locked)
      const days = getDaysInRange(booking.startDate, booking.endDate);
      const dayLocks = days.map((day) => ({
        itemId: booking.itemId,
        day,
        bookingId: booking._id,
      }));

      try {
        await ItemDayLock.insertMany(dayLocks, { session });
      } catch (err) {
        if (err?.code === 11000) {
          throw new AppError(
            ERROR_CODES.DATES_NOT_AVAILABLE,
            'Item dates are no longer available (already booked)',
            409,
          );
        }
        throw err;
      }

      // 2. Freeze borrower wallet funds via ledgerService (with settle-once guard)
      await freezeBookingFunds({
        borrowerId: booking.borrowerId,
        bookingId: booking._id,
        rentPaise: booking.rentPaise,
        depositPaise: booking.depositPaise,
        opRef: 'default',
        throwOnAlreadyApplied: true,
        session,
      });

      // 3. Conditional update status to 'accepted' via transition helper
      const updatedBooking = await transitionBookingStatus({
        bookingId,
        fromStatus: 'requested',
        toStatus: 'accepted',
        event: 'ACCEPT_REQUEST',
        actorRole: 'lender',
        actorId: lenderId,
        reason: 'Booking accepted by lender',
        session,
      });

      // 4. Auto-reject overlapping pending requests for this item
      const overlappingRequests = await Booking.find({
        itemId: booking.itemId,
        _id: { $ne: booking._id },
        status: 'requested',
        $or: [{ startDate: { $lte: booking.endDate }, endDate: { $gte: booking.startDate } }],
      }).session(session);

      for (const req of overlappingRequests) {
        await transitionBookingStatus({
          bookingId: req._id,
          fromStatus: 'requested',
          toStatus: 'cancelled',
          event: 'AUTO_REJECT_OVERLAPPING',
          actorRole: 'system',
          actorId: null,
          reason: 'Overlapping booking was accepted by lender',
          extraFields: { cancelReason: 'Overlapping booking was accepted' },
          session,
        });

        await emitDomainEvent(
          'booking.auto_rejected_overlapping',
          {
            bookingId: req._id,
            borrowerId: req.borrowerId,
            lenderId: req.lenderId,
            itemId: req.itemId,
            acceptedBookingId: booking._id,
          },
          {
            session,
            bookingId: req._id,
            actorId: req.borrowerId,
            eventKey: `auto_reject_overlap_${req._id}`,
          },
        );
      }

      // 5. Auto-reject overlapping pending extensions for this item whose dates conflict with this accepted booking
      const bookingsWithPendingExtensions = await Booking.find({
        itemId: booking.itemId,
        _id: { $ne: booking._id },
        'extensions.status': 'requested',
      }).session(session);

      const acceptedDays = getDaysInRange(booking.startDate, booking.endDate);

      for (const b of bookingsWithPendingExtensions) {
        const pendingExt = (b.extensions || []).find((e) => e.status === 'requested');
        if (!pendingExt) continue;

        const extDays = getDaysInRange(b.endDate, pendingExt.requestedEndDate).slice(1);
        const hasConflict = extDays.some((day) => acceptedDays.includes(day));

        if (hasConflict) {
          const rejectTime = new Date();
          await Booking.updateOne(
            {
              _id: b._id,
              extensions: {
                $elemMatch: {
                  id: pendingExt.id,
                  status: 'requested',
                },
              },
            },
            {
              $set: {
                'extensions.$.status': 'rejected',
                'extensions.$.respondedAt': rejectTime,
                'extensions.$.rejectionReason': 'Dates no longer available',
                updatedAt: rejectTime,
              },
            },
            { session },
          );

          // Release the held extension funds with canonical ext_release_${id}
          await refundCancelledBooking({
            borrowerId: b.borrowerId,
            bookingId: b._id,
            totalFrozenPaise: pendingExt.extraRentPaise,
            opRef: `ext_release_${pendingExt.id}`,
            session,
          });

          await emitDomainEvent(
            'booking.extension_rejected',
            {
              bookingId: b._id,
              borrowerId: b.borrowerId,
              lenderId: b.lenderId,
              extensionId: pendingExt.id,
              reason: 'Dates no longer available',
            },
            {
              session,
              bookingId: b._id,
              actorId: b.lenderId,
              eventKey: `auto_reject_ext_${pendingExt.id}`,
            },
          );
        }
      }

      const responseData = {
        booking: updatedBooking,
        demo: true,
      };

      if (idempotency?.key) {
        await saveIdempotencyRecord({
          userId: lenderId,
          key: idempotency.key,
          requestHash: idempotency.requestHash,
          statusCode: 200,
          responseBody: responseData,
          session,
        });
      }

      await emitDomainEvent(
        'booking.accepted',
        {
          bookingId: updatedBooking._id,
          borrowerId: updatedBooking.borrowerId,
          lenderId: updatedBooking.lenderId,
          autoRejectedCount: overlappingRequests.length,
        },
        {
          session,
          bookingId: updatedBooking._id,
          actorId: lenderId,
          eventKey: `booking_accepted_${updatedBooking._id}_default`,
        },
      );

      return responseData;
    });
  } catch (error) {
    if (isIdempotencyDuplicateError(error) && idempotency) {
      return await handleIdempotencyConflict({
        userId: lenderId,
        key: idempotency.key,
        requestHash: idempotency.requestHash,
      });
    }
    throw error;
  }
}

/**
 * Rejects a booking request.
 */
export async function rejectBooking({ bookingId, lenderId, reason = null, idempotency = null }) {
  try {
    return await runInTransactionWithRetry(async (session) => {
      const booking = await Booking.findById(bookingId).session(session);
      if (!booking) {
        throw new AppError(ERROR_CODES.BOOKING_NOT_FOUND, 'Booking not found', 404);
      }

      if (booking.lenderId.toString() !== lenderId.toString()) {
        throw new AppError(
          ERROR_CODES.FORBIDDEN,
          'Only the item owner can reject this booking',
          403,
        );
      }

      const updatedBooking = await transitionBookingStatus({
        bookingId,
        fromStatus: 'requested',
        toStatus: 'cancelled',
        event: 'REJECT_REQUEST',
        actorRole: 'lender',
        actorId: lenderId,
        reason: reason || 'Booking rejected by lender',
        extraFields: {
          cancelledBy: lenderId,
          cancelReason: reason || 'Rejected by lender',
        },
        session,
      });

      const responseData = {
        booking: updatedBooking,
        demo: true,
      };

      if (idempotency?.key) {
        await saveIdempotencyRecord({
          userId: lenderId,
          key: idempotency.key,
          requestHash: idempotency.requestHash,
          statusCode: 200,
          responseBody: responseData,
          session,
        });
      }

      await emitDomainEvent(
        'booking.rejected',
        {
          bookingId: updatedBooking._id,
          lenderId,
          reason,
        },
        {
          session,
          bookingId: updatedBooking._id,
          actorId: lenderId,
          eventKey: `booking_rejected_${updatedBooking._id}_default`,
        },
      );

      return responseData;
    });
  } catch (error) {
    if (isIdempotencyDuplicateError(error) && idempotency) {
      return await handleIdempotencyConflict({
        userId: lenderId,
        key: idempotency.key,
        requestHash: idempotency.requestHash,
      });
    }
    throw error;
  }
}

/**
 * Cancels a booking (by borrower or lender).
 */
export async function cancelBooking({
  bookingId,
  userId,
  reason = null,
  now = Date.now(),
  idempotency = null,
}) {
  try {
    return await runInTransactionWithRetry(async (session) => {
      const booking = await Booking.findById(bookingId).session(session);
      if (!booking) {
        throw new AppError(ERROR_CODES.BOOKING_NOT_FOUND, 'Booking not found', 404);
      }

      const isBorrower = booking.borrowerId.toString() === userId.toString();
      const isLender = booking.lenderId.toString() === userId.toString();

      if (!isBorrower && !isLender) {
        throw new AppError(ERROR_CODES.FORBIDDEN, 'Only participants can cancel this booking', 403);
      }

      const actorRole = isBorrower ? 'borrower' : 'lender';

      // 1. If currently in requested state
      if (booking.status === 'requested') {
        if (!isBorrower) {
          throw new AppError(
            ERROR_CODES.INVALID_BOOKING_TRANSITION,
            'Lender cannot cancel a requested booking (use reject instead)',
            409,
          );
        }

        const updatedBooking = await transitionBookingStatus({
          bookingId,
          fromStatus: 'requested',
          toStatus: 'cancelled',
          event: 'CANCEL_REQUEST',
          actorRole: 'borrower',
          actorId: userId,
          reason: reason || 'Booking request cancelled by borrower',
          extraFields: {
            cancelledBy: userId,
            cancelReason: reason || 'Cancelled by borrower',
          },
          session,
        });

        const responseData = {
          booking: updatedBooking,
          refundedPaise: 0,
          isLateCancel: false,
          demo: true,
        };

        if (idempotency?.key) {
          await saveIdempotencyRecord({
            userId,
            key: idempotency.key,
            requestHash: idempotency.requestHash,
            statusCode: 200,
            responseBody: responseData,
            session,
          });
        }

        await emitDomainEvent(
          'booking.cancelled',
          { bookingId, actorRole, userId, isLateCancel: false },
          {
            session,
            bookingId,
            actorId: userId,
            eventKey: `booking_cancelled_${bookingId}_requested`,
          },
        );

        return responseData;
      }

      // 2. If in accepted state (prior to pickup)
      if (booking.status === 'accepted') {
        const lateThresholdMs = calculateLateCancelThresholdMs(booking.startDate);
        const isLateCancel = now >= lateThresholdMs;

        // Release day locks
        await ItemDayLock.deleteMany({ bookingId: booking._id }).session(session);

        // PRD 4.10, WALLET_AND_PAYMENTS and BUSINESS_RULES:
        // All frozen money returns to borrower on cancel before pickup.
        // A late cancel (within 6 hours of start) incurs trust score penalty for the canceller,
        // but no rent split or platform commission.
        const totalFrozenPaise = booking.rentPaise + booking.depositPaise;
        await refundCancelledBooking({
          borrowerId: booking.borrowerId,
          bookingId: booking._id,
          totalFrozenPaise,
          opRef: 'default',
          throwOnAlreadyApplied: true,
          session,
        });
        let refundedPaise = totalFrozenPaise;

        // If there were any requested extensions with held funds, unfreeze them
        if (booking.extensions && booking.extensions.length > 0) {
          for (const ext of booking.extensions) {
            if (ext.status === 'requested') {
              await refundCancelledBooking({
                borrowerId: booking.borrowerId,
                bookingId: booking._id,
                totalFrozenPaise: ext.extraRentPaise,
                opRef: `ext_release_${ext.id}`,
                throwOnAlreadyApplied: false,
                session,
              });
              refundedPaise += ext.extraRentPaise;
            }
          }
        }

        const updatedBooking = await transitionBookingStatus({
          bookingId,
          fromStatus: 'accepted',
          toStatus: 'cancelled',
          event: 'CANCEL_BOOKING',
          actorRole,
          actorId: userId,
          reason: reason || `Cancelled by ${actorRole}${isLateCancel ? ' (Late cancel)' : ''}`,
          extraFields: {
            cancelledBy: userId,
            cancelReason: reason || `Cancelled by ${actorRole}`,
            isLateCancel,
          },
          session,
        });

        if (isLateCancel) {
          await emitDomainEvent(
            'trust_score.penalty',
            {
              userId,
              reason: 'late_cancel',
              delta: BUSINESS_CONFIG.TRUST_SCORE_LATE_CANCEL_DELTA || -3,
              bookingId: booking._id,
            },
            {
              session,
              bookingId: booking._id,
              actorId: userId,
              eventKey: `penalty_late_cancel_${booking._id}_${userId}`,
            },
          );
        }

        const responseData = {
          booking: updatedBooking,
          refundedPaise,
          isLateCancel,
          demo: true,
        };

        if (idempotency?.key) {
          await saveIdempotencyRecord({
            userId,
            key: idempotency.key,
            requestHash: idempotency.requestHash,
            statusCode: 200,
            responseBody: responseData,
            session,
          });
        }

        await emitDomainEvent(
          'booking.cancelled',
          { bookingId, actorRole, userId, isLateCancel, refundedPaise },
          {
            session,
            bookingId,
            actorId: userId,
            eventKey: `booking_cancelled_${bookingId}_accepted`,
          },
        );

        return responseData;
      }

      throw new AppError(
        ERROR_CODES.INVALID_BOOKING_TRANSITION,
        `Cannot cancel booking from status: ${booking.status}`,
        409,
      );
    });
  } catch (error) {
    if (isIdempotencyDuplicateError(error) && idempotency) {
      return await handleIdempotencyConflict({
        userId,
        key: idempotency.key,
        requestHash: idempotency.requestHash,
      });
    }
    throw error;
  }
}

/**
 * Requests an extension for an active booking.
 */
export async function requestExtension({
  bookingId,
  borrowerId,
  newEndDate,
  requestedEndDate,
  idempotency = null,
}) {
  const targetEndDate = newEndDate || requestedEndDate;
  try {
    return await runInTransactionWithRetry(async (session) => {
      const booking = await Booking.findById(bookingId).session(session);
      if (!booking) {
        throw new AppError(ERROR_CODES.BOOKING_NOT_FOUND, 'Booking not found', 404);
      }

      if (booking.borrowerId.toString() !== borrowerId.toString()) {
        throw new AppError(
          ERROR_CODES.FORBIDDEN,
          'Only the borrower can request an extension',
          403,
        );
      }

      if (booking.status !== 'accepted' && booking.status !== 'picked_up') {
        throw new AppError(
          ERROR_CODES.EXTENSION_NOT_ALLOWED,
          'Extension can only be requested for active bookings',
          409,
        );
      }

      const activeExtensionsCount = (booking.extensions || []).filter(
        (e) => e.status === 'accepted' || e.status === 'requested',
      ).length;

      if (activeExtensionsCount >= BUSINESS_CONFIG.MAX_BOOKING_EXTENSIONS) {
        throw new AppError(
          ERROR_CODES.MAX_EXTENSIONS_REACHED,
          `Maximum of ${BUSINESS_CONFIG.MAX_BOOKING_EXTENSIONS} extensions reached for this booking`,
          409,
        );
      }

      if (booking.extensions?.some((e) => e.status === 'requested')) {
        throw new AppError(
          ERROR_CODES.EXTENSION_ALREADY_PENDING,
          'An extension request is already pending for this booking',
          409,
        );
      }

      if (targetEndDate <= booking.endDate) {
        throw new AppError(
          ERROR_CODES.VALIDATION_ERROR,
          'New end date must be after current booking end date',
          400,
        );
      }

      const extraDays = getDaysInRange(booking.endDate, targetEndDate).slice(1);
      if (extraDays.length === 0) {
        throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Extension must add at least 1 day', 400);
      }

      const item = await Item.findById(booking.itemId).session(session);
      const maxDays = item?.maxDays || BUSINESS_CONFIG.MAX_BOOKING_DAYS;
      if (booking.days + extraDays.length > maxDays) {
        throw new AppError(
          ERROR_CODES.VALIDATION_ERROR,
          `Total duration with extension (${booking.days + extraDays.length} days) exceeds maximum allowed duration (${maxDays} days)`,
          400,
        );
      }

      // Check for day lock conflicts on the extra days
      const conflictingLocks = await ItemDayLock.find({
        itemId: booking.itemId,
        day: { $in: extraDays },
      }).session(session);

      if (conflictingLocks.length > 0) {
        throw new AppError(
          ERROR_CODES.DATES_NOT_AVAILABLE,
          'Extension dates are not available for this item',
          409,
        );
      }

      const extraRentPaise = extraDays.length * item.rentPerDayPaise;
      const borrowerWallet = await Wallet.findOne({ userId: borrowerId }).session(session);
      const availablePaise = borrowerWallet?.availablePaise || 0;
      if (availablePaise < extraRentPaise) {
        throw new AppError(
          ERROR_CODES.INSUFFICIENT_FUNDS,
          `Insufficient funds for extension rent: ₹${(extraRentPaise / 100).toFixed(2)}`,
          409,
        );
      }

      const now = new Date();
      const extId = new mongoose.Types.ObjectId().toString();
      const extItem = {
        id: extId,
        requestedEndDate: targetEndDate,
        extraDays: extraDays.length,
        extraRentPaise,
        status: 'requested',
        requestedAt: now,
        expiresAt: new Date(
          now.getTime() + (BUSINESS_CONFIG.EXTENSION_EXPIRY_SECONDS || 86400) * 1000,
        ),
      };

      if (!booking.extensions) {
        booking.extensions = [];
      }
      booking.extensions.push(extItem);
      await booking.save({ session });

      // Hold extra rent funds immediately upon extension request
      await holdExtensionFunds({
        borrowerId,
        bookingId: booking._id,
        extraRentPaise,
        extensionId: extId,
        throwOnAlreadyApplied: true,
        session,
      });

      const responseData = {
        booking,
        extension: extItem,
        demo: true,
      };

      if (idempotency?.key) {
        await saveIdempotencyRecord({
          userId: borrowerId,
          key: idempotency.key,
          requestHash: idempotency.requestHash,
          statusCode: 201,
          responseBody: responseData,
          session,
        });
      }

      await emitDomainEvent(
        'booking.extension_requested',
        {
          bookingId: booking._id,
          extensionId: extId,
          requestedEndDate: targetEndDate,
          extraDays: extraDays.length,
          extraRentPaise,
        },
        {
          session,
          bookingId: booking._id,
          actorId: borrowerId,
          eventKey: `ext_requested_${booking._id}_${extId}`,
        },
      );

      return responseData;
    });
  } catch (error) {
    if (isIdempotencyDuplicateError(error) && idempotency) {
      return await handleIdempotencyConflict({
        userId: borrowerId,
        key: idempotency.key,
        requestHash: idempotency.requestHash,
      });
    }
    throw error;
  }
}

/**
 * Accepts an extension request.
 */
export async function acceptExtension({ bookingId, lenderId, idempotency = null }) {
  try {
    return await runInTransactionWithRetry(async (session) => {
      const booking = await Booking.findById(bookingId).session(session);
      if (!booking) {
        throw new AppError(ERROR_CODES.BOOKING_NOT_FOUND, 'Booking not found', 404);
      }

      if (booking.lenderId.toString() !== lenderId.toString()) {
        throw new AppError(
          ERROR_CODES.FORBIDDEN,
          'Only the item owner can accept an extension',
          403,
        );
      }

      // Guard: Booking must be in active accepted or picked_up state (Bug A2 fix)
      if (booking.status !== 'accepted' && booking.status !== 'picked_up') {
        throw new AppError(
          ERROR_CODES.INVALID_BOOKING_TRANSITION,
          'Extension cannot be accepted for a booking that is not active',
          409,
        );
      }

      const pendingExt = (booking.extensions || []).find((e) => e.status === 'requested');
      if (!pendingExt) {
        const lastExt = booking.extensions?.[booking.extensions.length - 1];
        if (lastExt && lastExt.status === 'expired') {
          throw new AppError(
            ERROR_CODES.EXTENSION_NOT_ALLOWED,
            'Extension request has expired',
            409,
          );
        }
        throw new AppError(
          ERROR_CODES.EXTENSION_NOT_FOUND,
          'No pending extension request found',
          404,
        );
      }

      if (pendingExt.expiresAt && pendingExt.expiresAt <= new Date()) {
        throw new AppError(ERROR_CODES.EXTENSION_NOT_ALLOWED, 'Extension request has expired', 409);
      }

      const extraDays = getDaysInRange(booking.endDate, pendingExt.requestedEndDate).slice(1);

      // 1. Insert day locks for extra days
      const dayLocks = extraDays.map((day) => ({
        itemId: booking.itemId,
        day,
        bookingId: booking._id,
      }));

      try {
        await ItemDayLock.insertMany(dayLocks, { session });
      } catch (err) {
        if (err?.code === 11000) {
          throw new AppError(
            ERROR_CODES.DATES_NOT_AVAILABLE,
            'Extension dates are no longer available',
            409,
          );
        }
        throw err;
      }

      const extensionId = pendingExt.id || `ext-${booking.endDate}`;

      // 2. Atomic conditional update of booking and extension subdocument
      // (Note: Extension extraRentPaise was already held at request time per API_SPEC.md)
      const now = new Date();
      const updatedBooking = await Booking.findOneAndUpdate(
        {
          _id: bookingId,
          status: { $in: ['accepted', 'picked_up'] },
          extensions: {
            $elemMatch: {
              id: pendingExt.id,
              status: 'requested',
            },
          },
        },
        {
          $set: {
            endDate: pendingExt.requestedEndDate,
            days: booking.days + pendingExt.extraDays,
            rentPaise: booking.rentPaise + pendingExt.extraRentPaise,
            dueAt: calculateDueAtIST(pendingExt.requestedEndDate),
            'extensions.$.status': 'accepted',
            'extensions.$.respondedAt': now,
            updatedAt: now,
          },
          $push: {
            statusHistory: {
              fromStatus: booking.status,
              toStatus: booking.status,
              actorId: lenderId,
              actorRole: 'lender',
              reason: `Extension accepted until ${pendingExt.requestedEndDate}`,
              timestamp: now,
            },
          },
        },
        { session, new: true },
      );

      if (!updatedBooking) {
        throw new AppError(
          ERROR_CODES.INVALID_BOOKING_TRANSITION,
          'Booking state conflict: booking or extension was modified concurrently',
          409,
        );
      }

      const responseData = {
        booking: updatedBooking,
        demo: true,
      };

      if (idempotency?.key) {
        await saveIdempotencyRecord({
          userId: lenderId,
          key: idempotency.key,
          requestHash: idempotency.requestHash,
          statusCode: 200,
          responseBody: responseData,
          session,
        });
      }

      await emitDomainEvent(
        'booking.extension_accepted',
        {
          bookingId: updatedBooking._id,
          extensionId,
          newEndDate: pendingExt.requestedEndDate,
          extraRentPaise: pendingExt.extraRentPaise,
        },
        {
          session,
          bookingId: updatedBooking._id,
          actorId: lenderId,
          eventKey: `ext_accepted_${updatedBooking._id}_${extensionId}`,
        },
      );

      return responseData;
    });
  } catch (error) {
    if (isIdempotencyDuplicateError(error) && idempotency) {
      return await handleIdempotencyConflict({
        userId: lenderId,
        key: idempotency.key,
        requestHash: idempotency.requestHash,
      });
    }
    throw error;
  }
}

/**
 * Rejects an extension request.
 */
export async function rejectExtension({ bookingId, lenderId, reason = null, idempotency = null }) {
  try {
    return await runInTransactionWithRetry(async (session) => {
      const booking = await Booking.findById(bookingId).session(session);
      if (!booking) {
        throw new AppError(ERROR_CODES.BOOKING_NOT_FOUND, 'Booking not found', 404);
      }

      if (booking.lenderId.toString() !== lenderId.toString()) {
        throw new AppError(
          ERROR_CODES.FORBIDDEN,
          'Only the item owner can reject an extension',
          403,
        );
      }

      const pendingExt = (booking.extensions || []).find((e) => e.status === 'requested');
      if (!pendingExt) {
        const lastExt = booking.extensions?.[booking.extensions.length - 1];
        if (lastExt && lastExt.status === 'expired') {
          throw new AppError(
            ERROR_CODES.EXTENSION_NOT_ALLOWED,
            'Extension request has expired',
            409,
          );
        }
        throw new AppError(
          ERROR_CODES.EXTENSION_NOT_FOUND,
          'No pending extension request found',
          404,
        );
      }

      if (pendingExt.expiresAt && pendingExt.expiresAt <= new Date()) {
        throw new AppError(ERROR_CODES.EXTENSION_NOT_ALLOWED, 'Extension request has expired', 409);
      }

      const now = new Date();
      const updatedBooking = await Booking.findOneAndUpdate(
        {
          _id: bookingId,
          extensions: {
            $elemMatch: {
              id: pendingExt.id,
              status: 'requested',
            },
          },
        },
        {
          $set: {
            'extensions.$.status': 'rejected',
            'extensions.$.respondedAt': now,
            'extensions.$.rejectionReason': reason || 'Extension rejected by lender',
            updatedAt: now,
          },
        },
        { session, new: true },
      );

      if (!updatedBooking) {
        throw new AppError(
          ERROR_CODES.INVALID_BOOKING_TRANSITION,
          'Extension state conflict: extension was modified concurrently',
          409,
        );
      }

      // Unfreeze extension rent hold upon rejection
      await refundCancelledBooking({
        borrowerId: booking.borrowerId,
        bookingId: booking._id,
        totalFrozenPaise: pendingExt.extraRentPaise,
        opRef: `ext_release_${pendingExt.id}`,
        throwOnAlreadyApplied: false,
        session,
      });

      const responseData = {
        booking: updatedBooking,
        demo: true,
      };

      if (idempotency?.key) {
        await saveIdempotencyRecord({
          userId: lenderId,
          key: idempotency.key,
          requestHash: idempotency.requestHash,
          statusCode: 200,
          responseBody: responseData,
          session,
        });
      }

      await emitDomainEvent(
        'booking.extension_rejected',
        {
          bookingId: updatedBooking._id,
          extensionId: pendingExt.id,
          reason,
        },
        {
          session,
          bookingId: updatedBooking._id,
          actorId: lenderId,
          eventKey: `ext_rejected_${updatedBooking._id}_${pendingExt.id}`,
        },
      );

      return responseData;
    });
  } catch (error) {
    if (isIdempotencyDuplicateError(error) && idempotency) {
      return await handleIdempotencyConflict({
        userId: lenderId,
        key: idempotency.key,
        requestHash: idempotency.requestHash,
      });
    }
    throw error;
  }
}

/**
 * Gets a single booking by ID with authorization checks.
 */
export async function getBookingById({ bookingId, userId, role = null }) {
  const booking = await Booking.findById(bookingId)
    .populate('itemId', 'title photos rentPerDayPaise depositPaise ownerId')
    .populate('borrowerId', 'name photoUrl emailVerified')
    .populate('lenderId', 'name photoUrl emailVerified');

  if (!booking) {
    throw new AppError(ERROR_CODES.BOOKING_NOT_FOUND, 'Booking not found', 404);
  }

  const isBorrower =
    booking.borrowerId?._id?.toString() === userId.toString() ||
    booking.borrowerId?.toString() === userId.toString();
  const isLender =
    booking.lenderId?._id?.toString() === userId.toString() ||
    booking.lenderId?.toString() === userId.toString();
  const isAdmin = role === 'admin' || role === 'care_agent';

  if (!isBorrower && !isLender && !isAdmin) {
    throw new AppError(
      ERROR_CODES.FORBIDDEN,
      'You do not have permission to view this booking',
      403,
    );
  }

  return booking;
}

/**
 * Lists bookings with cursor pagination for the authenticated user.
 */
export async function listBookings({
  userId,
  role = null,
  status = null,
  cursor = null,
  limit = 20,
}) {
  const andConditions = [];

  if (role === 'borrower') {
    andConditions.push({ borrowerId: userId });
  } else if (role === 'lender') {
    andConditions.push({ lenderId: userId });
  } else {
    andConditions.push({
      $or: [{ borrowerId: userId }, { lenderId: userId }],
    });
  }

  if (status) {
    andConditions.push({ status });
  }

  if (cursor) {
    let decoded;
    try {
      decoded = JSON.parse(Buffer.from(cursor, 'base64').toString('utf8'));
      if (
        !decoded?.createdAt ||
        !decoded?._id ||
        isNaN(new Date(decoded.createdAt).getTime()) ||
        !mongoose.Types.ObjectId.isValid(decoded._id)
      ) {
        throw new Error('Malformed cursor');
      }
    } catch {
      throw new AppError(ERROR_CODES.BAD_REQUEST, 'Invalid pagination cursor', 400);
    }

    andConditions.push({
      $or: [
        { createdAt: { $lt: new Date(decoded.createdAt) } },
        { createdAt: new Date(decoded.createdAt), _id: { $lt: decoded._id } },
      ],
    });
  }

  const filter = andConditions.length > 0 ? { $and: andConditions } : {};

  const bookings = await Booking.find(filter)
    .sort({ createdAt: -1, _id: -1 })
    .limit(limit + 1)
    .populate('itemId', 'title photos rentPerDayPaise depositPaise')
    .populate('borrowerId', 'name photoUrl')
    .populate('lenderId', 'name photoUrl');

  let nextCursor = null;
  let items = bookings;
  if (bookings.length > limit) {
    items = bookings.slice(0, limit);
    const lastItem = items[items.length - 1];
    nextCursor = Buffer.from(
      JSON.stringify({
        createdAt: lastItem.createdAt.toISOString(),
        _id: lastItem._id.toString(),
      }),
    ).toString('base64');
  }

  return {
    items,
    nextCursor,
    totalReturned: items.length,
    demo: true,
  };
}

export default {
  calculateDueAtIST,
  calculatePickupDeadlineIST,
  calculateLateCancelThresholdMs,
  transitionBookingStatus,
  createBookingRequest,
  acceptBooking,
  rejectBooking,
  cancelBooking,
  requestExtension,
  acceptExtension,
  rejectExtension,
  getBookingById,
  listBookings,
};
