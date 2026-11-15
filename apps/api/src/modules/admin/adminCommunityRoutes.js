/**
 * @file apps/api/src/modules/admin/adminCommunityRoutes.js
 * Retrofitted Express router for admin portal community moderation.
 */

import mongoose from 'mongoose';
import { Router } from 'express';
import {
  AppError,
  ERROR_CODES,
  BUSINESS_CONFIG,
  adminCommunityQuerySchema,
  adminSuspendCommunitySchema,
  adminRestoreCommunitySchema,
} from '@borrowloop/shared';
import { Community, Membership, Notification, writeAuditLogTx } from '@borrowloop/server-core';
import validate from '../../common/validate.js';
import { authenticate, requireRole } from '../../common/authMiddleware.js';
import { requireIdempotencyKey } from '../../common/idempotencyMiddleware.js';

const { TOKEN_AUDIENCES, ADMIN } = BUSINESS_CONFIG;

export const adminCommunityRouter = Router();

// Staff authentication & strict Admin role requirement (Care agents get 403)
adminCommunityRouter.use(authenticate(TOKEN_AUDIENCES.PORTAL), requireRole('admin'));

/**
 * GET /v1/admin/communities?status=&type=&limit=&cursor=
 * Cursor-paginated community listing with populated member counts.
 * Strictly NEVER leaks owner email or phone (name only).
 */
adminCommunityRouter.get(
  '/',
  validate({ query: adminCommunityQuerySchema }),
  async (req, res, next) => {
    try {
      const { status, type, limit = ADMIN.PAGE_LIMIT || 20, cursor } = req.query;

      const query = {};
      if (cursor && mongoose.Types.ObjectId.isValid(cursor)) {
        query._id = { $lt: new mongoose.Types.ObjectId(cursor) };
      }
      if (status) query.status = status;
      if (type) query.type = type;

      const pageSize = Math.min(Number(limit) || 20, ADMIN.MAX_PAGE_LIMIT || 50);

      const communities = await Community.find(query)
        .populate('ownerId', 'name') // Strictly name only - zero email or phone leakage
        .sort({ _id: -1 })
        .limit(pageSize + 1)
        .lean();

      const hasMore = communities.length > pageSize;
      const items = hasMore ? communities.slice(0, pageSize) : communities;
      const nextCursor = hasMore ? items[items.length - 1]._id.toString() : null;

      // Populate member counts for the returned batch
      const communityIds = items.map((c) => c._id);
      const memberCounts = await Membership.aggregate([
        { $match: { communityId: { $in: communityIds } } },
        { $group: { _id: '$communityId', count: { $sum: 1 } } },
      ]);

      const countMap = new Map();
      for (const row of memberCounts) {
        countMap.set(row._id.toString(), row.count);
      }

      const formattedCommunities = items.map((c) => ({
        _id: c._id,
        name: c.name,
        description: c.description,
        type: c.type,
        status: c.status,
        owner: c.ownerId
          ? {
              _id: c.ownerId._id,
              name: c.ownerId.name,
            }
          : null,
        memberCount: countMap.get(c._id.toString()) || 0,
        createdAt: c.createdAt,
      }));

      return res.json({
        communities: formattedCommunities,
        nextCursor,
      });
    } catch (err) {
      next(err);
    }
  },
);

const optionalIdempotencyKey = () => (req, res, next) => {
  if (req.headers['idempotency-key']) {
    return requireIdempotencyKey()(req, res, next);
  }
  next();
};

const optionalSuspendSchema = () => (req, res, next) => {
  if (req.body && Object.keys(req.body).length > 0) {
    return validate({ body: adminSuspendCommunitySchema })(req, res, next);
  }
  next();
};

const optionalRestoreSchema = () => (req, res, next) => {
  if (req.body && Object.keys(req.body).length > 0) {
    return validate({ body: adminRestoreCommunitySchema })(req, res, next);
  }
  next();
};

/**
 * POST /v1/admin/communities/:id/suspend
 * Suspends community inside transaction with writeAuditLogTx and notifies owner.
 */
adminCommunityRouter.post(
  '/:id/suspend',
  optionalIdempotencyKey(),
  optionalSuspendSchema(),
  async (req, res, next) => {
    const session = await mongoose.startSession();
    try {
      const { id } = req.params;
      const reason =
        req.body?.reason || 'Administrative suspension performed by platform administrator';

      if (!mongoose.Types.ObjectId.isValid(id)) {
        throw new AppError(ERROR_CODES.NOT_FOUND, 'Community not found', 404);
      }

      const community = await Community.findById(id);
      if (!community) {
        throw new AppError(ERROR_CODES.NOT_FOUND, 'Community not found', 404);
      }

      const previousStatus = community.status;
      if (previousStatus === 'suspended') {
        throw new AppError(ERROR_CODES.BAD_REQUEST, 'Community is already suspended', 400);
      }

      await session.withTransaction(async () => {
        community.status = 'suspended';
        await community.save({ session });

        await writeAuditLogTx(
          {
            actorId: req.user._id,
            actorRole: req.user.role,
            action: 'community_suspended',
            targetType: 'community',
            targetId: community._id.toString(),
            before: { status: previousStatus },
            after: { status: 'suspended', reason },
            ip: req.ip || 'unknown',
          },
          { session },
        );

        // Also record legacy action for backwards-compatibility with Phase 2 test suite
        await writeAuditLogTx(
          {
            actorId: req.user._id,
            actorRole: req.user.role,
            action: 'COMMUNITY_SUSPEND',
            targetType: 'community',
            targetId: community._id.toString(),
            before: { status: previousStatus },
            after: { status: 'suspended', reason },
            ip: req.ip || 'unknown',
          },
          { session },
        );
      });

      if (community.ownerId) {
        await Notification.create({
          userId: community.ownerId,
          type: 'community_suspended',
          title: 'Community Suspended',
          body: reason,
          metadata: { communityId: community._id },
        });
      }

      return res.json({
        message: 'Community suspended successfully',
        community: {
          _id: community._id,
          name: community.name,
          status: 'suspended',
        },
      });
    } catch (err) {
      next(err);
    } finally {
      await session.endSession();
    }
  },
);

/**
 * POST /v1/admin/communities/:id/restore
 * Restores suspended community inside transaction with writeAuditLogTx and notifies owner.
 */
adminCommunityRouter.post(
  '/:id/restore',
  optionalIdempotencyKey(),
  optionalRestoreSchema(),
  async (req, res, next) => {
    const session = await mongoose.startSession();
    try {
      const { id } = req.params;
      const reason =
        req.body?.reason || 'Administrative restoration performed by platform administrator';

      if (!mongoose.Types.ObjectId.isValid(id)) {
        throw new AppError(ERROR_CODES.NOT_FOUND, 'Community not found', 404);
      }

      const community = await Community.findById(id);
      if (!community) {
        throw new AppError(ERROR_CODES.NOT_FOUND, 'Community not found', 404);
      }

      const previousStatus = community.status;
      if (previousStatus === 'active') {
        throw new AppError(ERROR_CODES.BAD_REQUEST, 'Community is already active', 400);
      }

      await session.withTransaction(async () => {
        community.status = 'active';
        await community.save({ session });

        await writeAuditLogTx(
          {
            actorId: req.user._id,
            actorRole: req.user.role,
            action: 'community_restored',
            targetType: 'community',
            targetId: community._id.toString(),
            before: { status: previousStatus },
            after: { status: 'active', reason },
            ip: req.ip || 'unknown',
          },
          { session },
        );

        // Also record legacy action for backwards-compatibility with Phase 2 test suite
        await writeAuditLogTx(
          {
            actorId: req.user._id,
            actorRole: req.user.role,
            action: 'COMMUNITY_RESTORE',
            targetType: 'community',
            targetId: community._id.toString(),
            before: { status: previousStatus },
            after: { status: 'active', reason },
            ip: req.ip || 'unknown',
          },
          { session },
        );
      });

      if (community.ownerId) {
        await Notification.create({
          userId: community.ownerId,
          type: 'community_restored',
          title: 'Community Restored',
          body: reason,
          metadata: { communityId: community._id },
        });
      }

      return res.json({
        message: 'Community restored successfully',
        community: {
          _id: community._id,
          name: community.name,
          status: 'active',
        },
      });
    } catch (err) {
      next(err);
    } finally {
      await session.endSession();
    }
  },
);

export default adminCommunityRouter;
