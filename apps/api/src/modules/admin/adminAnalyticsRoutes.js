/**
 * @file apps/api/src/modules/admin/adminAnalyticsRoutes.js
 * Express router for Admin Portal analytics.
 */

import { Router } from 'express';
import { BUSINESS_CONFIG } from '@borrowloop/shared';
import { authenticate, requireRole } from '../../common/authMiddleware.js';
import * as adminAnalyticsController from './adminAnalyticsController.js';

const { TOKEN_AUDIENCES } = BUSINESS_CONFIG;

export const adminAnalyticsRouter = Router();

// Staff authentication & strict Admin role requirement
adminAnalyticsRouter.use(authenticate(TOKEN_AUDIENCES.PORTAL), requireRole('admin'));

// GET /v1/admin/analytics/overview
adminAnalyticsRouter.get('/overview', adminAnalyticsController.getAnalyticsOverview);

export default adminAnalyticsRouter;
