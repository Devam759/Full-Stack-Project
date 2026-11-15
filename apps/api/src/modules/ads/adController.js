/**
 * @file apps/api/src/modules/ads/adController.js
 * Public controller for client ad configurations.
 */

import { BUSINESS_CONFIG } from '@borrowloop/shared';
import { AdSetting, SystemSetting } from '@borrowloop/server-core';
import { getRedisClient } from '../../redis.js';
import logger from '../../common/logger.js';

const CACHE_KEY = 'cache:ads:public_config';
const CACHE_TTL_SECONDS = BUSINESS_CONFIG.ADMIN.ANALYTICS_CACHE_TTL_SECONDS || 60;

/**
 * GET /v1/ads/config
 * Public endpoint for web clients to retrieve active ad placements.
 * Returns { masterEnabled: false, placements: [] } if master switch is disabled.
 * Cached in Redis for 60 seconds.
 */
export async function getPublicAdConfig(req, res, next) {
  try {
    const redis = getRedisClient();

    // 1. Check Redis cache
    if (redis && (redis.status === 'ready' || redis.status === 'connect')) {
      try {
        const cached = await redis.get(CACHE_KEY);
        if (cached) {
          return res.json(JSON.parse(cached));
        }
      } catch (err) {
        logger.warn({ err: err.message }, 'Failed reading public ads cache from Redis');
      }
    }

    // 2. Query master ad switch
    const masterSetting = await SystemSetting.findOne({ key: 'ads.masterEnabled' }).lean();
    const isMasterEnabled = masterSetting?.value === true;

    let responseData;

    if (!isMasterEnabled) {
      responseData = {
        masterEnabled: false,
        enabled: false,
        clientId: null,
        placements: [],
      };
    } else {
      const [clientSetting, enabledPlacements] = await Promise.all([
        SystemSetting.findOne({ key: 'ads.clientId' }).lean(),
        AdSetting.find({ enabled: true }).lean(),
      ]);

      const placements = enabledPlacements.map((doc) => ({
        placement: doc.placement,
        adsenseSlotId: doc.adsenseSlotId || '',
        pages: doc.pages || [...BUSINESS_CONFIG.ADS.ALLOWED_SCREENS],
      }));

      responseData = {
        masterEnabled: true,
        enabled: true,
        clientId: clientSetting?.value || null,
        placements,
      };
    }

    // 3. Write to Redis cache
    if (redis && (redis.status === 'ready' || redis.status === 'connect')) {
      try {
        await redis.set(CACHE_KEY, JSON.stringify(responseData), 'EX', CACHE_TTL_SECONDS);
      } catch (err) {
        logger.warn({ err: err.message }, 'Failed writing public ads cache to Redis');
      }
    }

    return res.json(responseData);
  } catch (error) {
    next(error);
  }
}

export default {
  getPublicAdConfig,
};
