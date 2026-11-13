/**
 * @file apps/api/src/models/LedgerOperation.js
 * Tracks uniquely executed financial operations per booking to prevent duplicate execution.
 * Unique on { bookingId, operationType, opRef }.
 */

import mongoose from 'mongoose';

const ledgerOperationSchema = new mongoose.Schema(
  {
    bookingId: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
      index: true,
    },
    operationType: {
      type: String,
      required: true,
      enum: [
        'booking_hold',
        'extension_hold',
        'deposit_release',
        'booking_cancel_refund',
        'settlement',
      ],
    },
    opRef: {
      type: String,
      required: true,
      default: 'default',
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
    meta: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: false,
    versionKey: false,
  },
);

ledgerOperationSchema.index({ bookingId: 1, operationType: 1, opRef: 1 }, { unique: true });

export default mongoose.model('LedgerOperation', ledgerOperationSchema);
