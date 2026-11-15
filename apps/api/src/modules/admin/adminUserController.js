/**
 * @file apps/api/src/modules/admin/adminUserController.js
 * Controller for admin portal user moderation, banning, unbanning, and strike reversals.
 */

import mongoose from 'mongoose';
import { AppError, ERROR_CODES, BUSINESS_CONFIG } from '@borrowloop/shared';
import {
  User,
  Item,
  Booking,
  ItemDayLock,
  RefreshToken,
  LedgerEntry,
  TrustEvent,
  Notification,
  writeAuditLogTx,
  refundCancelledBooking,
  transitionBookingStatus,
  strikeService,
} from '@borrowloop/server-core';
import { disconnectUser } from '../../sockets/socketServer.js';

const { ADMIN } = BUSINESS_CONFIG;

/**
 * Masks email address ensuring zero raw email leakage (e.g. a***@g***.com).
 * @param {string} email
 * @returns {string}
 */
export function maskEmail(email) {
  if (!email || typeof email !== 'string') return '';
  const atIdx = email.indexOf('@');
  if (atIdx === -1) return '***';
  const local = email.slice(0, atIdx);
  const domain = email.slice(atIdx + 1);
  const dotIdx = domain.lastIndexOf('.');
  const domainName = dotIdx !== -1 ? domain.slice(0, dotIdx) : domain;
  const domainTld = dotIdx !== -1 ? domain.slice(dotIdx) : '';
  const maskedLocal = local.length > 0 ? `${local[0]}***` : '***';
  const maskedDomain = domainName.length > 0 ? `${domainName[0]}***` : '***';
  return `${maskedLocal}@${maskedDomain}${domainTld}`;
}

/**
 * Searches and lists users with cursor pagination, role/status filters, and masked emails.
 */
export async function getUsers(req, res, next) {
  try {
    const { q, role, status, limit = ADMIN.PAGE_LIMIT || 20, cursor } = req.query;

    const query = {};

    if (cursor && mongoose.Types.ObjectId.isValid(cursor)) {
      query._id = { $lt: new mongoose.Types.ObjectId(cursor) };
    }

    if (role && ['user', 'care_agent', 'admin'].includes(role)) {
      query.role = role;
    }

    if (status && ['active', 'frozen', 'banned'].includes(status)) {
      query.status = status;
    }

    if (q && typeof q === 'string' && q.trim().length > 0) {
      const trimmed = q.trim();
      if (trimmed.includes('@')) {
        query.email = trimmed.toLowerCase();
      } else {
        query.name = { $regex: trimmed, $options: 'i' };
      }
    }

    const pageSize = Math.min(Number(limit) || 20, ADMIN.MAX_PAGE_LIMIT || 50);

    const users = await User.find(query)
      .sort({ _id: -1 })
      .limit(pageSize + 1)
      .lean();

    const hasMore = users.length > pageSize;
    const items = hasMore ? users.slice(0, pageSize) : users;
    const nextCursor = hasMore ? items[items.length - 1]._id.toString() : null;

    // Aggregate active items count for each user in the page
    const userIds = items.map((u) => u._id);
    const itemCounts = await Item.aggregate([
      { $match: { ownerId: { $in: userIds }, status: 'active' } },
      { $group: { _id: '$ownerId', count: { $sum: 1 } } },
    ]);

    const itemCountsMap = new Map();
    for (const row of itemCounts) {
      itemCountsMap.set(row._id.toString(), row.count);
    }

    const formattedUsers = items.map((u) => ({
      _id: u._id,
      name: u.name,
      maskedEmail: maskEmail(u.email),
      role: u.role,
      status: u.status,
      strikes: u.strikes || 0,
      trustScore: u.trustScore || 0,
      trustTier: u.trustTier || 'bronze',
      activeItemsCount: itemCountsMap.get(u._id.toString()) || 0,
      createdAt: u.createdAt,
    }));

    return res.json({
      users: formattedUsers,
      nextCursor,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Retrieves full user profile for moderation.
 * Every read is audited with targetType: 'user'.
 */
export async function getUserById(req, res, next) {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new AppError(ERROR_CODES.NOT_FOUND, 'User not found', 404);
    }

    const user = await User.findById(id).lean();
    if (!user) {
      throw new AppError(ERROR_CODES.NOT_FOUND, 'User not found', 404);
    }

    // Every read is audited
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        await writeAuditLogTx(
          {
            actorId: req.user._id,
            actorRole: req.user.role,
            action: 'user_profile_viewed',
            targetType: 'user',
            targetId: user._id.toString(),
            before: null,
            after: { userId: user._id.toString() },
            ip: req.ip || 'unknown',
          },
          { session },
        );
      });
    } finally {
      await session.endSession();
    }

    // Parallel queries for moderation context
    const [trustEvents, bookingStats, itemStats] = await Promise.all([
      TrustEvent.find({ userId: user._id }).sort({ createdAt: -1 }).limit(20).lean(),
      Booking.aggregate([
        { $match: { $or: [{ borrowerId: user._id }, { lenderId: user._id }] } },
        {
          $group: {
            _id: {
              role: {
                $cond: [{ $eq: ['$borrowerId', user._id] }, 'borrower', 'lender'],
              },
              status: '$status',
            },
            count: { $sum: 1 },
          },
        },
      ]),
      Item.aggregate([
        { $match: { ownerId: user._id } },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
    ]);

    const bookingSummary = {
      asBorrower: {},
      asLender: {},
    };
    for (const b of bookingStats) {
      if (b._id.role === 'borrower') {
        bookingSummary.asBorrower[b._id.status] = b.count;
      } else {
        bookingSummary.asLender[b._id.status] = b.count;
      }
    }

    const itemsSummary = {};
    for (const it of itemStats) {
      itemsSummary[it._id] = it.count;
    }

    return res.json({
      user: {
        _id: user._id,
        name: user.name,
        maskedEmail: maskEmail(user.email),
        role: user.role,
        status: user.status,
        strikes: user.strikes || 0,
        trustScore: user.trustScore || 0,
        trustTier: user.trustTier || 'bronze',
        banUntil: user.banUntil || null,
        createdAt: user.createdAt,
      },
      trustEvents,
      bookingSummary,
      itemsSummary,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Bans a user permanently.
 * Rejects if user is staff (self, admin, or care agent).
 * Rejects with 409 USER_HAS_ACTIVE_BOOKINGS if user is in picked_up, returned, or disputed bookings.
 * In transaction:
 * - sets user.status = 'banned'
 * - cancels requested bookings
 * - cancels accepted bookings with full refund to borrower
 * - hides user's items with hiddenReason = 'owner_banned'
 * - revokes all refresh tokens
 * - writes audit row with writeAuditLogTx
 * Post-transaction:
 * - disconnects live sockets
 * - creates notification
 */
export async function banUser(req, res, next) {
  const session = await mongoose.startSession();
  try {
    const { id } = req.params;
    const { reason } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new AppError(ERROR_CODES.NOT_FOUND, 'User not found', 404);
    }

    const user = await User.findById(id);
    if (!user) {
      throw new AppError(ERROR_CODES.NOT_FOUND, 'User not found', 404);
    }

    // Protection: Admin cannot ban self, another admin, or care agent
    if (user._id.toString() === req.user._id.toString()) {
      throw new AppError(ERROR_CODES.CANNOT_MODIFY_STAFF, 'Cannot ban yourself', 403);
    }
    if (['admin', 'care_agent'].includes(user.role)) {
      throw new AppError(
        ERROR_CODES.CANNOT_MODIFY_STAFF,
        'Cannot ban staff members directly. Demote first.',
        403,
      );
    }

    // Active bookings invariant check
    const activeBookings = await Booking.find({
      $or: [{ borrowerId: user._id }, { lenderId: user._id }],
      status: { $in: ['picked_up', 'returned', 'disputed'] },
    }).select('_id status');

    if (activeBookings.length > 0) {
      throw new AppError(
        ERROR_CODES.USER_HAS_ACTIVE_BOOKINGS,
        'User cannot be banned because they are an active party in picked up, returned, or disputed bookings',
        409,
        { bookingIds: activeBookings.map((b) => b._id.toString()) },
      );
    }

    let cancelledRequestedCount = 0;
    let cancelledAcceptedCount = 0;
    let hiddenItemsCount = 0;

    await session.withTransaction(async () => {
      cancelledRequestedCount = 0;
      cancelledAcceptedCount = 0;
      hiddenItemsCount = 0;

      const previousStatus = user.status;
      await User.updateOne({ _id: user._id }, { $set: { status: 'banned' } }).session(session);

      // 1. Cancel requested bookings
      const requestedBookings = await Booking.find({
        $or: [{ borrowerId: user._id }, { lenderId: user._id }],
        status: 'requested',
      }).session(session);

      for (const b of requestedBookings) {
        await transitionBookingStatus({
          bookingId: b._id,
          fromStatus: 'requested',
          toStatus: 'cancelled',
          event: 'CANCEL_REQUEST',
          actorRole: 'admin',
          actorId: req.user._id,
          reason: 'user_banned',
          extraFields: {
            cancelledBy: req.user._id,
            cancelReason: 'User banned by admin',
          },
          session,
        });
        cancelledRequestedCount += 1;
      }

      // 2. Cancel accepted bookings with full refund to borrower
      const acceptedBookings = await Booking.find({
        $or: [{ borrowerId: user._id }, { lenderId: user._id }],
        status: 'accepted',
      }).session(session);

      for (const b of acceptedBookings) {
        await ItemDayLock.deleteMany({ bookingId: b._id }).session(session);

        const totalFrozenPaise = b.rentPaise + b.depositPaise;
        const frozenEntries = await LedgerEntry.find({
          userId: b.borrowerId,
          bookingId: b._id,
          account: 'frozen',
        }).session(session);
        const heldFrozenPaise = frozenEntries.reduce((sum, e) => sum + e.amountPaise, 0);

        if (heldFrozenPaise > 0) {
          const refundAmount = Math.min(totalFrozenPaise, heldFrozenPaise);
          await refundCancelledBooking({
            borrowerId: b.borrowerId,
            bookingId: b._id,
            totalFrozenPaise: refundAmount,
            opRef: 'default',
            throwOnAlreadyApplied: false,
            session,
          });
        }

        if (b.extensions && b.extensions.length > 0) {
          for (const ext of b.extensions) {
            if (ext.status === 'requested') {
              await refundCancelledBooking({
                borrowerId: b.borrowerId,
                bookingId: b._id,
                totalFrozenPaise: ext.extraRentPaise,
                opRef: `ext_release_${ext.id}`,
                throwOnAlreadyApplied: false,
                session,
              });
            }
          }
        }

        await transitionBookingStatus({
          bookingId: b._id,
          fromStatus: 'accepted',
          toStatus: 'cancelled',
          event: 'CANCEL_BOOKING',
          actorRole: 'admin',
          actorId: req.user._id,
          reason: 'user_banned',
          extraFields: {
            cancelledBy: req.user._id,
            cancelReason: 'User banned by admin',
          },
          session,
        });
        cancelledAcceptedCount += 1;
      }

      // 3. Hide user items with hiddenReason: 'owner_banned'
      const userItems = await Item.find({
        ownerId: user._id,
        status: { $ne: 'removed' },
      }).session(session);

      for (const it of userItems) {
        it.hiddenFromStatus = it.status;
        it.status = 'hidden';
        it.hiddenReason = 'owner_banned';
        await it.save({ session });
        hiddenItemsCount += 1;
      }

      // 4. Revoke all refresh tokens
      await RefreshToken.deleteMany({ userId: user._id }).session(session);

      // 5. Write audit log row
      await writeAuditLogTx(
        {
          actorId: req.user._id,
          actorRole: req.user.role,
          action: 'user_banned',
          targetType: 'user',
          targetId: user._id.toString(),
          before: { status: previousStatus },
          after: {
            status: 'banned',
            reason,
            cancelledRequestedCount,
            cancelledAcceptedCount,
            hiddenItemsCount,
          },
          ip: req.ip || 'unknown',
        },
        { session },
      );
    });

    // Post-transaction side effects
    disconnectUser(user._id.toString(), 'Account banned');
    await Notification.create({
      userId: user._id,
      type: 'user_banned',
      title: 'Account Banned',
      body: reason,
    });

    return res.json({
      message: 'User banned successfully',
      userId: user._id,
      status: 'banned',
      cancelledRequestedCount,
      cancelledAcceptedCount,
      hiddenItemsCount,
    });
  } catch (error) {
    next(error);
  } finally {
    await session.endSession();
  }
}

/**
 * Unbans a user.
 * In transaction:
 * - sets user.status = 'active'
 * - restores owner_banned items back to hiddenFromStatus
 * - preserves strikes (does NOT reset strikes)
 * - writes audit row with writeAuditLogTx
 */
export async function unbanUser(req, res, next) {
  const session = await mongoose.startSession();
  try {
    const { id } = req.params;
    const { reason } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new AppError(ERROR_CODES.NOT_FOUND, 'User not found', 404);
    }

    const user = await User.findById(id);
    if (!user) {
      throw new AppError(ERROR_CODES.NOT_FOUND, 'User not found', 404);
    }

    if (user.status !== 'banned') {
      throw new AppError(ERROR_CODES.BAD_REQUEST, 'User is not currently banned', 400);
    }

    let restoredItemsCount = 0;

    await session.withTransaction(async () => {
      await User.updateOne({ _id: user._id }, { $set: { status: 'active' } }).session(session);

      // Restore items hidden specifically due to owner ban
      const bannedItems = await Item.find({
        ownerId: user._id,
        hiddenReason: 'owner_banned',
      }).session(session);

      for (const it of bannedItems) {
        it.status = it.hiddenFromStatus || 'active';
        it.hiddenReason = null;
        it.hiddenFromStatus = null;
        await it.save({ session });
        restoredItemsCount += 1;
      }

      await writeAuditLogTx(
        {
          actorId: req.user._id,
          actorRole: req.user.role,
          action: 'user_unbanned',
          targetType: 'user',
          targetId: user._id.toString(),
          before: { status: 'banned' },
          after: {
            status: 'active',
            reason,
            restoredItemsCount,
          },
          ip: req.ip || 'unknown',
        },
        { session },
      );
    });

    await Notification.create({
      userId: user._id,
      type: 'user_unbanned',
      title: 'Account Restored',
      body: 'Your account has been unbanned.',
    });

    return res.json({
      message: 'User unbanned successfully',
      userId: user._id,
      status: 'active',
      restoredItemsCount,
    });
  } catch (error) {
    next(error);
  } finally {
    await session.endSession();
  }
}

/**
 * Reverses a strike on a user using deterministic eventKey and transactional audit logging.
 */
export async function reverseStrike(req, res, next) {
  const session = await mongoose.startSession();
  try {
    const { id } = req.params;
    const { reason } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new AppError(ERROR_CODES.NOT_FOUND, 'User not found', 404);
    }

    const user = await User.findById(id);
    if (!user) {
      throw new AppError(ERROR_CODES.NOT_FOUND, 'User not found', 404);
    }

    const previousStrikes = user.strikes || 0;
    if (previousStrikes <= 0) {
      throw new AppError(ERROR_CODES.BAD_REQUEST, 'User has 0 strikes; cannot reverse strike', 400);
    }

    const idempotencyKey = req.headers['idempotency-key'] || Date.now();
    const eventKey = `strike_rev_${idempotencyKey}_${user._id}`;

    let result;
    await session.withTransaction(async () => {
      result = await strikeService.reverseStrike({
        userId: user._id,
        reason,
        session,
        eventKey,
      });

      await writeAuditLogTx(
        {
          actorId: req.user._id,
          actorRole: req.user.role,
          action: 'strike_reversed',
          targetType: 'user',
          targetId: user._id.toString(),
          before: { strikes: previousStrikes },
          after: {
            strikes: result.strikes,
            reason,
            eventKey,
          },
          ip: req.ip || 'unknown',
        },
        { session },
      );
    });

    await Notification.create({
      userId: user._id,
      type: 'strike_reversed',
      title: 'Strike Reversed',
      body: reason,
    });

    return res.json({
      message: 'Strike reversed successfully',
      userId: user._id,
      strikes: result.strikes,
    });
  } catch (error) {
    next(error);
  } finally {
    await session.endSession();
  }
}

export default {
  maskEmail,
  getUsers,
  getUserById,
  banUser,
  unbanUser,
  reverseStrike,
};
