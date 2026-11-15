/**
 * @file packages/server-core/src/models/Report.js
 * Mongoose model for User, Item, and Message reports and moderation records.
 */

import mongoose from 'mongoose';
import { BUSINESS_CONFIG } from '@borrowloop/shared';

const { REPORTS } = BUSINESS_CONFIG;

const reportSchema = new mongoose.Schema(
  {
    reporterId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    targetType: {
      type: String,
      enum: ['item', 'user', 'message'],
      required: true,
    },
    targetId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },
    targetOwnerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    reason: {
      type: String,
      required: true,
    },
    details: {
      type: String,
      default: '',
      maxlength: REPORTS?.DETAILS_MAX_LENGTH || 1000,
    },
    snapshot: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    status: {
      type: String,
      enum: ['pending', 'reviewed'],
      default: 'pending',
      required: true,
      index: true,
    },
    reviewedById: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    reviewedAt: {
      type: Date,
      default: null,
    },
    actionTaken: {
      type: String,
      enum: [
        'dismiss',
        'hide_item',
        'remove_item',
        'restore_item',
        'warn_user',
        'strike_user',
        null,
      ],
      default: null,
    },
    notes: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: true,
  },
);

// Compound indexes
reportSchema.index({ targetType: 1, targetId: 1, status: 1 });
reportSchema.index({ targetOwnerId: 1, status: 1 });

// Unique partial index: exactly one pending report per target per user
reportSchema.index(
  { reporterId: 1, targetType: 1, targetId: 1 },
  { unique: true, partialFilterExpression: { status: 'pending' } },
);

export const Report = mongoose.models.Report || mongoose.model('Report', reportSchema);
export default Report;
