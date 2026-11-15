/**
 * @file apps/api/src/modules/disputes/disputeRoutes.js
 * Express router for dispute endpoints.
 */

import { Router } from 'express';
import { BUSINESS_CONFIG } from '@borrowloop/shared';
import { addEvidenceSchema, appealDisputeSchema } from '@borrowloop/shared';
import validate from '../../common/validate.js';
import { authenticate } from '../../common/authMiddleware.js';
import { createRateLimiter } from '../../common/rateLimiter.js';
import * as disputeController from './disputeController.js';

const { DISPUTES } = BUSINESS_CONFIG;

export const disputeRouter = Router();

const evidenceRateLimiter = createRateLimiter({
  windowSeconds: DISPUTES.RATE_LIMIT_EVIDENCE?.windowSeconds || 3600,
  maxRequests: DISPUTES.RATE_LIMIT_EVIDENCE?.maxRequests || 10,
  keyPrefix: 'rl:dispute:evidence',
  keyGenerator: (req) => req.user?._id?.toString() || req.ip,
});

disputeRouter.use(authenticate());

disputeRouter.get('/:id', disputeController.getDispute);

disputeRouter.post(
  '/:id/evidence',
  evidenceRateLimiter,
  validate({ body: addEvidenceSchema }),
  disputeController.addEvidence,
);

disputeRouter.post(
  '/:id/appeal',
  validate({ body: appealDisputeSchema }),
  disputeController.appealDispute,
);

export default disputeRouter;
