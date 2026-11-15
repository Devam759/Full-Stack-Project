/**
 * @file apps/api/src/modules/admin/adminAdRoutes.js
 * Express router for administrative Google AdSense configuration.
 */

import { Router } from 'express';
import {
  BUSINESS_CONFIG,
  adminPatchAdPlacementSchema,
  adminPatchAdMasterSchema,
} from '@borrowloop/shared';
import validate from '../../common/validate.js';
import { authenticate, requireRole } from '../../common/authMiddleware.js';
import { requireIdempotencyKey } from '../../common/idempotencyMiddleware.js';
import { createRateLimiter } from '../../common/rateLimiter.js';
import { getRedisClient } from '../../redis.js';
import * as adminAdController from './adminAdController.js';

const { TOKEN_AUDIENCES } = BUSINESS_CONFIG;

export const adminAdRouter = Router();

// Staff authentication & strict Admin role requirement (Care agents get 403)
adminAdRouter.use(authenticate(TOKEN_AUDIENCES.PORTAL), requireRole('admin'));

// Rate limiter for admin ad mutations
const adminAdsMutationLimiter = createRateLimiter({
  redis: getRedisClient(),
  windowSeconds: 60,
  maxRequests: () => (process.env.NODE_ENV === 'test' ? 10_000 : 60),
  keyPrefix: 'rl:admin:ads',
});

// GET /v1/admin/ads
adminAdRouter.get('/', adminAdController.getAdSettings);

// PATCH /v1/admin/ads/:placement
adminAdRouter.patch(
  '/:placement',
  adminAdsMutationLimiter,
  requireIdempotencyKey(),
  validate({ body: adminPatchAdPlacementSchema }),
  adminAdController.patchAdPlacement,
);

// POST /v1/admin/ads/master
adminAdRouter.post(
  '/master',
  adminAdsMutationLimiter,
  requireIdempotencyKey(),
  validate({ body: adminPatchAdMasterSchema }),
  adminAdController.setMasterAds,
);

export default adminAdRouter;
