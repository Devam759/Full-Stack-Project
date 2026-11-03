import { Router } from 'express';
import { AppError, ERROR_CODES, BUSINESS_CONFIG } from '@borrowloop/shared';
import Community from '../../models/Community.js';
import { authenticate, requireRole } from '../../common/authMiddleware.js';
import { writeAuditLog } from '../../common/auditLogger.js';

export const adminCommunityRouter = Router();

// Restrict all routes to portal admin tokens
adminCommunityRouter.use(authenticate(BUSINESS_CONFIG.TOKEN_AUDIENCES.PORTAL));
adminCommunityRouter.use(requireRole('admin'));

adminCommunityRouter.get('/', async (req, res, next) => {
  try {
    const { status, type } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (type) filter.type = type;

    const communities = await Community.find(filter)
      .populate('ownerId', 'name email')
      .sort({ createdAt: -1 })
      .lean();

    res.status(200).json({ communities });
  } catch (err) {
    next(err);
  }
});

adminCommunityRouter.post('/:id/suspend', async (req, res, next) => {
  try {
    const community = await Community.findById(req.params.id);
    if (!community) {
      throw new AppError(ERROR_CODES.NOT_FOUND, 'Community not found', 404);
    }

    const previousStatus = community.status;
    community.status = 'suspended';
    await community.save();

    await writeAuditLog({
      actorId: req.user._id,
      actorRole: req.user.role,
      action: 'COMMUNITY_SUSPEND',
      targetType: 'community',
      targetId: community._id.toString(),
      before: { status: previousStatus },
      after: { status: 'suspended' },
      ip: req.ip,
    });

    res.status(200).json({ message: 'Community suspended successfully', community });
  } catch (err) {
    next(err);
  }
});

adminCommunityRouter.post('/:id/restore', async (req, res, next) => {
  try {
    const community = await Community.findById(req.params.id);
    if (!community) {
      throw new AppError(ERROR_CODES.NOT_FOUND, 'Community not found', 404);
    }

    const previousStatus = community.status;
    community.status = 'active';
    await community.save();

    await writeAuditLog({
      actorId: req.user._id,
      actorRole: req.user.role,
      action: 'COMMUNITY_RESTORE',
      targetType: 'community',
      targetId: community._id.toString(),
      before: { status: previousStatus },
      after: { status: 'active' },
      ip: req.ip,
    });

    res.status(200).json({ message: 'Community restored successfully', community });
  } catch (err) {
    next(err);
  }
});

export default adminCommunityRouter;
