/**
 * @file apps/api/src/models/IdempotencyKey.js
 * Tracks unique idempotency keys per user with request hash, response payload and TTL.
 */

import mongoose, { Schema, model } from 'mongoose';
import { BUSINESS_CONFIG } from '@borrowloop/shared';

const IdempotencyKeySchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    key: {
      type: String,
      required: true,
      trim: true,
    },
    requestHash: {
      type: String,
      required: true,
    },
    statusCode: {
      type: Number,
      required: true,
    },
    responseBody: {
      type: Schema.Types.Mixed,
      required: true,
    },
    createdAt: {
      type: Date,
      default: Date.now,
      expires: BUSINESS_CONFIG.IDEMPOTENCY_TTL_SECONDS,
    },
  },
  {
    timestamps: false,
    versionKey: false,
  },
);

// Compound unique index ensuring key uniqueness per user
IdempotencyKeySchema.index({ userId: 1, key: 1 }, { unique: true });

export const IdempotencyKey =
  mongoose.models.IdempotencyKey || model('IdempotencyKey', IdempotencyKeySchema);
export default IdempotencyKey;
