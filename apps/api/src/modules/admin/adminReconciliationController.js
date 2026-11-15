/**
 * @file apps/api/src/modules/admin/adminReconciliationController.js
 * Controller for inspecting ledger reconciliation history and triggering on-demand runs.
 */

import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { AppError, ERROR_CODES, BUSINESS_CONFIG } from '@borrowloop/shared';
import { ReconciliationRun, writeAuditLogTx } from '@borrowloop/server-core';
import { enqueueOnDemandReconciliation } from '../../jobs/reconciliationQueue.js';

/**
 * Lists historical reconciliation runs with cursor pagination.
 */
export async function getReconciliationRuns(req, res, next) {
  try {
    const { limit = 20, cursor } = req.query;

    const query = {};
    if (cursor && mongoose.Types.ObjectId.isValid(cursor)) {
      query._id = { $lt: new mongoose.Types.ObjectId(cursor) };
    }

    const pageSize = Math.min(Number(limit) || 20, 50);

    const runs = await ReconciliationRun.find(query)
      .sort({ _id: -1 })
      .limit(pageSize + 1)
      .lean();

    const hasMore = runs.length > pageSize;
    const items = hasMore ? runs.slice(0, pageSize) : runs;
    const nextCursor = hasMore ? items[items.length - 1]._id.toString() : null;

    const formattedRuns = items.map((r) => ({
      _id: r._id,
      runId: r.runId,
      status: r.status,
      startedAt: r.startedAt,
      finishedAt: r.finishedAt,
      completedAt: r.finishedAt || r.completedAt,
      totalWalletsChecked: r.totalWalletsChecked || 0,
      totalLedgerEntriesChecked: r.totalLedgerEntriesChecked || 0,
      usersAuditedCount: r.totalWalletsChecked || r.usersAuditedCount || 0,
      ledgerEntriesAuditedCount: r.totalLedgerEntriesChecked || r.ledgerEntriesAuditedCount || 0,
      globalLedgerSumPaise: r.globalLedgerSumPaise || 0,
      mismatchesCount: r.mismatchesCount || 0,
      mismatches: (r.mismatches || []).map((m) => ({
        type: m.type,
        userId: m.userId,
        walletAvailablePaise: m.walletAvailablePaise,
        walletFrozenPaise: m.walletFrozenPaise,
        ledgerAvailableSumPaise: m.ledgerAvailableSumPaise,
        ledgerFrozenSumPaise: m.ledgerFrozenSumPaise,
        diffPaise: m.diffPaise,
        orphanCount: m.orphanCount,
      })),
    }));

    return res.json({
      runs: formattedRuns,
      nextCursor,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Enqueues an on-demand reconciliation run with cooldown checks and audit logging.
 */
export async function triggerReconciliationRun(req, res, next) {
  const session = await mongoose.startSession();
  try {
    const now = new Date();

    // 1. Check if a run is currently in progress
    const activeRun = await ReconciliationRun.findOne({
      status: 'in_progress',
      startedAt: { $gt: new Date(now.getTime() - 15 * 60 * 1000) },
    });

    if (activeRun) {
      throw new AppError(
        ERROR_CODES.RECONCILIATION_COOLDOWN,
        'A ledger reconciliation run is already in progress',
        429,
        { runId: activeRun.runId },
      );
    }

    // 2. Check cooldown from the last completed run
    const cooldownSeconds = BUSINESS_CONFIG.ADMIN.RECONCILIATION_RUN_COOLDOWN_SECONDS || 300;
    const recentRun = await ReconciliationRun.findOne({
      status: 'completed',
      $or: [
        { finishedAt: { $gt: new Date(now.getTime() - cooldownSeconds * 1000) } },
        { completedAt: { $gt: new Date(now.getTime() - cooldownSeconds * 1000) } },
      ],
    }).sort({ finishedAt: -1, completedAt: -1 });

    if (recentRun) {
      const runFinished = recentRun.finishedAt || recentRun.completedAt || now;
      const elapsedSeconds = Math.floor((now.getTime() - runFinished.getTime()) / 1000);
      const remainingCooldownSeconds = Math.max(1, cooldownSeconds - elapsedSeconds);
      throw new AppError(
        ERROR_CODES.RECONCILIATION_COOLDOWN,
        `Reconciliation was recently completed. Please wait ${remainingCooldownSeconds} seconds before triggering another run.`,
        429,
        { remainingCooldownSeconds },
      );
    }

    const runId = `rec_admin_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

    // 3. Write immutable audit log row within transaction
    await session.withTransaction(async () => {
      await writeAuditLogTx(
        {
          actorId: req.user._id,
          actorRole: req.user.role,
          action: 'reconciliation_run_triggered',
          targetType: 'reconciliation_run',
          targetId: runId,
          before: null,
          after: { runId, reason: req.body.reason },
          ip: req.ip || 'unknown',
        },
        { session },
      );
    });

    // 4. Enqueue BullMQ worker job
    await enqueueOnDemandReconciliation({
      runId,
      trigger: 'admin_on_demand',
      reason: req.body.reason,
    });

    return res.status(202).json({
      runId,
      status: 'enqueued',
      message: 'Reconciliation run enqueued successfully',
    });
  } catch (error) {
    next(error);
  } finally {
    await session.endSession();
  }
}

export default {
  getReconciliationRuns,
  triggerReconciliationRun,
};
