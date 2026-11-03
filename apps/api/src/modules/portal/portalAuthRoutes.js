import { Router } from 'express';
import { portalLoginSchema, portalTotpSchema, portalEnrollTotpSchema } from '@borrowloop/shared';
import validate from '../../common/validate.js';
import createRateLimiter from '../../common/rateLimiter.js';
import { getRedisClient } from '../../redis.js';
import * as portalAuthController from './portalAuthController.js';

export const portalAuthRouter = Router();

const redis = getRedisClient();

const portalLoginLimiter = createRateLimiter({
  redis,
  windowSeconds: 60,
  maxRequests: 5,
  keyPrefix: 'rl:portal:login',
});

const totpLimiter = createRateLimiter({
  redis,
  windowSeconds: 60,
  maxRequests: 5,
  keyPrefix: 'rl:portal:totp',
});

portalAuthRouter.post(
  '/login',
  portalLoginLimiter,
  validate({ body: portalLoginSchema }),
  portalAuthController.login,
);
portalAuthRouter.post(
  '/totp',
  totpLimiter,
  validate({ body: portalTotpSchema }),
  portalAuthController.totp,
);
portalAuthRouter.post(
  '/enroll',
  validate({ body: portalEnrollTotpSchema }),
  portalAuthController.enroll,
);

export default portalAuthRouter;
