/**
 * @file apps/api/src/modules/disputes/careDisputeController.js
 * Controller endpoints for staff/care agent dispute management.
 */

import {
  Booking,
  Dispute,
  Item,
  User,
  Handover,
  Message,
  settleDisputeDecision,
} from '@borrowloop/server-core';
import { AppError, ERROR_CODES } from '@borrowloop/shared';
import writeAuditLog from '../../common/auditLogger.js';
import { sanitizeDispute } from './disputeService.js';

function sanitizeUserForStaff(user) {
  if (!user) return null;
  const u = user.toObject ? user.toObject() : user;
  return {
    _id: u._id,
    name: u.name,
    photoUrl: u.photoUrl,
    trustScore: u.trustScore,
    strikesCount: u.strikesCount,
    status: u.status,
    createdAt: u.createdAt,
  };
}

/**
 * Lists disputes for care agents with filtering and cursor pagination.
 * Query: status, reason, assignedToMe, cursor, limit.
 */
export async function listCareDisputes(req, res, next) {
  try {
    const { status, reason, assignedToMe, cursor, limit = 20 } = req.query;

    const query = {};
    if (status) query.status = status;
    if (reason) query.disputeReason = reason;
    if (assignedToMe === true || assignedToMe === 'true') {
      query.assignedAgentId = req.user._id;
    }

    if (cursor) {
      const cursorDoc = await Dispute.findById(cursor);
      if (cursorDoc) {
        query.createdAt = { $lt: cursorDoc.createdAt };
      }
    }

    const disputes = await Dispute.find(query).sort({ createdAt: -1 }).limit(limit).lean();

    const nextCursor =
      disputes.length === limit ? disputes[disputes.length - 1]._id.toString() : null;

    res.status(200).json({
      disputes: disputes.map((d) => sanitizeDispute(d, true)),
      nextCursor,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Gets a dispute case file for staff.
 * Validates conflict of interest and writes audit log.
 */
export async function getCareDisputeCaseFile(req, res, next) {
  try {
    const { id } = req.params;

    const dispute = await Dispute.findById(id);
    if (!dispute) {
      throw new AppError(ERROR_CODES.DISPUTE_NOT_FOUND, 'Dispute not found', 404);
    }

    const booking = await Booking.findById(dispute.bookingId).lean();
    if (!booking) {
      throw new AppError(ERROR_CODES.BOOKING_NOT_FOUND, 'Associated booking not found', 404);
    }

    // Conflict of interest check
    const borrowerIdStr = (booking.borrowerId?._id || booking.borrowerId).toString();
    const lenderIdStr = (booking.lenderId?._id || booking.lenderId).toString();
    const agentIdStr = req.user._id.toString();

    if (agentIdStr === borrowerIdStr || agentIdStr === lenderIdStr) {
      throw new AppError(
        ERROR_CODES.CONFLICT_OF_INTEREST,
        'Cannot review a dispute for a booking you participated in',
        403,
      );
    }

    // Fetch related documents in parallel
    const [item, borrower, lender, handovers, messages] = await Promise.all([
      Item.findById(booking.itemId).lean(),
      User.findById(borrowerIdStr).lean(),
      User.findById(lenderIdStr).lean(),
      Handover.find({ bookingId: booking._id }).lean(),
      Message.find({ bookingId: booking._id }).sort({ createdAt: 1 }).lean(),
    ]);

    // Audit log read of case file
    await writeAuditLog({
      actorId: req.user._id,
      actorRole: req.user.role,
      action: 'care.dispute.view',
      targetType: 'dispute',
      targetId: dispute._id,
      ip: req.ip || 'unknown',
    });

    const caseFileData = {
      dispute: sanitizeDispute(dispute, true),
      booking,
      item,
      borrower: sanitizeUserForStaff(borrower),
      lender: sanitizeUserForStaff(lender),
      handovers,
      messages,
    };

    res.status(200).json({
      ...caseFileData,
      caseFile: caseFileData,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Assigns or reassigns a dispute to an agent.
 */
export async function assignCareDispute(req, res, next) {
  try {
    const { id } = req.params;
    const { agentId } = req.body || {};

    const dispute = await Dispute.findById(id);
    if (!dispute) {
      throw new AppError(ERROR_CODES.DISPUTE_NOT_FOUND, 'Dispute not found', 404);
    }

    const booking = await Booking.findById(dispute.bookingId).lean();
    if (!booking) {
      throw new AppError(ERROR_CODES.BOOKING_NOT_FOUND, 'Associated booking not found', 404);
    }

    // Conflict of interest check
    const borrowerIdStr = (booking.borrowerId?._id || booking.borrowerId).toString();
    const lenderIdStr = (booking.lenderId?._id || booking.lenderId).toString();
    const callerIdStr = req.user._id.toString();

    if (callerIdStr === borrowerIdStr || callerIdStr === lenderIdStr) {
      throw new AppError(
        ERROR_CODES.CONFLICT_OF_INTEREST,
        'Cannot assign a dispute for a booking you participated in',
        403,
      );
    }

    // Assignment role check
    let targetAgentId;
    if (req.user.role === 'admin') {
      targetAgentId = agentId || req.user._id;
    } else {
      // Care agents can only self-assign
      if (agentId && agentId.toString() !== callerIdStr) {
        throw new AppError(
          ERROR_CODES.FORBIDDEN,
          'Care agents can only assign disputes to themselves',
          403,
        );
      }
      targetAgentId = req.user._id;
    }

    // If already assigned to someone else, only admin can reassign
    if (
      dispute.assignedAgentId &&
      dispute.assignedAgentId.toString() !== targetAgentId.toString() &&
      req.user.role !== 'admin'
    ) {
      throw new AppError(
        ERROR_CODES.DISPUTE_ALREADY_ASSIGNED,
        'Dispute is already assigned to another agent',
        409,
      );
    }

    dispute.assignedAgentId = targetAgentId;
    dispute.assignedAt = new Date();
    if (dispute.status === 'opened') {
      dispute.status = 'assigned';
    }
    dispute.statusHistory.push({
      status: dispute.status,
      changedBy: req.user._id,
      note: `Assigned to agent ${targetAgentId}`,
      changedAt: new Date(),
    });

    await dispute.save();

    await writeAuditLog({
      actorId: req.user._id,
      actorRole: req.user.role,
      action: 'care.dispute.assign',
      targetType: 'dispute',
      targetId: dispute._id,
      after: { assignedAgentId: targetAgentId },
      ip: req.ip || 'unknown',
    });

    res.status(200).json({ dispute: sanitizeDispute(dispute, true) });
  } catch (err) {
    next(err);
  }
}

/**
 * Decides a dispute and triggers double-entry ledger settlement.
 */
export async function decideCareDispute(req, res, next) {
  try {
    const { id } = req.params;
    const body = req.body;

    const dispute = await Dispute.findById(id);
    if (!dispute) {
      throw new AppError(ERROR_CODES.DISPUTE_NOT_FOUND, 'Dispute not found', 404);
    }

    const booking = await Booking.findById(dispute.bookingId).lean();
    if (!booking) {
      throw new AppError(ERROR_CODES.BOOKING_NOT_FOUND, 'Associated booking not found', 404);
    }

    // Conflict of interest check
    const borrowerIdStr = (booking.borrowerId?._id || booking.borrowerId).toString();
    const lenderIdStr = (booking.lenderId?._id || booking.lenderId).toString();
    const callerIdStr = req.user._id.toString();

    if (callerIdStr === borrowerIdStr || callerIdStr === lenderIdStr) {
      throw new AppError(
        ERROR_CODES.CONFLICT_OF_INTEREST,
        'Cannot decide a dispute for a booking you participated in',
        403,
      );
    }

    // Only assigned agent or admin can decide
    if (
      req.user.role !== 'admin' &&
      (!dispute.assignedAgentId || dispute.assignedAgentId.toString() !== callerIdStr)
    ) {
      throw new AppError(
        ERROR_CODES.DISPUTE_NOT_ASSIGNED_TO_YOU,
        'Only the assigned agent or an admin can decide this dispute',
        403,
      );
    }

    const result = await settleDisputeDecision({
      disputeId: dispute._id,
      decidedById: req.user._id,
      depositToLenderPaise: body.depositToLenderPaise,
      depositToBorrowerPaise: body.depositToBorrowerPaise,
      applyLateCharge: body.applyLateCharge,
      rentOutcome: body.rentOutcome,
      faultUserId: body.faultUserId,
      penaltyKind: body.penaltyKind,
      borrowerAccountAction: body.borrowerAccountAction,
      note: body.note,
      internalNote: body.internalNote,
      idempotency: req.idempotency,
    });

    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}
