import { Router } from 'express';
import {
  createCommunitySchema,
  joinCommunitySchema,
  nearbyCommunityQuerySchema,
  searchCommunityQuerySchema,
  transferOwnerSchema,
} from '@borrowloop/shared';
import validate from '../../common/validate.js';
import { authenticate, requireVerifiedEmail } from '../../common/authMiddleware.js';
import createRateLimiter from '../../common/rateLimiter.js';
import { getRedisClient } from '../../redis.js';
import { verifyAccessToken } from '../../common/jwt.js';
import User from '../../models/User.js';
import * as communityController from './communityController.js';

export const communityRouter = Router();

const redis = getRedisClient();

// Middleware that optionally attaches req.user if a valid token is present
async function optionalAuth(req, _res, next) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    try {
      const token = authHeader.substring(7).trim();
      const decoded = verifyAccessToken(token, 'borrowloop:user');
      const user = await User.findById(decoded.sub);
      if (user && user.status === 'active') {
        req.user = user;
      }
    } catch {
      // Non-fatal for optional auth
    }
  }
  next();
}

// Rate limiters
const isTest = process.env.NODE_ENV === 'test';

const createCommunityLimiter = createRateLimiter({
  redis,
  windowSeconds: 3600,
  maxRequests: isTest ? 1000 : 5,
  keyPrefix: 'rl:comm:create',
});

const joinAttemptLimiter = createRateLimiter({
  redis,
  windowSeconds: 900, // 15 mins
  maxRequests: isTest ? 1000 : 15,
  keyPrefix: 'rl:comm:join',
});

// Discovery routes
communityRouter.get(
  '/nearby',
  optionalAuth,
  validate({ query: nearbyCommunityQuerySchema }),
  communityController.getNearby,
);

communityRouter.get(
  '/search',
  optionalAuth,
  validate({ query: searchCommunityQuerySchema }),
  communityController.search,
);

// Detail route
communityRouter.get('/:id', optionalAuth, communityController.getDetail);

// Member list route (members-only)
communityRouter.get('/:id/members', authenticate(), communityController.getMembers);

// Creation
communityRouter.post(
  '/',
  authenticate(),
  requireVerifiedEmail,
  createCommunityLimiter,
  validate({ body: createCommunitySchema }),
  communityController.create,
);

// Join & Leave
communityRouter.post(
  '/:id/join',
  authenticate(),
  joinAttemptLimiter,
  validate({ body: joinCommunitySchema }),
  communityController.join,
);

communityRouter.delete('/:id/join', authenticate(), communityController.leave);

// Requests management
communityRouter.delete('/:id/requests/me', authenticate(), communityController.cancelRequest);
communityRouter.get('/:id/requests', authenticate(), communityController.getPendingRequests);
communityRouter.post(
  '/:id/requests/:userId/approve',
  authenticate(),
  communityController.approveRequest,
);
communityRouter.post(
  '/:id/requests/:userId/reject',
  authenticate(),
  communityController.rejectRequest,
);

// Member management
communityRouter.delete('/:id/members/:userId', authenticate(), communityController.removeMember);

// Owner administration
communityRouter.post(
  '/:id/transfer-owner',
  authenticate(),
  validate({ body: transferOwnerSchema }),
  communityController.transferOwnership,
);

communityRouter.delete('/:id', authenticate(), communityController.deleteCommunity);

communityRouter.post('/:id/invite-code', authenticate(), communityController.regenerateInviteCode);

export default communityRouter;
