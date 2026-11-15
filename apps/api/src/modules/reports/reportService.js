/**
 * @file apps/api/src/modules/reports/reportService.js
 * Business logic for user-submitted reports and care agent moderation actions.
 */

import {
  Report,
  Item,
  User,
  Booking,
  Message,
  Notification,
  TrustEvent,
  emitDomainEvent,
  applyStrike,
  recordTrustEvent,
  recompute,
  runInTransactionWithRetry,
} from '@borrowloop/server-core';
import { AppError, ERROR_CODES, BUSINESS_CONFIG } from '@borrowloop/shared';
import { emitToUser } from '../../sockets/socketServer.js';
import writeAuditLog from '../../common/auditLogger.js';

export function maskEmail(email) {
  if (!email || typeof email !== 'string') return '';
  const parts = email.split('@');
  if (parts.length !== 2) return '***';
  const [local, domain] = parts;
  const maskedLocal =
    local.length <= 2 ? `${local[0]}***` : `${local[0]}***${local[local.length - 1]}`;
  return `${maskedLocal}@${domain}`;
}

/**
 * Creates a report against an item, user, or message.
 * Enforces self-reporting restrictions, single pending report per user per target,
 * creates snapshot, and triggers auto-hide when reports threshold is met.
 */
export async function createReport({ targetType, targetId, reason, details = '', userId }) {
  let target;
  let targetOwnerId;
  let snapshot = {};

  if (targetType === 'item') {
    target = await Item.findById(targetId);
    if (!target) {
      throw new AppError(ERROR_CODES.ITEM_NOT_FOUND, 'Item not found', 404);
    }
    if (target.ownerId.toString() === userId.toString()) {
      throw new AppError(ERROR_CODES.REPORT_NOT_ALLOWED, 'You cannot report your own item', 400);
    }
    targetOwnerId = target.ownerId;
    snapshot = {
      title: target.title,
      description: target.description,
      rentPerDayPaise: target.rentPerDayPaise,
      depositPaise: target.depositPaise,
      category: target.category,
      condition: target.condition,
      photos: target.photos,
      status: target.status,
    };
  } else if (targetType === 'user') {
    target = await User.findById(targetId);
    if (!target) {
      throw new AppError(ERROR_CODES.USER_NOT_FOUND, 'User not found', 404);
    }
    if (target._id.toString() === userId.toString()) {
      throw new AppError(ERROR_CODES.REPORT_NOT_ALLOWED, 'You cannot report yourself', 400);
    }
    targetOwnerId = target._id;
    snapshot = {
      name: target.name,
      email: maskEmail(target.email),
      role: target.role,
      status: target.status,
      trustScore: target.trustScore,
      strikes: target.strikes || target.strikesCount || 0,
    };
  } else if (targetType === 'message') {
    target = await Message.findById(targetId);
    if (!target) {
      throw new AppError(ERROR_CODES.MESSAGE_NOT_FOUND, 'Message not found', 404);
    }
    if (target.senderId.toString() === userId.toString()) {
      throw new AppError(ERROR_CODES.REPORT_NOT_ALLOWED, 'You cannot report your own message', 400);
    }
    targetOwnerId = target.senderId;
    snapshot = {
      text: target.text,
      type: target.type,
      pin: target.pin,
      conversationId: target.conversationId,
      bookingId: target.bookingId,
    };
  } else {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, `Invalid targetType: ${targetType}`, 400);
  }

  // Single pending report guard per target per user
  const existingPending = await Report.findOne({
    reporterId: userId,
    targetType,
    targetId,
    status: 'pending',
  });
  if (existingPending) {
    throw new AppError(
      ERROR_CODES.REPORT_ALREADY_FILED,
      'You already have a pending report for this target',
      409,
    );
  }

  return runInTransactionWithRetry(async (session) => {
    const [report] = await Report.create(
      [
        {
          reporterId: userId,
          targetType,
          targetId,
          targetOwnerId,
          reason,
          details,
          snapshot,
          status: 'pending',
        },
      ],
      { session },
    );

    // Auto-hide rule for items
    if (targetType === 'item') {
      const pendingCount = await Report.countDocuments({
        targetType: 'item',
        targetId: target._id,
        status: 'pending',
      }).session(session);

      const threshold = BUSINESS_CONFIG.ITEM_REPORTS_HIDE_THRESHOLD || 3;
      if (pendingCount >= threshold) {
        const itemToHide = await Item.findById(target._id).session(session);
        if (
          itemToHide &&
          itemToHide.status !== 'hidden' &&
          itemToHide.status !== 'deleted' &&
          itemToHide.status !== 'removed'
        ) {
          itemToHide.hiddenFromStatus = itemToHide.status;
          itemToHide.status = 'hidden';
          itemToHide.hiddenReason = 'auto_reports';
          await itemToHide.save({ session });

          await emitDomainEvent({
            type: 'item.auto_hidden',
            actorId: null,
            eventKey: `item_auto_hidden_${itemToHide._id}_${Date.now()}`,
            payload: {
              itemId: itemToHide._id,
              ownerId: itemToHide.ownerId,
              reportsCount: pendingCount,
            },
            session,
          });

          await Notification.create(
            [
              {
                userId: itemToHide.ownerId,
                type: 'item_auto_hidden',
                title: 'Listing Hidden',
                body: `Your listing "${itemToHide.title}" was automatically hidden after receiving multiple user reports.`,
                link: `/items/${itemToHide._id}`,
                metadata: { itemId: itemToHide._id },
              },
            ],
            { session },
          );

          emitToUser(itemToHide.ownerId.toString(), 'item:auto_hidden', {
            itemId: itemToHide._id,
          });
        }
      }
    }

    return report;
  });
}

/**
 * Lists reports for staff with filtering and cursor pagination.
 */
export async function listReports({ status, targetType, cursor, limit = 20 }) {
  const query = {};
  if (status) query.status = status;
  if (targetType) query.targetType = targetType;

  if (cursor) {
    const cursorDoc = await Report.findById(cursor);
    if (cursorDoc) {
      query.createdAt = { $lt: cursorDoc.createdAt };
    }
  }

  const reports = await Report.find(query).sort({ createdAt: -1 }).limit(limit).lean();

  const nextCursor = reports.length === limit ? reports[reports.length - 1]._id.toString() : null;

  return { reports, nextCursor };
}

/**
 * Executes a care moderation action on a report.
 */
export async function takeCareReportAction({
  reportId,
  action,
  notes = '',
  staffUser,
  ip = 'unknown',
}) {
  const report = await Report.findById(reportId);
  if (!report) {
    throw new AppError(ERROR_CODES.REPORT_NOT_FOUND, 'Report not found', 404);
  }

  // Validate action applies to targetType
  if (action === 'hide_item' || action === 'remove_item' || action === 'restore_item') {
    if (report.targetType !== 'item') {
      throw new AppError(
        ERROR_CODES.REPORT_NOT_ALLOWED,
        `Action '${action}' can only be applied to item reports`,
        400,
      );
    }
  }

  if (action === 'warn_user' || action === 'strike_user') {
    if (report.targetType === 'item') {
      throw new AppError(
        ERROR_CODES.REPORT_NOT_ALLOWED,
        `Action '${action}' can only be applied to user or message reports`,
        400,
      );
    }
  }

  const now = new Date();

  if (action === 'dismiss') {
    report.status = 'reviewed';
    report.reviewedById = staffUser._id;
    report.reviewedAt = now;
    report.actionTaken = 'dismiss';
    report.notes = notes;
    await report.save();
  } else if (action === 'hide_item') {
    const item = await Item.findById(report.targetId);
    if (!item) {
      throw new AppError(ERROR_CODES.ITEM_NOT_FOUND, 'Reported item not found', 404);
    }
    if (item.status !== 'hidden') {
      item.hiddenFromStatus = item.status;
      item.status = 'hidden';
      item.hiddenReason = 'care_agent';
      await item.save();
    }
    report.status = 'reviewed';
    report.reviewedById = staffUser._id;
    report.reviewedAt = now;
    report.actionTaken = 'hide_item';
    report.notes = notes;
    await report.save();
  } else if (action === 'remove_item') {
    const item = await Item.findById(report.targetId);
    if (!item) {
      throw new AppError(ERROR_CODES.ITEM_NOT_FOUND, 'Reported item not found', 404);
    }
    item.status = 'removed';
    await item.save();

    report.status = 'reviewed';
    report.reviewedById = staffUser._id;
    report.reviewedAt = now;
    report.actionTaken = 'remove_item';
    report.notes = notes;
    await report.save();
  } else if (action === 'restore_item') {
    const item = await Item.findById(report.targetId);
    if (!item) {
      throw new AppError(ERROR_CODES.ITEM_NOT_FOUND, 'Reported item not found', 404);
    }
    item.status = item.hiddenFromStatus || 'active';
    item.hiddenFromStatus = null;
    item.hiddenReason = null;
    await item.save();

    report.status = 'reviewed';
    report.reviewedById = staffUser._id;
    report.reviewedAt = now;
    report.actionTaken = 'restore_item';
    report.notes = notes;
    await report.save();
  } else if (action === 'warn_user') {
    await Notification.create({
      userId: report.targetOwnerId,
      type: 'user_warning',
      title: 'Community Guidelines Warning',
      body: notes || 'You have received a formal warning regarding your recent activity.',
      metadata: { reportId: report._id },
    });

    report.status = 'reviewed';
    report.reviewedById = staffUser._id;
    report.reviewedAt = now;
    report.actionTaken = 'warn_user';
    report.notes = notes;
    await report.save();
  } else if (action === 'strike_user') {
    const targetOwnerIdStr = report.targetOwnerId.toString();
    await applyStrike({
      userId: report.targetOwnerId,
      reason: 'report_violation',
      meta: { reportId: report._id },
      eventKey: `strike_report_${report._id}_${targetOwnerIdStr}`,
    });

    await recordTrustEvent({
      userId: report.targetOwnerId,
      type: 'lost_dispute',
      meta: { reportId: report._id },
      eventKey: `trust_report_${report._id}_${targetOwnerIdStr}`,
    });
    await recompute(report.targetOwnerId);

    report.status = 'reviewed';
    report.reviewedById = staffUser._id;
    report.reviewedAt = now;
    report.actionTaken = 'strike_user';
    report.notes = notes;
    await report.save();
  }

  // Fail-safe audit log
  await writeAuditLog({
    actorId: staffUser._id,
    actorRole: staffUser.role,
    action: 'care.report.action',
    targetType: 'report',
    targetId: report._id,
    after: { actionTaken: action, notes },
    ip,
  });

  return report;
}

/**
 * Gets user lookup data for care agents.
 */
export async function getCareUserLookup({ userId, staffUser, ip = 'unknown' }) {
  const user = await User.findById(userId).lean();
  if (!user) {
    throw new AppError(ERROR_CODES.USER_NOT_FOUND, 'User not found', 404);
  }

  const [activeReportsCount, bookingsAsBorrowerCount, bookingsAsLenderCount, recentTrustEvents] =
    await Promise.all([
      Report.countDocuments({ targetOwnerId: user._id, status: 'pending' }),
      Booking.countDocuments({ borrowerId: user._id }),
      Booking.countDocuments({ lenderId: user._id }),
      TrustEvent.find({ userId: user._id }).sort({ createdAt: -1 }).limit(10).lean(),
    ]);

  await writeAuditLog({
    actorId: staffUser._id,
    actorRole: staffUser.role,
    action: 'care.user.view',
    targetType: 'user',
    targetId: user._id,
    ip,
  });

  return {
    _id: user._id,
    name: user.name,
    email: maskEmail(user.email),
    photoUrl: user.photoUrl,
    trustScore: user.trustScore,
    strikesCount: user.strikes || user.strikesCount || 0,
    status: user.status,
    role: user.role,
    createdAt: user.createdAt,
    activeReportsCount,
    bookingsAsBorrowerCount,
    bookingsAsLenderCount,
    recentTrustEvents,
  };
}
