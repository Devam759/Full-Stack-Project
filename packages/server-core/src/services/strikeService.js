/**
 * @file packages/server-core/src/services/strikeService.js
 * Service managing user strikes, suspensions, and ban enforcement.
 * Follows strike ladder:
 * - Strike 1: Warning notification
 * - Strike 2: 7-day ban (banUntil set, status stays 'active')
 * - Strike 3: Permanent ban (status: 'banned')
 */

import { AppError, ERROR_CODES, BUSINESS_CONFIG } from '@borrowloop/shared';
import User from '../models/User.js';
import Notification from '../models/Notification.js';
import TrustEvent from '../models/TrustEvent.js';
import { recordTrustEvent } from './trustService.js';

/**
 * Asserts that a user is not currently banned or suspended.
 * Must be checked on booking create, booking accept, item create, and item relist.
 * Note: Suspended users can still log in, withdraw money, and return held items.
 */
export function assertNotSuspended(user) {
  if (!user) return;

  if (user.status === 'banned') {
    throw new AppError(ERROR_CODES.ACCOUNT_SUSPENDED, 'Account is permanently banned', 403);
  }

  if (user.banUntil && new Date(user.banUntil) > new Date()) {
    throw new AppError(
      ERROR_CODES.ACCOUNT_SUSPENDED,
      `Account suspended until ${new Date(user.banUntil).toISOString()}`,
      403,
      { banUntil: user.banUntil },
    );
  }
}

/**
 * Applies a strike to a user according to the strike progression ladder.
 * Accepts an explicit eventKey for idempotency (e.g. strike_${disputeId_or_reportId}_${userId})
 * and ignores duplicates.
 */
export async function applyStrike({
  userId,
  reason = 'Policy violation',
  meta = {},
  session = null,
  eventKey = null,
}) {
  const user = await User.findById(userId).session(session);
  if (!user) {
    throw new AppError(ERROR_CODES.USER_NOT_FOUND, 'User not found', 404);
  }

  const finalEventKey = eventKey || `strike_${user._id}_${(user.strikes || 0) + 1}_${Date.now()}`;
  if (eventKey) {
    const existing = await TrustEvent.findOne({ eventKey: finalEventKey }).session(session);
    if (existing) {
      return {
        strikes: user.strikes || 0,
        banUntil: user.banUntil,
        status: user.status,
      };
    }
  }

  const newStrikes = (user.strikes || 0) + 1;
  const now = new Date();
  let banUntil = user.banUntil;
  let status = user.status;

  if (newStrikes === 1) {
    // Strike 1: Warning notification
    await Notification.create(
      [
        {
          userId: user._id,
          type: 'strike_warning',
          title: 'Account Warning',
          body: `You received a strike: ${reason}. Repeated violations will lead to account suspension.`,
          metadata: { strike: 1, reason, meta },
        },
      ],
      { session },
    );
  } else if (newStrikes === 2) {
    // Strike 2: 7-day temporary suspension
    const banSeconds =
      BUSINESS_CONFIG.STRIKE_2_BAN_SECONDS || BUSINESS_CONFIG.STRIKE_2_BAN_DAYS * 24 * 60 * 60;
    banUntil = new Date(now.getTime() + banSeconds * 1000);

    await Notification.create(
      [
        {
          userId: user._id,
          type: 'suspension_started',
          title: 'Account Suspended',
          body: `Your account is suspended until ${banUntil.toISOString()} due to multiple violations: ${reason}.`,
          metadata: { strike: 2, reason, banUntil, meta },
        },
      ],
      { session },
    );
  } else {
    // Strike 3+: Permanent ban
    status = 'banned';
    banUntil = null;

    await Notification.create(
      [
        {
          userId: user._id,
          type: 'suspension_started',
          title: 'Account Banned',
          body: `Your account has been permanently banned: ${reason}.`,
          metadata: { strike: newStrikes, reason, permanent: true, meta },
        },
      ],
      { session },
    );
  }

  user.strikes = newStrikes;
  user.banUntil = banUntil;
  user.status = status;
  await user.save({ session });

  await recordTrustEvent({
    userId: user._id,
    type: 'strike',
    eventKey: finalEventKey,
    meta: { strikes: newStrikes, reason, ...meta },
    session,
  });

  return {
    strikes: newStrikes,
    banUntil,
    status,
  };
}

/**
 * Reverses a strike (used in dispute resolutions or admin corrections).
 * Only restores status to 'active' if the user was currently 'banned', preventing unfreezing frozen users.
 */
export async function reverseStrike({ userId, reason = 'Strike reversed', session = null }) {
  const user = await User.findById(userId).session(session);
  if (!user) {
    throw new AppError(ERROR_CODES.USER_NOT_FOUND, 'User not found', 404);
  }

  const previousStrikes = user.strikes || 0;
  const newStrikes = Math.max(0, previousStrikes - 1);
  const now = new Date();

  let status = user.status;
  let banUntil = user.banUntil;

  if (previousStrikes >= 3 && newStrikes < 3) {
    if (user.status === 'banned') {
      status = 'active';
    }
  }
  if (previousStrikes >= 2 && newStrikes < 2) {
    banUntil = null;
  }

  user.strikes = newStrikes;
  user.status = status;
  user.banUntil = banUntil;
  await user.save({ session });

  await recordTrustEvent({
    userId: user._id,
    type: 'strike_reversed',
    eventKey: `strike_reversed_${user._id}_${newStrikes}_${now.getTime()}`,
    meta: { previousStrikes, newStrikes, reason },
    session,
  });

  return {
    strikes: newStrikes,
    banUntil,
    status,
  };
}

export default {
  assertNotSuspended,
  applyStrike,
  reverseStrike,
};
