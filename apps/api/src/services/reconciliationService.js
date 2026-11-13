/**
 * @file apps/api/src/services/reconciliationService.js
 * Nightly and on-demand reconciliation engine executing batched checks with checkpoints.
 * Verifies that:
 * 1. Global sum of all ledger entries === 0
 * 2. Every user's cached wallet balances exactly match the sum of their ledger entries
 * 3. Saves checkpoint audit records in reconciliation_runs collection
 */

import crypto from 'node:crypto';
import { BUSINESS_CONFIG } from '@borrowloop/shared';
import LedgerEntry from '../models/LedgerEntry.js';
import Wallet from '../models/Wallet.js';
import User from '../models/User.js';
import ReconciliationRun from '../models/ReconciliationRun.js';
import { runInTransactionWithRetry } from '../modules/wallet/ledgerService.js';

/**
 * Runs a complete batched reconciliation audit.
 * Supports resume via resumeRunId from lastCheckpointUserId.
 * Reads batches within snapshot transactions to guarantee consistency under concurrent live traffic.
 * Caps stored mismatches array to prevent 16MB document overflow.
 *
 * @param {object} [options]
 * @param {number} [options.batchSize=100]
 * @param {string | null} [options.resumeRunId=null]
 * @param {number} [options.maxStoredMismatches=100]
 * @returns {Promise<import('../models/ReconciliationRun.js').default>}
 */
export async function runReconciliation({
  batchSize = BUSINESS_CONFIG.RECONCILIATION_BATCH_SIZE,
  resumeRunId = null,
  maxStoredMismatches = BUSINESS_CONFIG.MAX_RECONCILIATION_STORED_MISMATCHES || 100,
} = {}) {
  let runDoc;
  let lastCheckpoint = null;
  let totalWalletsChecked = 0;
  let mismatches = [];
  let mismatchesCount = 0;

  if (resumeRunId) {
    runDoc = await ReconciliationRun.findOne({ runId: resumeRunId });
    if (!runDoc) {
      throw new Error(`Reconciliation run ${resumeRunId} not found to resume`);
    }
    runDoc.status = 'in_progress';
    lastCheckpoint = runDoc.lastCheckpointUserId || null;
    totalWalletsChecked = runDoc.totalWalletsChecked || 0;
    mismatches = runDoc.mismatches || [];
    mismatchesCount = runDoc.mismatchesCount || mismatches.length;
    await runDoc.save();
  } else {
    const runId = `rec-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    runDoc = new ReconciliationRun({
      runId,
      startedAt: new Date(),
      status: 'in_progress',
      totalWalletsChecked: 0,
      totalLedgerEntriesChecked: 0,
      globalLedgerSumPaise: 0,
      mismatchesCount: 0,
      mismatches: [],
    });
    await runDoc.save();
  }

  try {
    // 1. Initial snapshot session for global sum, platform accounts, and orphan ledger user checks
    await runInTransactionWithRetry(async (initSession) => {
      // 1.1 Compute global ledger sum and entry count
      const globalAgg = await LedgerEntry.aggregate([
        {
          $group: {
            _id: null,
            totalSum: { $sum: '$amountPaise' },
            count: { $sum: 1 },
          },
        },
      ]).session(initSession);

      const globalSum = globalAgg.length > 0 ? globalAgg[0].totalSum : 0;
      const totalEntries = globalAgg.length > 0 ? globalAgg[0].count : 0;

      runDoc.globalLedgerSumPaise = globalSum;
      runDoc.totalLedgerEntriesChecked = totalEntries;

      // 1.2 Compute system accounts
      const systemAgg = await LedgerEntry.aggregate([
        {
          $match: {
            account: { $in: ['demo_funding', 'platform_revenue'] },
          },
        },
        {
          $group: {
            _id: '$account',
            sum: { $sum: '$amountPaise' },
          },
        },
      ]).session(initSession);

      const systemMap = { demo_funding: 0, platform_revenue: 0 };
      for (const item of systemAgg) {
        systemMap[item._id] = item.sum;
      }
      runDoc.systemBalances = {
        demoFundingPaise: systemMap.demo_funding,
        platformRevenuePaise: systemMap.platform_revenue,
      };

      // 1.3 Missing orphan check: any ledger entry whose userId has no wallet or no user
      const orphanAgg = await LedgerEntry.aggregate([
        {
          $match: {
            userId: { $ne: null },
            account: { $in: ['available', 'frozen'] },
          },
        },
        {
          $lookup: {
            from: 'users',
            localField: 'userId',
            foreignField: '_id',
            as: 'userDoc',
          },
        },
        {
          $lookup: {
            from: 'wallets',
            localField: 'userId',
            foreignField: 'userId',
            as: 'walletDoc',
          },
        },
        {
          $match: {
            $or: [{ 'userDoc.0': { $exists: false } }, { 'walletDoc.0': { $exists: false } }],
          },
        },
        {
          $group: {
            _id: '$userId',
            orphanCount: { $sum: 1 },
            totalPaise: { $sum: '$amountPaise' },
          },
        },
        { $limit: maxStoredMismatches },
      ]).session(initSession);

      for (const orphan of orphanAgg) {
        mismatchesCount += 1;
        if (mismatches.length < maxStoredMismatches) {
          mismatches.push({
            type: 'ORPHAN_LEDGER_USER',
            userId: orphan._id,
            orphanCount: orphan.orphanCount,
            diffPaise: orphan.totalPaise,
          });
        }
      }
    });

    // 2. Batched user audit with checkpoints and snapshot isolation
    let hasMore = true;
    while (hasMore) {
      const userQuery = lastCheckpoint ? { _id: { $gt: lastCheckpoint } } : {};
      const userBatch = await User.find(userQuery, { _id: 1 })
        .sort({ _id: 1 })
        .limit(batchSize)
        .lean();

      if (userBatch.length === 0) {
        hasMore = false;
        break;
      }

      const userIds = userBatch.map((u) => u._id);

      // Execute batch audit inside a snapshot transaction for point-in-time consistency
      await runInTransactionWithRetry(async (session) => {
        const wallets = await Wallet.find({ userId: { $in: userIds } })
          .session(session)
          .lean();
        const walletMap = new Map();
        for (const w of wallets) {
          walletMap.set(w.userId.toString(), w);
        }

        const userLedgerAgg = await LedgerEntry.aggregate([
          {
            $match: {
              userId: { $in: userIds },
              account: { $in: ['available', 'frozen'] },
            },
          },
          {
            $group: {
              _id: { userId: '$userId', account: '$account' },
              sum: { $sum: '$amountPaise' },
            },
          },
        ]).session(session);

        const ledgerMap = new Map();
        for (const item of userLedgerAgg) {
          const uId = item._id.userId.toString();
          const acc = item._id.account;
          if (!ledgerMap.has(uId)) {
            ledgerMap.set(uId, { available: 0, frozen: 0 });
          }
          ledgerMap.get(uId)[acc] = item.sum;
        }

        for (const u of userBatch) {
          const uId = u._id.toString();
          const wallet = walletMap.get(uId) || { availablePaise: 0, frozenPaise: 0 };
          const ledger = ledgerMap.get(uId) || { available: 0, frozen: 0 };

          const availableDiff = (wallet.availablePaise || 0) - ledger.available;
          const frozenDiff = (wallet.frozenPaise || 0) - ledger.frozen;

          if (availableDiff !== 0 || frozenDiff !== 0) {
            mismatchesCount += 1;
            if (mismatches.length < maxStoredMismatches) {
              mismatches.push({
                userId: u._id,
                walletAvailablePaise: wallet.availablePaise || 0,
                walletFrozenPaise: wallet.frozenPaise || 0,
                ledgerAvailableSumPaise: ledger.available,
                ledgerFrozenSumPaise: ledger.frozen,
                diffPaise: availableDiff + frozenDiff,
              });
            }
          }
        }
      });

      totalWalletsChecked += userBatch.length;
      lastCheckpoint = userBatch[userBatch.length - 1]._id;

      // Update checkpoint and stats on run document
      runDoc.lastCheckpointUserId = lastCheckpoint;
      runDoc.totalWalletsChecked = totalWalletsChecked;
      runDoc.mismatches = mismatches;
      runDoc.mismatchesCount = mismatchesCount;
      await runDoc.save();

      if (userBatch.length < batchSize) {
        hasMore = false;
      }
    }

    runDoc.mismatches = mismatches;
    runDoc.mismatchesCount = mismatchesCount;
    runDoc.finishedAt = new Date();
    runDoc.status =
      mismatchesCount === 0 && runDoc.globalLedgerSumPaise === 0 ? 'completed' : 'failed';
    await runDoc.save();

    return runDoc;
  } catch (err) {
    runDoc.status = 'failed';
    runDoc.finishedAt = new Date();
    runDoc.error = err.message || String(err);
    await runDoc.save();
    throw err;
  }
}

export default {
  runReconciliation,
};
