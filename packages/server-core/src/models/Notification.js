/**
 * @file packages/server-core/src/models/Notification.js
 * Mongoose model for in-app notifications.
 * Features:
 * - 90-day TTL index on createdAt per docs/DATABASE_SCHEMA.md
 * - Compound index on (userId, readAt, createdAt) for rapid unread badge queries
 * - Unique sparse dedupeKey preventing duplicate notifications
 */

import mongoose from 'mongoose';
import { BUSINESS_CONFIG } from '@borrowloop/shared';

const notificationSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    type: {
      type: String,
      required: true,
    },
    title: {
      type: String,
      required: true,
      maxlength: 120,
    },
    body: {
      type: String,
      required: true,
      maxlength: 500,
    },
    link: {
      type: String,
      default: null,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    readAt: {
      type: Date,
      default: null,
    },
    emailSent: {
      type: Boolean,
      default: false,
    },
    dedupeKey: {
      type: String,
      unique: true,
      sparse: true,
      index: true,
    },
  },
  {
    timestamps: true,
  },
);

// Rapid unread badge and notification listing index
notificationSchema.index({ userId: 1, readAt: 1, createdAt: -1 });

// TTL index for automatic expiration after 90 days
notificationSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: BUSINESS_CONFIG.NOTIFICATIONS.TTL_SECONDS },
);

const Notification =
  mongoose.models.Notification || mongoose.model('Notification', notificationSchema);

export default Notification;
