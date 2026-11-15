/**
 * @file apps/api/src/modules/admin/adminUserRoutes.js
 * Express router for admin portal user moderation and strike management.
 */

import { Router } from 'express';
import {
  BUSINESS_CONFIG,
  adminUserQuerySchema,
  adminBanUserSchema,
  adminUnbanUserSchema,
  adminReverseStrikeSchema,
} from '@borrowloop/shared';
import validate from '../../common/validate.js';
import { authenticate, requireRole } from '../../common/authMiddleware.js';
import { requireIdempotencyKey } from '../../common/idempotencyMiddleware.js';
import * as adminUserController from './adminUserController.js';

const { TOKEN_AUDIENCES } = BUSINESS_CONFIG;

export const adminUserRouter = Router();

// Staff authentication & strict Admin role requirement (Care agents get 403)
adminUserRouter.use(authenticate(TOKEN_AUDIENCES.PORTAL), requireRole('admin'));

// GET /v1/admin/users
adminUserRouter.get('/', validate({ query: adminUserQuerySchema }), adminUserController.getUsers);

// GET /v1/admin/users/:id
adminUserRouter.get('/:id', adminUserController.getUserById);

// POST /v1/admin/users/:id/ban
adminUserRouter.post(
  '/:id/ban',
  requireIdempotencyKey(),
  validate({ body: adminBanUserSchema }),
  adminUserController.banUser,
);

// POST /v1/admin/users/:id/unban
adminUserRouter.post(
  '/:id/unban',
  requireIdempotencyKey(),
  validate({ body: adminUnbanUserSchema }),
  adminUserController.unbanUser,
);

// POST /v1/admin/users/:id/reverse-strike
adminUserRouter.post(
  '/:id/reverse-strike',
  requireIdempotencyKey(),
  validate({ body: adminReverseStrikeSchema }),
  adminUserController.reverseStrike,
);

export default adminUserRouter;
