/**
 * @file apps/api/src/models/DomainEvent.js
 * Mongoose model for persisted domain events.
 * Settle-once and idempotency guaranteed via unique compound eventKey.
 */

import mongoose from 'mongoose';

const domainEventSchema = new mongoose.Schema(
  {
    eventKey: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
    },
    type: {
      type: String,
      required: true,
      index: true,
      trim: true,
    },
    bookingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Booking',
      default: null,
      index: true,
    },
    actorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    payload: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    timestamp: {
      type: Date,
      default: Date.now,
      index: true,
    },
    // Outbox pattern fields (Phase 6)
    status: {
      type: String,
      enum: ['pending', 'processing', 'processed', 'failed', 'dead_letter'],
      default: 'pending',
      index: true,
    },
    retryCount: {
      type: Number,
      default: 0,
    },
    nextRetryAt: {
      type: Date,
      default: null,
      index: true,
    },
    processedAt: {
      type: Date,
      default: null,
    },
    error: {
      type: String,
      default: null,
    },
    lockedAt: {
      type: Date,
      default: null,
      index: true,
    },
    claimToken: {
      type: String,
      default: null,
      index: true,
    },
  },
  {
    timestamps: true,
  },
);

domainEventSchema.index({ bookingId: 1, type: 1 });
domainEventSchema.index({ createdAt: -1 });
domainEventSchema.index({ status: 1, nextRetryAt: 1, lockedAt: 1, createdAt: 1 });
domainEventSchema.index({ status: 1, nextRetryAt: 1, createdAt: 1 });

export const DomainEvent =
  mongoose.models.DomainEvent || mongoose.model('DomainEvent', domainEventSchema);
export default DomainEvent;
