/**
 * @file packages/server-core/src/models/TrustEvent.js
 * Mongoose model for append-only trust events.
 * Used for deterministic, idempotent calculation of trust score, strikes, and on-time records.
 */

import mongoose from 'mongoose';

const trustEventSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: [
        'on_time_completed',
        'rating',
        'late_cancel',
        'lost_dispute',
        'no_show',
        'rejected_damage_claim',
        'strike',
        'strike_reversed',
        'penalty_reversed',
      ],
      required: true,
    },
    delta: {
      type: Number,
      default: null,
    },
    bookingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Booking',
      default: null,
    },
    counterpartyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    role: {
      type: String,
      enum: ['lend', 'borrow', 'lender', 'borrower'],
      default: null,
    },
    eventKey: {
      type: String,
      required: true,
      unique: true,
    },
    meta: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: false,
    versionKey: false,
  },
);

// Compound index for user trust history queries
trustEventSchema.index({ userId: 1, createdAt: 1 });

const TrustEvent = mongoose.models.TrustEvent || mongoose.model('TrustEvent', trustEventSchema);

export default TrustEvent;
