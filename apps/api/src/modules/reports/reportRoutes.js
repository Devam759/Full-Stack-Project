/**
 * @file apps/api/src/modules/reports/reportRoutes.js
 * Express router for user report submission.
 */

import { Router } from 'express';
import { BUSINESS_CONFIG } from '@borrowloop/shared';
import { createReportSchema } from '@borrowloop/shared';
import validate from '../../common/validate.js';
import { authenticate } from '../../common/authMiddleware.js';
import { createRateLimiter } from '../../common/rateLimiter.js';
import * as reportController from './reportController.js';

const { REPORTS } = BUSINESS_CONFIG;

export const reportRouter = Router();

const reportRateLimiter = createRateLimiter({
  windowSeconds: REPORTS?.RATE_LIMIT?.windowSeconds || 3600,
  maxRequests: REPORTS?.RATE_LIMIT?.maxRequests || 10,
  keyPrefix: 'rl:reports:create',
  keyGenerator: (req) => req.user?._id?.toString() || req.ip,
});

reportRouter.use(authenticate());

reportRouter.post(
  '/',
  reportRateLimiter,
  validate({ body: createReportSchema }),
  reportController.createReport,
);

export default reportRouter;
