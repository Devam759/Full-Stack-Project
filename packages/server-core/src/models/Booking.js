/**
 * @file apps/api/src/models/Booking.js
 * Mongoose model for bookings matching docs/DATABASE_SCHEMA.md.
 * Tracks the complete rental lifecycle, status timeline, and extensions.
 */

import mongoose from 'mongoose';
import { BUSINESS_CONFIG } from '@borrowloop/shared';

const statusHistorySchema = new mongoose.Schema(
  {
    fromStatus: {
      type: String,
      default: null,
    },
    toStatus: {
      type: String,
      required: true,
      enum: BUSINESS_CONFIG.BOOKING_STATUSES,
    },
    actorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    actorRole: {
      type: String,
      required: true,
      enum: ['borrower', 'lender', 'system', 'admin'],
    },
    reason: {
      type: String,
      default: null,
    },
    timestamp: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false },
);

const extensionItemSchema = new mongoose.Schema(
  {
    id: {
      type: String,
      default: () => new mongoose.Types.ObjectId().toString(),
    },
    requestedEndDate: {
      type: String,
      required: true,
      match: /^\d{4}-\d{2}-\d{2}$/,
    },
    extraDays: {
      type: Number,
      required: true,
      min: 1,
    },
    extraRentPaise: {
      type: Number,
      required: true,
      min: 0,
    },
    status: {
      type: String,
      enum: ['requested', 'accepted', 'rejected', 'cancelled', 'expired'],
      default: 'requested',
    },
    requestedAt: {
      type: Date,
      default: Date.now,
    },
    respondedAt: {
      type: Date,
      default: null,
    },
    expiresAt: {
      type: Date,
      default: null,
    },
    rejectionReason: {
      type: String,
      default: null,
    },
  },
  { _id: false },
);

const bookingSchema = new mongoose.Schema(
  {
    itemId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Item',
      required: true,
      index: true,
    },
    lenderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    borrowerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    startDate: {
      type: String,
      required: true,
      match: /^\d{4}-\d{2}-\d{2}$/,
    },
    endDate: {
      type: String,
      required: true,
      match: /^\d{4}-\d{2}-\d{2}$/,
    },
    dueAt: {
      type: Date,
      required: true,
    },
    expiresAt: {
      type: Date,
      required: true,
    },
    days: {
      type: Number,
      required: true,
      min: 1,
    },
    rentPaise: {
      type: Number,
      required: true,
      min: 0,
    },
    depositPaise: {
      type: Number,
      required: true,
      min: 0,
    },
    lateFeePerDayPaise: {
      type: Number,
      default: 0,
      min: 0,
    },
    commissionBps: {
      type: Number,
      default: BUSINESS_CONFIG.COMMISSION_BPS,
    },
    status: {
      type: String,
      enum: BUSINESS_CONFIG.BOOKING_STATUSES,
      default: 'requested',
      index: true,
    },
    statusHistory: {
      type: [statusHistorySchema],
      default: [],
    },
    pickupAt: {
      type: Date,
      default: null,
    },
    returnAt: {
      type: Date,
      default: null,
    },
    lateChargePaise: {
      type: Number,
      default: 0,
    },
    extensions: {
      type: [extensionItemSchema],
      default: [],
    },
    cancelledBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    cancelReason: {
      type: String,
      default: null,
    },
    isLateCancel: {
      type: Boolean,
      default: false,
    },
    handoverCodeHash: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

bookingSchema.virtual('extension').get(function () {
  if (!this.extensions || this.extensions.length === 0) return null;
  return this.extensions[this.extensions.length - 1];
});

// Compound indexes enforcing rules & query performance
bookingSchema.index({ borrowerId: 1, status: 1, createdAt: -1 });
bookingSchema.index({ lenderId: 1, status: 1, createdAt: -1 });
bookingSchema.index({ itemId: 1, startDate: 1, endDate: 1 });
bookingSchema.index({ status: 1, expiresAt: 1 });
bookingSchema.index({ status: 1, dueAt: 1 });

export const Booking = mongoose.models.Booking || mongoose.model('Booking', bookingSchema);
export default Booking;
