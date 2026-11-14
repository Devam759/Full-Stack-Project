/**
 * @file packages/server-core/src/models/Handover.js
 * Mongoose model for pickup and return handovers matching docs/DATABASE_SCHEMA.md.
 * Note: Never store latitude or longitude; compute distance and store distanceMeters only.
 */

import mongoose from 'mongoose';

const handoverPhotoSchema = new mongoose.Schema(
  {
    by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    publicId: {
      type: String,
      required: true,
    },
    url: {
      type: String,
      required: true,
    },
    capturedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false },
);

const handoverSchema = new mongoose.Schema(
  {
    bookingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Booking',
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: ['pickup', 'return'],
      required: true,
    },
    issuerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    scannerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    qrNonceHash: {
      type: String,
      default: null,
    },
    qrExpiresAt: {
      type: Date,
      default: null,
    },
    qrConsumedAt: {
      type: Date,
      default: null,
    },
    codeHmac: {
      type: String,
      default: null,
    },
    codeExpiresAt: {
      type: Date,
      default: null,
    },
    codeAttempts: {
      type: Number,
      default: 0,
    },
    lockedUntil: {
      type: Date,
      default: null,
    },
    scannedAt: {
      type: Date,
      default: null,
    },
    distanceMeters: {
      type: Number,
      default: null,
    },
    geoChecked: {
      type: Boolean,
      default: false,
    },
    fallbackCodeUsed: {
      type: Boolean,
      default: false,
    },
    photos: {
      type: [handoverPhotoSchema],
      default: [],
    },
  },
  {
    timestamps: true,
  },
);

// Indexes enforcing uniqueness and fast lookup
handoverSchema.index({ bookingId: 1, type: 1 }, { unique: true });
handoverSchema.index({ qrNonceHash: 1 }, { unique: true, sparse: true });
handoverSchema.index({ bookingId: 1, createdAt: 1 });

export const Handover = mongoose.models.Handover || mongoose.model('Handover', handoverSchema);
export default Handover;
