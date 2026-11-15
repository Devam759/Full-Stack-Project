/**
 * @file apps/api/src/modules/disputes/careDisputeRoutes.js
 * Express router for staff/care agent dispute management endpoints.
 */

import { Router } from 'express';
import { BUSINESS_CONFIG } from '@borrowloop/shared';
import {
  listDisputesQuerySchema,
  assignDisputeSchema,
  disputeDecisionSchema,
} from '@borrowloop/shared';
import validate from '../../common/validate.js';
import { authenticate, requireRole } from '../../common/authMiddleware.js';
import { requireIdempotencyKey } from '../../common/idempotencyMiddleware.js';
import * as careDisputeController from './careDisputeController.js';

const { TOKEN_AUDIENCES } = BUSINESS_CONFIG;

export const careDisputeRouter = Router();

// Staff authentication and authorization for all care routes
careDisputeRouter.use(authenticate(TOKEN_AUDIENCES.PORTAL), requireRole('care_agent', 'admin'));

// GET /v1/care/disputes?status=&reason=&assignedToMe=&cursor=&limit=
careDisputeRouter.get(
  '/',
  validate({ query: listDisputesQuerySchema }),
  careDisputeController.listCareDisputes,
);

// GET /v1/care/disputes/:id
careDisputeRouter.get('/:id', careDisputeController.getCareDisputeCaseFile);

// POST /v1/care/disputes/:id/assign
careDisputeRouter.post(
  '/:id/assign',
  validate({ body: assignDisputeSchema }),
  careDisputeController.assignCareDispute,
);

// POST /v1/care/disputes/:id/decision
careDisputeRouter.post(
  '/:id/decision',
  requireIdempotencyKey(),
  validate({ body: disputeDecisionSchema }),
  careDisputeController.decideCareDispute,
);

export default careDisputeRouter;
