/**
 * @file apps/api/src/modules/admin/adminAppealController.js
 * Controller for dispute appeals queue, settlement preview, and transactional appeal decisions.
 */

import mongoose from 'mongoose';
import {
  AppError,
  ERROR_CODES,
  BUSINESS_CONFIG,
  computeDisputeSettlement,
} from '@borrowloop/shared';
import {
  Dispute,
  Booking,
  Wallet,
  Notification,
  writeAuditLogTx,
  settleAppealDecision,
} from '@borrowloop/server-core';

const { ADMIN } = BUSINESS_CONFIG;

/**
 * Lists dispute appeals with cursor pagination and status filtering (defaults to 'pending').
 */
export async function getAppeals(req, res, next) {
  try {
    const { status = 'pending', limit = ADMIN.PAGE_LIMIT || 20, cursor } = req.query;

    const query = {};

    if (cursor && mongoose.Types.ObjectId.isValid(cursor)) {
      query._id = { $lt: new mongoose.Types.ObjectId(cursor) };
    }

    if (status && status !== 'all') {
      query['appeal.status'] = status;
    } else if (status === 'all') {
      query['appeal.status'] = { $in: ['pending', 'upheld', 'overturned'] };
    }

    const pageSize = Math.min(Number(limit) || 20, ADMIN.MAX_PAGE_LIMIT || 50);

    const disputes = await Dispute.find(query)
      .populate({
        path: 'bookingId',
        select: '_id itemId rentPaise depositPaise startDate endDate borrowerId lenderId',
        populate: { path: 'itemId', select: 'title category' },
      })
      .populate('openedById', 'name')
      .populate('againstUserId', 'name')
      .populate('appeal.appealedById', 'name')
      .sort({ _id: -1 })
      .limit(pageSize + 1)
      .lean();

    const hasMore = disputes.length > pageSize;
    const items = hasMore ? disputes.slice(0, pageSize) : disputes;
    const nextCursor = hasMore ? items[items.length - 1]._id.toString() : null;

    const formattedAppeals = items.map((d) => {
      const isBorrowerRequester =
        d.appeal?.appealedById?._id &&
        d.bookingId?.borrowerId &&
        d.appeal.appealedById._id.toString() === d.bookingId.borrowerId.toString();

      return {
        _id: d._id,
        bookingId: d.bookingId?._id,
        itemTitle: d.bookingId?.itemId?.title || 'Unknown Item',
        disputeReason: d.disputeReason,
        status: d.status,
        originalCareDecision: d.decision
          ? {
              decidedById: d.decision.decidedById,
              decidedAt: d.decision.decidedAt,
              depositToLenderPaise: d.decision.depositToLenderPaise,
              depositToBorrowerPaise: d.decision.depositToBorrowerPaise,
              appliedLateChargePaise: d.decision.appliedLateChargePaise || 0,
              rentOutcome: d.decision.rentOutcome,
              faultUserId: d.decision.faultUserId,
              penaltyKind: d.decision.penaltyKind,
              note: d.decision.note,
            }
          : null,
        appeal: {
          status: d.appeal?.status || 'pending',
          reason: d.appeal?.reason,
          appealedById: d.appeal?.appealedById?._id,
          requesterName: d.appeal?.appealedById?.name,
          requesterRole: isBorrowerRequester ? 'borrower' : 'lender',
          createdAt: d.appeal?.createdAt,
          unrecoveredPaise: d.appeal?.unrecoveredPaise || 0,
          revisedDecision: d.appeal?.revisedDecision || null,
        },
        createdAt: d.createdAt,
      };
    });

    return res.json({
      appeals: formattedAppeals,
      nextCursor,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Previews appeal overturn deltas and potential wallet shortfalls before confirming.
 * Pure mathematical calculation with zero ledger writes.
 */
export async function previewAppealDecision(req, res, next) {
  try {
    const { id } = req.params;
    const { revisedDecision } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new AppError(ERROR_CODES.NOT_FOUND, 'Dispute not found', 404);
    }

    const dispute = await Dispute.findById(id).lean();
    if (!dispute) {
      throw new AppError(ERROR_CODES.NOT_FOUND, 'Dispute not found', 404);
    }

    if (dispute.status !== 'appealed' || dispute.appeal?.status !== 'pending') {
      throw new AppError(
        ERROR_CODES.APPEAL_NOT_PENDING,
        'Dispute does not have a pending appeal',
        400,
        { disputeId: id, status: dispute.status, appealStatus: dispute.appeal?.status },
      );
    }

    const booking = await Booking.findById(dispute.bookingId).lean();
    if (!booking) {
      throw new AppError(ERROR_CODES.BOOKING_NOT_FOUND, 'Booking not found', 404);
    }

    // Conflict of interest check
    if (
      dispute.decision?.decidedById &&
      dispute.decision.decidedById.toString() === req.user._id.toString()
    ) {
      throw new AppError(
        ERROR_CODES.CONFLICT_OF_INTEREST,
        'Admin who made the original care decision cannot decide the appeal',
        403,
      );
    }
    if (
      booking.borrowerId.toString() === req.user._id.toString() ||
      booking.lenderId.toString() === req.user._id.toString()
    ) {
      throw new AppError(
        ERROR_CODES.CONFLICT_OF_INTEREST,
        'Admin who is a booking participant cannot decide the appeal',
        403,
      );
    }

    // Deposit split validation
    const appliedLateChargePaise = dispute.decision?.appliedLateChargePaise || 0;
    const remainingDepositPaise = booking.depositPaise - appliedLateChargePaise;
    if (
      revisedDecision.depositToLenderPaise + revisedDecision.depositToBorrowerPaise !==
      remainingDepositPaise
    ) {
      throw new AppError(
        ERROR_CODES.DISPUTE_DECISION_INVALID,
        `Deposit split (${revisedDecision.depositToLenderPaise} + ${revisedDecision.depositToBorrowerPaise} = ${revisedDecision.depositToLenderPaise + revisedDecision.depositToBorrowerPaise} paise) must equal remaining deposit (${remainingDepositPaise} paise)`,
        400,
      );
    }

    // No-show full refund invariance
    if (dispute.disputeReason === 'no_show') {
      const isNoShowRefund =
        revisedDecision.rentOutcome === 'refund_borrower' &&
        revisedDecision.depositToLenderPaise === 0 &&
        revisedDecision.depositToBorrowerPaise === remainingDepositPaise;
      if (!isNoShowRefund) {
        throw new AppError(
          ERROR_CODES.DISPUTE_DECISION_INVALID,
          'No-show dispute requires full refund of rent and deposit to borrower',
          400,
        );
      }
    }

    // Compute original and revised distributions
    const original = computeDisputeSettlement({
      rentPaise: booking.rentPaise,
      depositPaise: booking.depositPaise,
      appliedLateChargePaise,
      rentOutcome: dispute.decision?.rentOutcome || 'lender',
      depositToLenderPaise: dispute.decision?.depositToLenderPaise || 0,
      depositToBorrowerPaise: dispute.decision?.depositToBorrowerPaise || 0,
      commissionBps: booking.commissionBps,
    });

    const revised = computeDisputeSettlement({
      rentPaise: booking.rentPaise,
      depositPaise: booking.depositPaise,
      appliedLateChargePaise,
      rentOutcome: revisedDecision.rentOutcome,
      depositToLenderPaise: revisedDecision.depositToLenderPaise,
      depositToBorrowerPaise: revisedDecision.depositToBorrowerPaise,
      commissionBps: booking.commissionBps,
    });

    const deltaBorrower = revised.borrowerAvailablePaise - original.borrowerAvailablePaise;
    const deltaLender = revised.lenderAvailablePaise - original.lenderAvailablePaise;
    const deltaPlatform = revised.commissionPaise - original.commissionPaise;

    // Check available balances for debit recovery
    const [borrowerWallet, lenderWallet] = await Promise.all([
      Wallet.findOne({ userId: booking.borrowerId }).lean(),
      Wallet.findOne({ userId: booking.lenderId }).lean(),
    ]);

    const borrowerAvailable = borrowerWallet?.availablePaise || 0;
    const lenderAvailable = lenderWallet?.availablePaise || 0;

    let actualDebitBorrower = 0;
    let unrecoveredBorrower = 0;
    if (deltaBorrower < 0) {
      const reqDebit = -deltaBorrower;
      actualDebitBorrower = Math.min(reqDebit, borrowerAvailable);
      unrecoveredBorrower = reqDebit - actualDebitBorrower;
    }

    let actualDebitLender = 0;
    let unrecoveredLender = 0;
    if (deltaLender < 0) {
      const reqDebit = -deltaLender;
      actualDebitLender = Math.min(reqDebit, lenderAvailable);
      unrecoveredLender = reqDebit - actualDebitLender;
    }

    const totalUnrecoveredPaise = unrecoveredBorrower + unrecoveredLender;

    const gainBorrower = deltaBorrower > 0 ? deltaBorrower : 0;
    const gainLender = deltaLender > 0 ? deltaLender : 0;
    const shortfallParty = gainBorrower >= gainLender ? 'borrower' : 'lender';

    let effectiveDeltaBorrower = deltaBorrower;
    let effectiveDeltaLender = deltaLender;

    if (totalUnrecoveredPaise > 0) {
      if (shortfallParty === 'borrower') {
        effectiveDeltaBorrower = Math.max(0, deltaBorrower - totalUnrecoveredPaise);
        effectiveDeltaLender = -actualDebitLender;
      } else {
        effectiveDeltaLender = Math.max(0, deltaLender - totalUnrecoveredPaise);
        effectiveDeltaBorrower = -actualDebitBorrower;
      }
    }

    return res.json({
      originalSettlement: original,
      revisedSettlement: revised,
      deltas: {
        borrower: deltaBorrower,
        lender: deltaLender,
        platform: deltaPlatform,
      },
      effectiveDeltas: {
        borrower: effectiveDeltaBorrower,
        lender: effectiveDeltaLender,
        platform: deltaPlatform,
      },
      shortfall: {
        amountPaise: totalUnrecoveredPaise,
        party: shortfallParty,
        acknowledgeRequired: totalUnrecoveredPaise > 0,
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Decides a dispute appeal (upheld or overturned).
 * If upheld: care decision stands, no money moves, dispute closed.
 * If overturned: executes settleAppealDecision in ledgerService inside transaction,
 * reverses money deltas, corrects penalties/strikes, and writes audit log row.
 */
export async function decideAppeal(req, res, next) {
  try {
    const { id } = req.params;
    const { decision, note, revisedDecision, acknowledgeShortfall } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new AppError(ERROR_CODES.NOT_FOUND, 'Dispute not found', 404);
    }

    if (decision === 'upheld') {
      const session = await mongoose.startSession();
      try {
        let dispute;
        let booking;
        await session.withTransaction(async () => {
          dispute = await Dispute.findById(id).session(session);
          if (!dispute) {
            throw new AppError(ERROR_CODES.NOT_FOUND, 'Dispute not found', 404);
          }

          if (dispute.status !== 'appealed' || dispute.appeal?.status !== 'pending') {
            throw new AppError(
              ERROR_CODES.APPEAL_NOT_PENDING,
              'Dispute does not have a pending appeal',
              400,
            );
          }

          booking = await Booking.findById(dispute.bookingId).session(session);
          if (!booking) {
            throw new AppError(ERROR_CODES.BOOKING_NOT_FOUND, 'Booking not found', 404);
          }

          // Conflict of interest check
          if (
            dispute.decision?.decidedById &&
            dispute.decision.decidedById.toString() === req.user._id.toString()
          ) {
            throw new AppError(
              ERROR_CODES.CONFLICT_OF_INTEREST,
              'Admin who made the original care decision cannot decide the appeal',
              403,
            );
          }
          if (
            booking.borrowerId.toString() === req.user._id.toString() ||
            booking.lenderId.toString() === req.user._id.toString()
          ) {
            throw new AppError(
              ERROR_CODES.CONFLICT_OF_INTEREST,
              'Admin who is a booking participant cannot decide the appeal',
              403,
            );
          }

          dispute.status = 'closed';
          dispute.appeal.status = 'upheld';
          dispute.appeal.decidedById = req.user._id;
          dispute.appeal.decidedAt = new Date();
          dispute.appeal.note = note;
          await dispute.save({ session });

          await writeAuditLogTx(
            {
              actorId: req.user._id,
              actorRole: req.user.role,
              action: 'appeal_decided',
              targetType: 'dispute',
              targetId: dispute._id.toString(),
              before: { appealStatus: 'pending' },
              after: { appealStatus: 'upheld', note },
              ip: req.ip || 'unknown',
            },
            { session },
          );
        });

        if (dispute.appeal?.appealedById) {
          await Notification.create({
            userId: dispute.appeal.appealedById,
            type: 'appeal_decided',
            title: 'Dispute Appeal Upheld',
            body: `Your appeal has been decided: Care decision stands. Note: ${note}`,
          });
        }

        return res.json({
          message: 'Appeal decided: Care decision upheld. No money moved.',
          appealStatus: 'upheld',
          disputeId: dispute._id,
        });
      } finally {
        await session.endSession();
      }
    }

    if (decision === 'overturned') {
      const session = await mongoose.startSession();
      try {
        let result;
        let booking;
        await session.withTransaction(async () => {
          result = await settleAppealDecision({
            disputeId: id,
            decidedById: req.user._id,
            note,
            revisedDecision,
            acknowledgeShortfall: Boolean(acknowledgeShortfall),
            idempotency: { key: req.headers['idempotency-key'] },
            meta: { decidedByRole: 'admin', ip: req.ip },
            throwOnAlreadyApplied: true,
            session,
          });

          booking = await Booking.findById(result.dispute.bookingId).session(session);

          await writeAuditLogTx(
            {
              actorId: req.user._id,
              actorRole: req.user.role,
              action: 'appeal_decided',
              targetType: 'dispute',
              targetId: id,
              before: { appealStatus: 'pending' },
              after: {
                appealStatus: 'overturned',
                deltas: result.deltas,
                unrecoveredPaise: result.unrecoveredPaise,
                note,
              },
              ip: req.ip || 'unknown',
            },
            { session },
          );
        });

        // Post-transaction notifications
        if (booking) {
          await Promise.all([
            Notification.create({
              userId: booking.borrowerId,
              type: 'appeal_decided',
              title: 'Dispute Appeal Overturned',
              body: `Dispute appeal has been decided. Revised settlement deltas applied: ${note}`,
            }),
            Notification.create({
              userId: booking.lenderId,
              type: 'appeal_decided',
              title: 'Dispute Appeal Overturned',
              body: `Dispute appeal has been decided. Revised settlement deltas applied: ${note}`,
            }),
          ]);
        }

        return res.json({
          message: 'Appeal overturned successfully. Revised settlement applied to ledger.',
          appealStatus: 'overturned',
          disputeId: id,
          deltas: result.deltas,
          unrecoveredPaise: result.unrecoveredPaise,
        });
      } finally {
        await session.endSession();
      }
    }
  } catch (error) {
    next(error);
  }
}

export default {
  getAppeals,
  previewAppealDecision,
  decideAppeal,
};
