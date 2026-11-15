/**
 * @file apps/api/src/modules/admin/adminAuditRoutes.js
 * Express router for Admin Portal audit trail endpoints.
 */

import { Router } from 'express';
import { BUSINESS_CONFIG, adminAuditQuerySchema } from '@borrowloop/shared';
import validate from '../../common/validate.js';
import { authenticate, requireRole } from '../../common/authMiddleware.js';
import * as adminAuditController from './adminAuditController.js';

const { TOKEN_AUDIENCES } = BUSINESS_CONFIG;

export const adminAuditRouter = Router();

// Staff authentication & strict Admin role requirement
adminAuditRouter.use(authenticate(TOKEN_AUDIENCES.PORTAL), requireRole('admin'));

// GET /v1/admin/audit-log
adminAuditRouter.get(
  '/',
  validate({ query: adminAuditQuerySchema }),
  adminAuditController.getAuditLogs,
);

export default adminAuditRouter;
