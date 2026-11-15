/**
 * @file apps/api/src/modules/care/careUserRoutes.js
 * Express router for staff care agent user lookup.
 */

import { Router } from 'express';
import { BUSINESS_CONFIG } from '@borrowloop/shared';
import { authenticate, requireRole } from '../../common/authMiddleware.js';
import * as reportController from '../reports/reportController.js';

const { TOKEN_AUDIENCES } = BUSINESS_CONFIG;

export const careUserRouter = Router();

careUserRouter.use(authenticate(TOKEN_AUDIENCES.PORTAL), requireRole('care_agent', 'admin'));

// GET /v1/care/users/:id
careUserRouter.get('/:id', reportController.getUserLookup);

export default careUserRouter;
