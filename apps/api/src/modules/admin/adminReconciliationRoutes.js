/**
 * @file apps/api/src/modules/admin/adminReconciliationRoutes.js
 * Express router for Admin Portal ledger reconciliation management.
 */

import { Router } from 'express';
import { BUSINESS_CONFIG, adminTriggerReconciliationSchema } from '@borrowloop/shared';
import validate from '../../common/validate.js';
import { authenticate, requireRole } from '../../common/authMiddleware.js';
import { requireIdempotencyKey } from '../../common/idempotencyMiddleware.js';
import * as adminReconciliationController from './adminReconciliationController.js';

const { TOKEN_AUDIENCES } = BUSINESS_CONFIG;

export const adminReconciliationRouter = Router();

// Staff authentication & strict Admin role requirement
adminReconciliationRouter.use(authenticate(TOKEN_AUDIENCES.PORTAL), requireRole('admin'));

// GET /v1/admin/ledger/reconciliation
adminReconciliationRouter.get('/', adminReconciliationController.getReconciliationRuns);

// POST /v1/admin/ledger/reconciliation/run
adminReconciliationRouter.post(
  '/run',
  requireIdempotencyKey(),
  validate({ body: adminTriggerReconciliationSchema }),
  adminReconciliationController.triggerReconciliationRun,
);

export default adminReconciliationRouter;
