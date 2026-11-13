/**
 * @file apps/worker/src/jobs/deferredJobs.js
 * Deferred background jobs from docs/ARCHITECTURE.md Section 8 (Phase 7/8).
 * Registered with feature flags defaulting to false, logging clean no-ops.
 */

import { runWithRedisLock } from '@borrowloop/server-core';
import logger from '../logger.js';

/**
 * Job 4: Accrue late charges and open "not returned" disputes (Hourly).
 * Deferred to Phase 7/8.
 */
export async function accrueLateChargesJob({ redisClient }) {
  return runWithRedisLock({
    name: 'accrue_late_charges_job',
    lockTtlMs: 60000,
    redisClient,
    handler: async () => {
      const enabled = process.env.FEATURE_LATE_CHARGES_ENABLED === 'true';
      if (!enabled) {
        logger.debug('Job 4 (Accrue late charges) is deferred: feature flag disabled (no-op)');
        return { success: true, noOp: true };
      }
      return { success: true, processed: 0 };
    },
    logger,
  });
}

/**
 * Job 5: Auto-complete returns after 24 hours (Every 15 minutes).
 * Deferred to Phase 7.
 */
export async function autoCompleteReturnsJob({ redisClient }) {
  return runWithRedisLock({
    name: 'auto_complete_returns_job',
    lockTtlMs: 60000,
    redisClient,
    handler: async () => {
      const enabled = process.env.FEATURE_AUTO_COMPLETE_RETURNS === 'true';
      if (!enabled) {
        logger.debug('Job 5 (Auto-complete returns) is deferred: feature flag disabled (no-op)');
        return { success: true, noOp: true };
      }
      return { success: true, processed: 0 };
    },
    logger,
  });
}

/**
 * Job 6: Reveal ratings after 7 days (Daily).
 * Deferred to Phase 7.
 */
export async function revealRatingsJob({ redisClient }) {
  return runWithRedisLock({
    name: 'reveal_ratings_job',
    lockTtlMs: 60000,
    redisClient,
    handler: async () => {
      const enabled = process.env.FEATURE_RATINGS_REVEAL === 'true';
      if (!enabled) {
        logger.debug('Job 6 (Reveal ratings) is deferred: feature flag disabled (no-op)');
        return { success: true, noOp: true };
      }
      return { success: true, processed: 0 };
    },
    logger,
  });
}
