/**
 * @file apps/api/src/modules/admin/adminAnalyticsController.js
 * Controller for executive analytics overview in the Admin Portal.
 */

import { BUSINESS_CONFIG } from '@borrowloop/shared';
import User from '../../models/User.js';
import Item from '../../models/Item.js';
import Booking from '../../models/Booking.js';
import Wallet from '../../models/Wallet.js';
import LedgerEntry from '../../models/LedgerEntry.js';
import Dispute from '../../models/Dispute.js';
import { getRedisClient } from '../../redis.js';
import logger from '../../common/logger.js';

const CACHE_KEY = 'cache:admin:analytics:overview';
const CACHE_TTL_SECONDS = BUSINESS_CONFIG.ADMIN.ANALYTICS_CACHE_TTL_SECONDS || 60;

/**
 * Computes platform-wide analytics metrics using indexed counts and $facet.
 */
export async function getAnalyticsOverview(req, res, next) {
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
        logger.warn({ err: err.message }, 'Failed reading analytics cache from Redis');
      }
    }

    // 2. Perform aggregations in parallel with maxTimeMS
    const [userStats, itemStats, bookingStats, walletStats, ledgerStats, disputeStats] =
      await Promise.all([
        // Users facet
        User.aggregate([
          {
            $facet: {
              total: [{ $count: 'count' }],
              byStatus: [{ $group: { _id: '$status', count: { $sum: 1 } } }],
            },
          },
        ]).option({ maxTimeMS: 5000 }),

        // Items facet
        Item.aggregate([
          {
            $facet: {
              byStatus: [{ $group: { _id: '$status', count: { $sum: 1 } } }],
            },
          },
        ]).option({ maxTimeMS: 5000 }),

        // Bookings facet
        Booking.aggregate([
          {
            $facet: {
              byStatus: [{ $group: { _id: '$status', count: { $sum: 1 } } }],
              completedVolume: [
                { $match: { status: 'completed' } },
                { $group: { _id: null, totalRentPaise: { $sum: '$rentPaise' } } },
              ],
              pickedUpHistory: [
                { $match: { status: { $in: ['picked_up', 'returned', 'completed', 'disputed'] } } },
                { $count: 'count' },
              ],
            },
          },
        ]).option({ maxTimeMS: 5000 }),

        // Wallets: Deposits held (sum of all frozenPaise)
        Wallet.aggregate([
          {
            $group: {
              _id: null,
              totalFrozenPaise: { $sum: '$frozenPaise' },
            },
          },
        ]).option({ maxTimeMS: 5000 }),

        // Ledger: Commission earned (sum of all platform_revenue entries including reversals)
        LedgerEntry.aggregate([
          {
            $match: { account: 'platform_revenue' },
          },
          {
            $group: {
              _id: null,
              totalCommissionPaise: { $sum: '$amountPaise' },
            },
          },
        ]).option({ maxTimeMS: 5000 }),

        // Disputes facet
        Dispute.aggregate([
          {
            $facet: {
              total: [{ $count: 'count' }],
              openCount: [
                { $match: { status: { $in: ['opened', 'assigned'] } } },
                { $count: 'count' },
              ],
              pendingAppeals: [{ $match: { 'appeal.status': 'pending' } }, { $count: 'count' }],
            },
          },
        ]).option({ maxTimeMS: 5000 }),
      ]);

    // 3. Process User metrics
    const userStatusMap = {};
    for (const s of userStats[0]?.byStatus || []) {
      userStatusMap[s._id] = s.count;
    }
    const totalUsers = userStats[0]?.total[0]?.count || 0;
    const users = {
      total: totalUsers,
      active: userStatusMap.active || 0,
      frozen: userStatusMap.frozen || 0,
      banned: userStatusMap.banned || 0,
    };

    // 4. Process Item metrics & Rented Now
    const itemStatusMap = {};
    for (const s of itemStats[0]?.byStatus || []) {
      itemStatusMap[s._id] = s.count;
    }

    const bookingStatusMap = {};
    for (const s of bookingStats[0]?.byStatus || []) {
      bookingStatusMap[s._id] = s.count;
    }

    const rentedNow = bookingStatusMap.picked_up || 0;
    const items = {
      active: itemStatusMap.active || 0,
      paused: itemStatusMap.paused || 0,
      hidden: itemStatusMap.hidden || 0,
      removed: itemStatusMap.removed || 0,
      rentedNow,
    };

    // 5. Process Bookings metrics
    const bookings = {
      requested: bookingStatusMap.requested || 0,
      accepted: bookingStatusMap.accepted || 0,
      picked_up: bookingStatusMap.picked_up || 0,
      returned: bookingStatusMap.returned || 0,
      disputed: bookingStatusMap.disputed || 0,
      completed: bookingStatusMap.completed || 0,
      cancelled: bookingStatusMap.cancelled || 0,
      expired: bookingStatusMap.expired || 0,
    };

    // 6. Financial metrics
    const volumePaise = bookingStats[0]?.completedVolume[0]?.totalRentPaise || 0;
    const depositsHeldPaise = walletStats[0]?.totalFrozenPaise || 0;
    const commissionEarnedPaise = ledgerStats[0]?.totalCommissionPaise || 0;
    const financials = {
      volumePaise,
      depositsHeldPaise,
      commissionEarnedPaise,
      currency: 'INR',
      label: 'Demo money',
    };

    // 7. Dispute ratio & appeals
    const totalDisputes = disputeStats[0]?.total[0]?.count || 0;
    const openDisputes = disputeStats[0]?.openCount[0]?.count || 0;
    const pendingAppeals = disputeStats[0]?.pendingAppeals[0]?.count || 0;
    const pickedUpCount = bookingStats[0]?.pickedUpHistory[0]?.count || 0;
    const disputeRatio = pickedUpCount > 0 ? Number((totalDisputes / pickedUpCount).toFixed(4)) : 0;

    const disputes = {
      open: openDisputes,
      pendingAppeals,
      disputeRatio,
      total: totalDisputes,
    };

    const responseData = {
      users,
      items,
      bookings,
      financials,
      disputes,
      cachedAt: new Date().toISOString(),
    };

    // 8. Cache response in Redis
    if (redis && (redis.status === 'ready' || redis.status === 'connect')) {
      try {
        await redis.set(CACHE_KEY, JSON.stringify(responseData), 'EX', CACHE_TTL_SECONDS);
      } catch (err) {
        logger.warn({ err: err.message }, 'Failed writing analytics cache to Redis');
      }
    }

    return res.json(responseData);
  } catch (error) {
    next(error);
  }
}

export default {
  getAnalyticsOverview,
};
