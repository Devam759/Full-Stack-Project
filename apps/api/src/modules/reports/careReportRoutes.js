/**
 * @file apps/api/src/modules/reports/careReportRoutes.js
 * Express router for staff care report moderation endpoints.
 */

import { Router } from 'express';
import { BUSINESS_CONFIG } from '@borrowloop/shared';
import { listReportsQuerySchema, careReportActionSchema } from '@borrowloop/shared';
import validate from '../../common/validate.js';
import { authenticate, requireRole } from '../../common/authMiddleware.js';
import * as reportController from './reportController.js';

const { TOKEN_AUDIENCES } = BUSINESS_CONFIG;

export const careReportRouter = Router();

careReportRouter.use(authenticate(TOKEN_AUDIENCES.PORTAL), requireRole('care_agent', 'admin'));

careReportRouter.get(
  '/',
  validate({ query: listReportsQuerySchema }),
  reportController.listReports,
);

careReportRouter.post(
  '/:id/action',
  validate({ body: careReportActionSchema }),
  reportController.takeCareAction,
);

export default careReportRouter;
