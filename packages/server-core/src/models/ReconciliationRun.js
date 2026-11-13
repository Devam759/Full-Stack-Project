/**
 * @file apps/api/src/models/ReconciliationRun.js
 * Tracks nightly and manual ledger-to-wallet audit checkpoints and reconciliation runs.
 */

import mongoose, { Schema, model } from 'mongoose';

const ReconciliationRunSchema = new Schema(
  {
    runId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    startedAt: {
      type: Date,
      default: Date.now,
    },
    finishedAt: {
      type: Date,
      default: null,
    },
    status: {
      type: String,
      enum: ['in_progress', 'completed', 'failed'],
      default: 'in_progress',
    },
    lastCheckpointUserId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    totalWalletsChecked: {
      type: Number,
      default: 0,
    },
    totalLedgerEntriesChecked: {
      type: Number,
      default: 0,
    },
    globalLedgerSumPaise: {
      type: Number,
      default: 0,
    },
    mismatchesCount: {
      type: Number,
      default: 0,
    },
    mismatches: [
      {
        type: { type: String, default: 'BALANCE_MISMATCH' },
        userId: { type: Schema.Types.ObjectId, ref: 'User' },
        walletAvailablePaise: { type: Number, default: 0 },
        walletFrozenPaise: { type: Number, default: 0 },
        ledgerAvailableSumPaise: { type: Number, default: 0 },
        ledgerFrozenSumPaise: { type: Number, default: 0 },
        diffPaise: Number,
        orphanCount: { type: Number, default: 0 },
      },
    ],
    systemBalances: {
      demoFundingPaise: { type: Number, default: 0 },
      platformRevenuePaise: { type: Number, default: 0 },
    },
    error: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

// Database guard: ensure only one reconciliation run can be in_progress at any time
ReconciliationRunSchema.index(
  { status: 1 },
  {
    unique: true,
    partialFilterExpression: { status: 'in_progress' },
  },
);

export const ReconciliationRun =
  mongoose.models.ReconciliationRun || model('ReconciliationRun', ReconciliationRunSchema);
export default ReconciliationRun;
