/**
 * @file apps/api/src/modules/admin/adminAdController.js
 * Controller for Google AdSense configuration and master switch in the Admin Portal.
 */

import mongoose from 'mongoose';
import { BUSINESS_CONFIG, AppError, ERROR_CODES } from '@borrowloop/shared';
import { AdSetting, SystemSetting, writeAuditLogTx } from '@borrowloop/server-core';
import { getRedisClient } from '../../redis.js';
import logger from '../../common/logger.js';

const { ADS } = BUSINESS_CONFIG;
const PUBLIC_CONFIG_CACHE_KEY = 'cache:ads:public_config';

/**
 * Invalidates the public ads configuration cache in Redis.
 */
async function invalidatePublicAdsCache() {
  const redis = getRedisClient();
  if (redis && (redis.status === 'ready' || redis.status === 'connect')) {
    try {
      await redis.del(PUBLIC_CONFIG_CACHE_KEY);
    } catch (err) {
      logger.warn({ err: err.message }, 'Failed invalidating ads public config cache in Redis');
    }
  }
}

/**
 * GET /v1/admin/ads
 * Retrieves current ad placements, enabled states, slot IDs, and master switch state.
 */
export async function getAdSettings(req, res, next) {
  try {
    const [masterSetting, clientSetting, dbPlacements] = await Promise.all([
      SystemSetting.findOne({ key: 'ads.masterEnabled' }).lean(),
      SystemSetting.findOne({ key: 'ads.clientId' }).lean(),
      AdSetting.find().lean(),
    ]);

    const placementMap = new Map();
    for (const item of dbPlacements) {
      placementMap.set(item.placement, item);
    }

    const placements = ADS.PLACEMENTS.map((placement) => {
      const existing = placementMap.get(placement);
      if (existing) {
        return {
          placement: existing.placement,
          enabled: existing.enabled,
          adsenseSlotId: existing.adsenseSlotId || '',
          pages: existing.pages || [...ADS.ALLOWED_SCREENS],
        };
      }
      return {
        placement,
        enabled: false,
        adsenseSlotId: '',
        pages: [...ADS.ALLOWED_SCREENS],
      };
    });

    return res.json({
      masterEnabled: masterSetting?.value === true,
      clientId: clientSetting?.value || null,
      placements,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * PATCH /v1/admin/ads/:placement
 * Enables/disables a placement and updates its AdSense slot ID.
 * Validates SLOT_ID_PATTERN, records an audit log row inside a transaction, and invalidates public cache.
 */
export async function patchAdPlacement(req, res, next) {
  const session = await mongoose.startSession();
  try {
    const { placement } = req.params;
    if (!ADS.PLACEMENTS.includes(placement)) {
      throw new AppError(
        ERROR_CODES.ADS_CONFIG_INVALID,
        `Invalid ad placement: ${placement}. Valid placements: ${ADS.PLACEMENTS.join(', ')}`,
        400,
      );
    }

    const { enabled, adsenseSlotId, reason } = req.body;

    if (adsenseSlotId !== undefined && adsenseSlotId !== '') {
      if (!ADS.SLOT_ID_PATTERN.test(adsenseSlotId)) {
        throw new AppError(
          ERROR_CODES.ADS_CONFIG_INVALID,
          'adsenseSlotId must be 6-20 digits matching regex ^\\d{6,20}$',
          400,
        );
      }
    }

    let updatedDoc;

    await session.withTransaction(async () => {
      let adDoc = await AdSetting.findOne({ placement }).session(session);

      if (!adDoc) {
        adDoc = new AdSetting({
          placement,
          enabled: false,
          adsenseSlotId: '',
          pages: [...ADS.ALLOWED_SCREENS],
        });
      }

      const before = {
        enabled: adDoc.enabled,
        adsenseSlotId: adDoc.adsenseSlotId,
      };

      if (enabled !== undefined) {
        adDoc.enabled = enabled;
      }
      if (adsenseSlotId !== undefined) {
        adDoc.adsenseSlotId = adsenseSlotId;
      }

      await adDoc.save({ session });
      updatedDoc = adDoc;

      await writeAuditLogTx(
        {
          actorId: req.user._id || req.user.userId,
          actorRole: req.user.role,
          action: 'ad_placement_updated',
          targetType: 'ad_setting',
          targetId: adDoc._id.toString(),
          before,
          after: {
            enabled: adDoc.enabled,
            adsenseSlotId: adDoc.adsenseSlotId,
            reason,
          },
          ip: req.ip || 'unknown',
        },
        { session },
      );
    });

    await invalidatePublicAdsCache();

    return res.json({
      placement: updatedDoc.placement,
      enabled: updatedDoc.enabled,
      adsenseSlotId: updatedDoc.adsenseSlotId,
      pages: updatedDoc.pages,
    });
  } catch (error) {
    next(error);
  } finally {
    await session.endSession();
  }
}

/**
 * POST /v1/admin/ads/master
 * Toggles the master ad switch.
 * Turning master ON requires `confirm: 'ENABLE_ADS'`.
 * Validates CLIENT_ID_PATTERN if provided, writes audit log row, and invalidates public cache.
 */
export async function setMasterAds(req, res, next) {
  const session = await mongoose.startSession();
  try {
    const { enabled, confirm, clientId, reason } = req.body;

    if (enabled === true && confirm !== 'ENABLE_ADS') {
      throw new AppError(
        ERROR_CODES.ADS_CONFIG_INVALID,
        "Turning master ads on requires confirm: 'ENABLE_ADS'",
        400,
      );
    }

    if (clientId !== undefined && clientId !== '') {
      if (!ADS.CLIENT_ID_PATTERN.test(clientId)) {
        throw new AppError(
          ERROR_CODES.ADS_CONFIG_INVALID,
          'clientId must match pattern ^ca-pub-\\d{10,20}$',
          400,
        );
      }
    }

    let finalClientId;

    await session.withTransaction(async () => {
      let masterDoc = await SystemSetting.findOne({ key: 'ads.masterEnabled' }).session(session);
      let clientDoc = await SystemSetting.findOne({ key: 'ads.clientId' }).session(session);

      const before = {
        masterEnabled: masterDoc?.value ?? ADS.DEFAULT_MASTER_ENABLED,
        clientId: clientDoc?.value ?? null,
      };

      if (!masterDoc) {
        masterDoc = new SystemSetting({ key: 'ads.masterEnabled' });
      }
      masterDoc.value = enabled;
      masterDoc.updatedBy = req.user._id || req.user.userId;
      await masterDoc.save({ session });

      if (clientId !== undefined) {
        if (!clientDoc) {
          clientDoc = new SystemSetting({ key: 'ads.clientId' });
        }
        clientDoc.value = clientId;
        clientDoc.updatedBy = req.user._id || req.user.userId;
        await clientDoc.save({ session });
        finalClientId = clientId;
      } else {
        finalClientId = clientDoc?.value || null;
      }

      await writeAuditLogTx(
        {
          actorId: req.user._id || req.user.userId,
          actorRole: req.user.role,
          action: enabled ? 'ad_master_enabled' : 'ad_master_disabled',
          targetType: 'system_setting',
          targetId: masterDoc._id.toString(),
          before,
          after: {
            masterEnabled: enabled,
            clientId: finalClientId,
            reason,
          },
          ip: req.ip || 'unknown',
        },
        { session },
      );
    });

    await invalidatePublicAdsCache();

    return res.json({
      masterEnabled: enabled,
      clientId: finalClientId,
    });
  } catch (error) {
    next(error);
  } finally {
    await session.endSession();
  }
}

export default {
  getAdSettings,
  patchAdPlacement,
  setMasterAds,
};
