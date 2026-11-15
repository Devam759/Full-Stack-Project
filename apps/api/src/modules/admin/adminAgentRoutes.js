/**
 * @file apps/api/src/modules/admin/adminAgentRoutes.js
 * Express router for admin portal care agent management (listing, promotion, demotion).
 */

import { Router } from 'express';
import {
  BUSINESS_CONFIG,
  adminPromoteAgentSchema,
  adminDemoteAgentSchema,
} from '@borrowloop/shared';
import validate from '../../common/validate.js';
import { authenticate, requireRole } from '../../common/authMiddleware.js';
import { requireIdempotencyKey } from '../../common/idempotencyMiddleware.js';
import * as adminAgentController from './adminAgentController.js';

const { TOKEN_AUDIENCES } = BUSINESS_CONFIG;

export const adminAgentRouter = Router();

// Staff authentication & strict Admin role requirement (Care agents get 403)
adminAgentRouter.use(authenticate(TOKEN_AUDIENCES.PORTAL), requireRole('admin'));

// GET /v1/admin/agents
adminAgentRouter.get('/', adminAgentController.getAgents);

// POST /v1/admin/agents
adminAgentRouter.post(
  '/',
  requireIdempotencyKey(),
  validate({ body: adminPromoteAgentSchema }),
  adminAgentController.promoteAgent,
);

// DELETE /v1/admin/agents/:id
adminAgentRouter.delete(
  '/:id',
  requireIdempotencyKey(),
  validate({ body: adminDemoteAgentSchema }),
  adminAgentController.demoteAgent,
);

export default adminAgentRouter;
