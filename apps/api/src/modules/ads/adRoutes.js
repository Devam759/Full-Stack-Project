/**
 * @file apps/api/src/modules/ads/adRoutes.js
 * Express router for public ad configurations.
 */

import { Router } from 'express';
import { createRateLimiter } from '../../common/rateLimiter.js';
import { getRedisClient } from '../../redis.js';
import * as adController from './adController.js';

export const adRouter = Router();

// Public rate limiter for ads config
const publicAdsLimiter = createRateLimiter({
  redis: getRedisClient(),
  windowSeconds: 60,
  maxRequests: () => (process.env.NODE_ENV === 'test' ? 10_000 : 120),
  keyPrefix: 'rl:ads:config',
});

// GET /v1/ads/config
adRouter.get('/config', publicAdsLimiter, adController.getPublicAdConfig);

export default adRouter;
