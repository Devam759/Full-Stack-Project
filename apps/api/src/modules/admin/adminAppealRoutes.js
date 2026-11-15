/**
 * @file apps/api/src/modules/admin/adminAppealRoutes.js
 * Express router for admin portal dispute appeal queue, preview, and decision management.
 */

import { Router } from 'express';
import {
  BUSINESS_CONFIG,
  adminAppealPreviewSchema,
  adminAppealDecisionSchema,
} from '@borrowloop/shared';
import validate from '../../common/validate.js';
import { authenticate, requireRole } from '../../common/authMiddleware.js';
import { requireIdempotencyKey } from '../../common/idempotencyMiddleware.js';
import * as adminAppealController from './adminAppealController.js';

const { TOKEN_AUDIENCES } = BUSINESS_CONFIG;

export const adminAppealRouter = Router();

// Staff authentication & strict Admin role requirement (Care agents get 403)
adminAppealRouter.use(authenticate(TOKEN_AUDIENCES.PORTAL), requireRole('admin'));

// GET /v1/admin/appeals
adminAppealRouter.get('/', adminAppealController.getAppeals);

// POST /v1/admin/appeals/:id/preview
adminAppealRouter.post(
  '/:id/preview',
  validate({ body: adminAppealPreviewSchema }),
  adminAppealController.previewAppealDecision,
);

// POST /v1/admin/appeals/:id/decide
adminAppealRouter.post(
  '/:id/decide',
  requireIdempotencyKey(),
  validate({ body: adminAppealDecisionSchema }),
  adminAppealController.decideAppeal,
);

export default adminAppealRouter;
