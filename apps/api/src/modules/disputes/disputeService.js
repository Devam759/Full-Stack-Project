/**
 * @file apps/api/src/modules/disputes/disputeService.js
 * Business logic for disputes: user opening, adding evidence, and participant/staff fetching.
 */

import {
  Booking,
  Dispute,
  emitDomainEvent,
  runInTransactionWithRetry,
  transitionBookingStatus,
} from '@borrowloop/server-core';
import { AppError, ERROR_CODES, BUSINESS_CONFIG } from '@borrowloop/shared';
import { saveIdempotencyRecord } from '../../common/idempotencyMiddleware.js';
import { emitToUser } from '../../sockets/socketServer.js';

const { DISPUTES } = BUSINESS_CONFIG;

export function sanitizeDispute(dispute, isStaff = false) {
  if (!dispute) return null;
  const d = dispute.toObject ? dispute.toObject() : JSON.parse(JSON.stringify(dispute));
  if (!isStaff && d.decision) {
    delete d.decision.internalNote;
  }
  return d;
}

/**
 * Opens a dispute for an active booking.
 * Allowed reasons:
 * - 'condition_mismatch': borrower only, picked_up status, now <= dueAt
 * - 'no_show': borrower or lender, accepted status, startDate <= now <= pickupDeadline
 */
export async function openDispute({
  bookingId,
  reason,
  details,
  photos = [],
  userId,
  userRole = 'user',
  idempotency = null,
}) {
  const now = new Date();

  // Reason guard: users can only open condition_mismatch or no_show
  if (reason === 'damage') {
    throw new AppError(
      ERROR_CODES.DISPUTE_NOT_ALLOWED,
      'Damage disputes must be opened via return problem confirmation',
      403,
    );
  }
  if (reason === 'not_returned') {
    throw new AppError(
      ERROR_CODES.DISPUTE_NOT_ALLOWED,
      'Not returned disputes are opened automatically by system overdue job',
      403,
    );
  }
  if (reason !== 'condition_mismatch' && reason !== 'no_show') {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, `Invalid dispute reason: ${reason}`, 400);
  }

  const booking = await Booking.findById(bookingId);
  if (!booking) {
    throw new AppError(ERROR_CODES.BOOKING_NOT_FOUND, 'Booking not found', 404);
  }

  const borrowerIdStr = (booking.borrowerId?._id || booking.borrowerId).toString();
  const lenderIdStr = (booking.lenderId?._id || booking.lenderId).toString();
  const userIdStr = userId.toString();

  if (userIdStr !== borrowerIdStr && userIdStr !== lenderIdStr) {
    throw new AppError(ERROR_CODES.FORBIDDEN, 'Only booking participants can open a dispute', 403);
  }

  // Exactly one dispute per booking
  const existingDispute = await Dispute.findOne({ bookingId });
  if (existingDispute) {
    throw new AppError(
      ERROR_CODES.DISPUTE_ALREADY_EXISTS,
      'A dispute already exists for this booking',
      409,
    );
  }

  let event;
  let actorRole;
  let againstUserId;

  if (reason === 'condition_mismatch') {
    if (userIdStr !== borrowerIdStr) {
      throw new AppError(
        ERROR_CODES.DISPUTE_NOT_ALLOWED,
        'Only the borrower can report condition mismatch',
        403,
      );
    }
    if (booking.status !== 'picked_up') {
      throw new AppError(
        ERROR_CODES.DISPUTE_NOT_ALLOWED,
        `Cannot open condition mismatch dispute when booking is '${booking.status}'. Booking must be 'picked_up'.`,
        403,
      );
    }
    if (now.getTime() > new Date(booking.dueAt).getTime()) {
      throw new AppError(
        ERROR_CODES.DISPUTE_NOT_ALLOWED,
        'Condition mismatch disputes must be opened before the return due date',
        403,
      );
    }
    event = 'OPEN_CONDITION_DISPUTE';
    actorRole = 'borrower';
    againstUserId = booking.lenderId;
  } else if (reason === 'no_show') {
    if (booking.status !== 'accepted') {
      throw new AppError(
        ERROR_CODES.DISPUTE_NOT_ALLOWED,
        `Cannot open no-show dispute when booking is '${booking.status}'. Booking must be 'accepted'.`,
        403,
      );
    }
    const startDate = new Date(booking.startDate);
    const pickupDeadlineHours = BUSINESS_CONFIG.PICKUP_DEADLINE_HOURS || 24;
    const pickupDeadline = new Date(startDate.getTime() + pickupDeadlineHours * 3600 * 1000);

    if (now.getTime() < startDate.getTime()) {
      throw new AppError(
        ERROR_CODES.DISPUTE_NOT_ALLOWED,
        'Cannot report no-show before the booking start date',
        403,
      );
    }
    if (now.getTime() > pickupDeadline.getTime()) {
      throw new AppError(
        ERROR_CODES.DISPUTE_NOT_ALLOWED,
        'Pickup window has closed; no-show dispute can no longer be opened',
        403,
      );
    }

    event = 'OPEN_NO_SHOW_DISPUTE';
    actorRole = userIdStr === borrowerIdStr ? 'borrower' : 'lender';
    againstUserId = userIdStr === borrowerIdStr ? booking.lenderId : booking.borrowerId;
  }

  return runInTransactionWithRetry(async (session) => {
    // 1. Transition booking status to 'disputed'
    const updatedBooking = await transitionBookingStatus({
      bookingId: booking._id,
      fromStatus: booking.status,
      toStatus: 'disputed',
      event,
      actorRole,
      actorId: userId,
      reason: details,
      extraFields: {
        disputeReason: reason,
        disputeOpenedAt: now,
      },
      session,
    });

    // 2. Format photos
    const formattedPhotos = (photos || [])
      .slice(0, DISPUTES.MAX_EVIDENCE_PHOTOS_PER_ENTRY || 6)
      .map((p) => ({
        publicId: p.publicId || '',
        url: p.url,
      }));

    // 3. Create Dispute document
    const [dispute] = await Dispute.create(
      [
        {
          bookingId: booking._id,
          disputeReason: reason,
          source: 'user',
          openedById: userId,
          againstUserId,
          status: 'opened',
          statusHistory: [
            {
              status: 'opened',
              changedBy: userId,
              note: details,
              changedAt: now,
            },
          ],
          evidence: [
            {
              by: userId,
              notes: details,
              photos: formattedPhotos,
              createdAt: now,
            },
          ],
        },
      ],
      { session },
    );

    // 4. Emit outbox event
    await emitDomainEvent({
      type: 'dispute.opened',
      bookingId: booking._id,
      actorId: userId,
      eventKey: `dispute_opened_${dispute._id}`,
      payload: {
        disputeId: dispute._id,
        disputeReason: reason,
        openedBy: userId,
      },
      session,
    });

    const isStaff = userRole === 'care_agent' || userRole === 'admin';
    const sanitized = sanitizeDispute(dispute, isStaff);
    const responsePayload = {
      dispute: sanitized,
      booking: updatedBooking.toJSON ? updatedBooking.toJSON() : updatedBooking,
    };

    if (idempotency?.key) {
      await saveIdempotencyRecord({
        userId,
        key: idempotency.key,
        requestHash: idempotency.requestHash,
        statusCode: 201,
        responseBody: responsePayload,
        session,
      });
    }

    // Socket notification
    emitToUser(borrowerIdStr, 'booking:updated', {
      bookingId: booking._id,
      status: 'disputed',
      disputeReason: reason,
    });
    emitToUser(lenderIdStr, 'booking:updated', {
      bookingId: booking._id,
      status: 'disputed',
      disputeReason: reason,
    });

    return responsePayload;
  });
}

/**
 * Adds evidence to an active dispute.
 */
export async function addEvidence({ disputeId, notes, photos = [], userId, userRole = 'user' }) {
  const dispute = await Dispute.findById(disputeId);
  if (!dispute) {
    throw new AppError(ERROR_CODES.DISPUTE_NOT_FOUND, 'Dispute not found', 404);
  }

  if (dispute.status !== 'opened' && dispute.status !== 'assigned') {
    throw new AppError(
      ERROR_CODES.DISPUTE_INVALID_STATE,
      `Cannot add evidence to a dispute in '${dispute.status}' state`,
      409,
    );
  }

  const booking = await Booking.findById(dispute.bookingId).lean();
  if (!booking) {
    throw new AppError(ERROR_CODES.BOOKING_NOT_FOUND, 'Associated booking not found', 404);
  }

  const borrowerIdStr = (booking.borrowerId?._id || booking.borrowerId).toString();
  const lenderIdStr = (booking.lenderId?._id || booking.lenderId).toString();
  const userIdStr = userId.toString();
  const isStaff = userRole === 'care_agent' || userRole === 'admin';

  if (userIdStr !== borrowerIdStr && userIdStr !== lenderIdStr && !isStaff) {
    throw new AppError(
      ERROR_CODES.FORBIDDEN,
      'Only dispute participants or staff may add evidence',
      403,
    );
  }

  const formattedPhotos = (photos || [])
    .slice(0, DISPUTES.MAX_EVIDENCE_PHOTOS_PER_ENTRY || 6)
    .map((p) => ({
      publicId: p.publicId || '',
      url: p.url,
    }));

  dispute.evidence.push({
    by: userId,
    notes,
    photos: formattedPhotos,
    createdAt: new Date(),
  });

  await dispute.save();

  // Notify opposing party
  const opposingUserId = userIdStr === borrowerIdStr ? lenderIdStr : borrowerIdStr;
  emitToUser(opposingUserId, 'dispute:evidence_added', {
    disputeId: dispute._id,
    bookingId: dispute.bookingId,
  });

  return sanitizeDispute(dispute, isStaff);
}

/**
 * Gets a dispute by dispute ID.
 */
export async function getDisputeById({ disputeId, userId, userRole = 'user' }) {
  const dispute = await Dispute.findById(disputeId);
  if (!dispute) {
    throw new AppError(ERROR_CODES.DISPUTE_NOT_FOUND, 'Dispute not found', 404);
  }

  const booking = await Booking.findById(dispute.bookingId).lean();
  if (!booking) {
    throw new AppError(ERROR_CODES.BOOKING_NOT_FOUND, 'Associated booking not found', 404);
  }

  const borrowerIdStr = (booking.borrowerId?._id || booking.borrowerId).toString();
  const lenderIdStr = (booking.lenderId?._id || booking.lenderId).toString();
  const userIdStr = userId.toString();
  const isStaff = userRole === 'care_agent' || userRole === 'admin';

  if (userIdStr !== borrowerIdStr && userIdStr !== lenderIdStr && !isStaff) {
    throw new AppError(ERROR_CODES.FORBIDDEN, 'You are not authorized to view this dispute', 403);
  }

  return sanitizeDispute(dispute, isStaff);
}

/**
 * Gets a dispute by booking ID.
 */
export async function getDisputeByBookingId({ bookingId, userId, userRole = 'user' }) {
  const booking = await Booking.findById(bookingId).lean();
  if (!booking) {
    throw new AppError(ERROR_CODES.BOOKING_NOT_FOUND, 'Booking not found', 404);
  }

  const dispute = await Dispute.findOne({ bookingId });
  if (!dispute) {
    throw new AppError(ERROR_CODES.DISPUTE_NOT_FOUND, 'Dispute not found for this booking', 404);
  }

  const borrowerIdStr = (booking.borrowerId?._id || booking.borrowerId).toString();
  const lenderIdStr = (booking.lenderId?._id || booking.lenderId).toString();
  const userIdStr = userId.toString();
  const isStaff = userRole === 'care_agent' || userRole === 'admin';

  if (userIdStr !== borrowerIdStr && userIdStr !== lenderIdStr && !isStaff) {
    throw new AppError(ERROR_CODES.FORBIDDEN, 'You are not authorized to view this dispute', 403);
  }

  return sanitizeDispute(dispute, isStaff);
}

/**
 * Submits an appeal on a decided dispute within APPEAL_WINDOW_DAYS.
 */
export async function appealDispute({ disputeId, reason, userId, now = new Date() }) {
  const dispute = await Dispute.findById(disputeId);
  if (!dispute) {
    throw new AppError(ERROR_CODES.DISPUTE_NOT_FOUND, 'Dispute not found', 404);
  }

  if (dispute.appeal?.appealedAt || dispute.appeal?.status || dispute.status === 'appealed') {
    throw new AppError(
      ERROR_CODES.APPEAL_ALREADY_SUBMITTED,
      'An appeal has already been submitted for this dispute',
      409,
    );
  }

  if (dispute.status !== 'decided') {
    throw new AppError(
      ERROR_CODES.DISPUTE_INVALID_STATE,
      `Cannot appeal a dispute in '${dispute.status}' state`,
      400,
    );
  }

  const booking = await Booking.findById(dispute.bookingId).lean();
  if (!booking) {
    throw new AppError(ERROR_CODES.BOOKING_NOT_FOUND, 'Associated booking not found', 404);
  }

  const borrowerIdStr = (booking.borrowerId?._id || booking.borrowerId).toString();
  const lenderIdStr = (booking.lenderId?._id || booking.lenderId).toString();
  const userIdStr = userId.toString();

  if (userIdStr !== borrowerIdStr && userIdStr !== lenderIdStr) {
    throw new AppError(
      ERROR_CODES.FORBIDDEN,
      'Only dispute participants may submit an appeal',
      403,
    );
  }

  // Appeal window check: 7 days
  const decidedAt = dispute.decision?.decidedAt || dispute.updatedAt;
  const windowMs = (DISPUTES.APPEAL_WINDOW_SECONDS || 7 * 86400) * 1000;
  if (now.getTime() - new Date(decidedAt).getTime() > windowMs) {
    throw new AppError(ERROR_CODES.APPEAL_WINDOW_CLOSED, 'The 7-day appeal window has closed', 400);
  }

  dispute.status = 'appealed';
  dispute.appeal = {
    appealedById: userId,
    appealedAt: now,
    reason,
    status: 'pending',
  };
  dispute.statusHistory.push({
    status: 'appealed',
    changedBy: userId,
    note: reason,
    changedAt: now,
  });

  await dispute.save();

  // Outbox domain event
  await emitDomainEvent({
    type: 'dispute.appealed',
    bookingId: booking._id,
    actorId: userId,
    eventKey: `dispute_appealed_${dispute._id}`,
    payload: {
      disputeId: dispute._id,
      appealedBy: userId,
      reason,
    },
  });

  // Notify other party
  const opposingUserId = userIdStr === borrowerIdStr ? lenderIdStr : borrowerIdStr;
  emitToUser(opposingUserId, 'dispute:appealed', {
    disputeId: dispute._id,
    bookingId: dispute.bookingId,
  });

  return sanitizeDispute(dispute, false);
}
