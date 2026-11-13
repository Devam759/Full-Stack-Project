/**
 * @file apps/api/src/modules/wallet/walletRoutes.js
 * Router for /v1/wallet endpoints with authentication, rate limiting, and idempotency.
 */

import { Router } from 'express';
import { BUSINESS_CONFIG } from '@borrowloop/shared';
import { authenticate, requireVerifiedEmail } from '../../common/authMiddleware.js';
import { requireIdempotencyKey } from '../../common/idempotencyMiddleware.js';
import createRateLimiter from '../../common/rateLimiter.js';
import { getRedisClient } from '../../redis.js';
import walletController from './walletController.js';

const router = Router();
const redis = getRedisClient();

// Rate limiters for wallet operations
const addFundsLimiter = createRateLimiter({
  redis,
  windowSeconds: BUSINESS_CONFIG.WALLET_RATE_LIMITS.ADD_FUNDS.windowSeconds,
  maxRequests:
    process.env.NODE_ENV === 'test'
      ? 10_000
      : BUSINESS_CONFIG.WALLET_RATE_LIMITS.ADD_FUNDS.maxRequests,
  keyPrefix: 'rl:wallet:add',
});

const withdrawLimiter = createRateLimiter({
  redis,
  windowSeconds: BUSINESS_CONFIG.WALLET_RATE_LIMITS.WITHDRAW_FUNDS.windowSeconds,
  maxRequests:
    process.env.NODE_ENV === 'test'
      ? 10_000
      : BUSINESS_CONFIG.WALLET_RATE_LIMITS.WITHDRAW_FUNDS.maxRequests,
  keyPrefix: 'rl:wallet:withdraw',
});

const transactionsLimiter = createRateLimiter({
  redis,
  windowSeconds: BUSINESS_CONFIG.WALLET_RATE_LIMITS.TRANSACTIONS_LIST.windowSeconds,
  maxRequests:
    process.env.NODE_ENV === 'test'
      ? 10_000
      : BUSINESS_CONFIG.WALLET_RATE_LIMITS.TRANSACTIONS_LIST.maxRequests,
  keyPrefix: 'rl:wallet:txns',
});

// All wallet routes require authenticated user with verified email
router.use(authenticate());
router.use(requireVerifiedEmail);

router.get('/', walletController.getWallet);
router.get('/transactions', transactionsLimiter, walletController.getTransactions);
router.post('/add', addFundsLimiter, requireIdempotencyKey(), walletController.addFunds);
router.post('/withdraw', withdrawLimiter, requireIdempotencyKey(), walletController.withdrawFunds);

export default router;
