/**
 * @file apps/api/src/models/LedgerEntry.js
 * Immutable, append-only double-entry ledger collection.
 * In accordance with AGENTS.md Hard Rule 2:
 * "Money may only change through the ledger service. No other code may edit a balance directly."
 */

import mongoose, { Schema, model } from 'mongoose';
import { BUSINESS_CONFIG, AppError, ERROR_CODES } from '@borrowloop/shared';

const LedgerEntrySchema = new Schema(
  {
    txnId: {
      type: String,
      required: true,
    },
    bookingId: {
      type: Schema.Types.ObjectId,
      ref: 'Booking',
      default: null,
      index: true,
    },
    account: {
      type: String,
      enum: BUSINESS_CONFIG.LEDGER_ACCOUNTS,
      required: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },
    amountPaise: {
      type: Number,
      required: true,
      validate: {
        validator: (v) => Number.isSafeInteger(v),
        message: 'amountPaise must be a safe integer',
      },
    },
    balanceAfterPaise: {
      type: Number,
      default: null,
      validate: {
        validator: (v) => v === null || Number.isSafeInteger(v),
        message: 'balanceAfterPaise must be null or a safe integer',
      },
    },
    type: {
      type: String,
      enum: BUSINESS_CONFIG.LEDGER_ENTRY_TYPES,
      required: true,
    },
    idempotencyKey: {
      type: String,
      default: null,
    },
    meta: {
      type: Schema.Types.Mixed,
      default: () => ({}),
    },
    createdAt: {
      type: Date,
      default: Date.now,
      immutable: true,
    },
  },
  {
    timestamps: false,
    versionKey: false,
  },
);

// Indexes (Note: idempotencyKey does NOT have a unique index here; tracked in idempotency_keys)
LedgerEntrySchema.index({ txnId: 1 });
LedgerEntrySchema.index({ userId: 1, createdAt: -1, _id: -1 });

// Helper invariant error
function throwAppendOnlyError(operation) {
  throw new AppError(
    ERROR_CODES.INTERNAL_ERROR,
    `Ledger entries are strictly append-only. Operation '${operation}' is prohibited.`,
    500,
  );
}

// Block modifications on document save
LedgerEntrySchema.pre('save', function (next) {
  if (!this.isNew) {
    return next(
      new AppError(
        ERROR_CODES.INTERNAL_ERROR,
        'Ledger entries are strictly append-only. Modifying existing entries is prohibited.',
        500,
      ),
    );
  }
  next();
});

// Block update queries
const blockedUpdateQueries = [
  'updateOne',
  'updateMany',
  'findOneAndUpdate',
  'findOneAndReplace',
  'replaceOne',
];
for (const queryName of blockedUpdateQueries) {
  LedgerEntrySchema.pre(queryName, function () {
    throwAppendOnlyError(queryName);
  });
}

// Block delete queries
const blockedDeleteQueries = ['deleteOne', 'deleteMany', 'findOneAndDelete'];
for (const queryName of blockedDeleteQueries) {
  LedgerEntrySchema.pre(queryName, function () {
    throwAppendOnlyError(queryName);
  });
}

// Guard bulkWrite against update or delete operations
const originalBulkWrite = mongoose.Model.bulkWrite;
LedgerEntrySchema.statics.bulkWrite = async function (ops, options) {
  if (Array.isArray(ops)) {
    for (const op of ops) {
      const keys = Object.keys(op);
      const prohibited = ['updateOne', 'updateMany', 'replaceOne', 'deleteOne', 'deleteMany'];
      for (const p of prohibited) {
        if (keys.includes(p)) {
          throwAppendOnlyError(`bulkWrite.${p}`);
        }
      }
    }
  }
  return originalBulkWrite.call(this, ops, options);
};

export const LedgerEntry = mongoose.models.LedgerEntry || model('LedgerEntry', LedgerEntrySchema);
export default LedgerEntry;
