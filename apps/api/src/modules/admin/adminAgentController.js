/**
 * @file apps/api/src/modules/admin/adminAgentController.js
 * Controller for care agent promotion, demotion, and listing in the Admin Portal.
 */

import mongoose from 'mongoose';
import { AppError, ERROR_CODES } from '@borrowloop/shared';
import {
  User,
  Dispute,
  RefreshToken,
  Notification,
  writeAuditLogTx,
} from '@borrowloop/server-core';
import { createTotpEnrollmentLink } from '../portal/portalAuthService.js';
import { disconnectUser } from '../../sockets/socketServer.js';
import { maskEmail } from './adminUserController.js';

/**
 * Lists all staff members with role care_agent.
 */
export async function getAgents(req, res, next) {
  try {
    const agents = await User.find({ role: 'care_agent' })
      .select('+totpSecret')
      .sort({ createdAt: -1 })
      .lean();

    const formattedAgents = agents.map((a) => ({
      _id: a._id,
      name: a.name,
      maskedEmail: maskEmail(a.email),
      role: a.role,
      status: a.status,
      totpEnrolled: Boolean(a.totpSecret),
      createdAt: a.createdAt,
    }));

    return res.json({
      agents: formattedAgents,
      total: formattedAgents.length,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Promotes an active user with verified email to care_agent.
 * Enrolls TOTP and dispatches enrollment link via email (never exposed in API response).
 */
export async function promoteAgent(req, res, next) {
  const session = await mongoose.startSession();
  try {
    const { userId, reason } = req.body;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      throw new AppError(ERROR_CODES.NOT_FOUND, 'User not found', 404);
    }

    const user = await User.findById(userId);
    if (!user) {
      throw new AppError(ERROR_CODES.NOT_FOUND, 'User not found', 404);
    }

    if (user.status !== 'active') {
      throw new AppError(
        ERROR_CODES.BAD_REQUEST,
        `Cannot promote user with status '${user.status}' to care agent`,
        400,
      );
    }

    if (!user.emailVerified) {
      throw new AppError(
        ERROR_CODES.EMAIL_NOT_VERIFIED,
        'User must have a verified email address before being promoted to care agent',
        400,
      );
    }

    if (user.role === 'care_agent') {
      throw new AppError(ERROR_CODES.BAD_REQUEST, 'User is already a care agent', 400);
    }
    if (user.role === 'admin') {
      throw new AppError(ERROR_CODES.BAD_REQUEST, 'User is already an administrator', 400);
    }

    const previousRole = user.role;

    await session.withTransaction(async () => {
      await User.updateOne({ _id: user._id }, { $set: { role: 'care_agent' } }).session(session);

      await writeAuditLogTx(
        {
          actorId: req.user._id,
          actorRole: req.user.role,
          action: 'staff_invited',
          targetType: 'user',
          targetId: user._id.toString(),
          before: { role: previousRole },
          after: { role: 'care_agent', reason },
          ip: req.ip || 'unknown',
        },
        { session },
      );
    });

    // Generate TOTP enrollment token & URI securely
    // In production, this link is dispatched by email and never echoed back to the admin
    await createTotpEnrollmentLink(user._id);

    await Notification.create({
      userId: user._id,
      type: 'staff_invited',
      title: 'Care Agent Role Assigned',
      body:
        reason ||
        'You have been promoted to Care Agent. Check your email for TOTP setup instructions.',
    });

    return res.status(201).json({
      message:
        'User successfully promoted to care agent. TOTP enrollment instructions sent via email.',
      agent: {
        _id: user._id,
        name: user.name,
        maskedEmail: maskEmail(user.email),
        role: 'care_agent',
        status: user.status,
      },
    });
  } catch (error) {
    next(error);
  } finally {
    await session.endSession();
  }
}

/**
 * Demotes a care agent (or staff) back to regular user.
 * Cannot demote self or the last administrator.
 * In transaction:
 * - resets role to 'user'
 * - clears totpSecret and lastTotpStep
 * - revokes refresh tokens
 * - returns assigned open disputes back to 'opened'
 * - writes audit log row
 * Post-transaction:
 * - forcefully disconnects live sockets
 * - creates notification
 */
export async function demoteAgent(req, res, next) {
  const session = await mongoose.startSession();
  try {
    const { id } = req.params;
    const reason = req.body?.reason || 'Demoted by administrator';

    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new AppError(ERROR_CODES.NOT_FOUND, 'Staff member not found', 404);
    }

    const user = await User.findById(id).select('+totpSecret');
    if (!user) {
      throw new AppError(ERROR_CODES.NOT_FOUND, 'Staff member not found', 404);
    }

    if (user._id.toString() === req.user._id.toString()) {
      throw new AppError(ERROR_CODES.CANNOT_MODIFY_STAFF, 'Cannot demote yourself', 403);
    }

    // Protection for last admin
    if (user.role === 'admin') {
      const adminCount = await User.countDocuments({ role: 'admin' });
      if (adminCount <= 1) {
        throw new AppError(
          ERROR_CODES.LAST_ADMIN,
          'The last remaining administrator cannot be demoted',
          403,
        );
      }
    }

    const previousRole = user.role;

    await session.withTransaction(async () => {
      await User.updateOne(
        { _id: user._id },
        {
          $set: {
            role: 'user',
            totpSecret: null,
            lastTotpStep: 0,
          },
        },
      ).session(session);

      // Revoke all refresh tokens
      await RefreshToken.deleteMany({ userId: user._id }).session(session);

      // Return open disputes assigned to this agent back to 'opened'
      await Dispute.updateMany(
        { assignedAgentId: user._id, status: 'assigned' },
        {
          $set: {
            status: 'opened',
            assignedAgentId: null,
            assignedAt: null,
          },
        },
      ).session(session);

      await writeAuditLogTx(
        {
          actorId: req.user._id,
          actorRole: req.user.role,
          action: 'staff_removed',
          targetType: 'user',
          targetId: user._id.toString(),
          before: { role: previousRole },
          after: { role: 'user', reason },
          ip: req.ip || 'unknown',
        },
        { session },
      );
    });

    disconnectUser(user._id.toString(), 'Staff permissions removed');
    await Notification.create({
      userId: user._id,
      type: 'staff_removed',
      title: 'Staff Permissions Removed',
      body: reason,
    });

    return res.json({
      message: 'Care agent successfully demoted to user',
      userId: user._id,
      role: 'user',
    });
  } catch (error) {
    next(error);
  } finally {
    await session.endSession();
  }
}

export default {
  getAgents,
  promoteAgent,
  demoteAgent,
};
