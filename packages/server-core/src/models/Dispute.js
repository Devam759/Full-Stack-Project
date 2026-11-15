/**
 * @file packages/server-core/src/models/Dispute.js
 * Mongoose model for Disputes matching docs/DATABASE_SCHEMA.md and Phase 8 specifications.
 */

import mongoose from 'mongoose';
import { BUSINESS_CONFIG } from '@borrowloop/shared';

const { DISPUTES } = BUSINESS_CONFIG;

const evidencePhotoSchema = new mongoose.Schema(
  {
    publicId: {
      type: String,
      default: '',
    },
    url: {
      type: String,
      required: true,
    },
  },
  { _id: false },
);

const evidenceSchema = new mongoose.Schema(
  {
    by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    notes: {
      type: String,
      required: true,
      maxlength: DISPUTES.NOTE_MAX_LENGTH || 2000,
    },
    photos: {
      type: [evidencePhotoSchema],
      default: [],
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: true },
);

const statusHistorySchema = new mongoose.Schema(
  {
    status: {
      type: String,
      enum: DISPUTES.STATUSES,
      required: true,
    },
    changedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    note: {
      type: String,
      default: '',
    },
    changedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false },
);

const decisionSchema = new mongoose.Schema(
  {
    decidedById: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    decidedAt: {
      type: Date,
      default: null,
    },
    depositToLenderPaise: {
      type: Number,
      default: 0,
      min: 0,
    },
    depositToBorrowerPaise: {
      type: Number,
      default: 0,
      min: 0,
    },
    appliedLateChargePaise: {
      type: Number,
      default: 0,
      min: 0,
    },
    rentOutcome: {
      type: String,
      enum: ['lender', 'refund_borrower'],
      default: null,
    },
    faultUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    penaltyKind: {
      type: String,
      enum: ['lost_dispute', 'rejected_damage_claim', 'no_show', 'none'],
      default: 'none',
    },
    borrowerAccountAction: {
      type: String,
      enum: ['none', 'unfreeze', 'keep_frozen', 'warn', 'strike'],
      default: 'none',
    },
    note: {
      type: String,
      default: '',
    },
    internalNote: {
      type: String,
      default: '',
    },
    settlement: {
      lenderPayoutPaise: { type: Number, default: 0 },
      commissionPaise: { type: Number, default: 0 },
      borrowerRefundPaise: { type: Number, default: 0 },
    },
  },
  { _id: false },
);

const appealSchema = new mongoose.Schema(
  {
    appealedById: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    appealedAt: {
      type: Date,
      default: null,
    },
    reason: {
      type: String,
      default: '',
    },
    status: {
      type: String,
      enum: ['pending', 'upheld', 'overturned'],
      default: 'pending',
    },
    unrecoveredPaise: {
      type: Number,
      default: 0,
      min: 0,
    },
    revisedDecision: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    originalSettlementSnapshot: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    decidedById: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    decidedAt: {
      type: Date,
      default: null,
    },
    note: {
      type: String,
      default: '',
    },
  },
  { _id: false },
);

const disputeSchema = new mongoose.Schema(
  {
    bookingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Booking',
      required: true,
      unique: true,
      index: true,
    },
    disputeReason: {
      type: String,
      enum: DISPUTES.REASONS,
      required: true,
    },
    source: {
      type: String,
      enum: ['user', 'system'],
      required: true,
    },
    openedById: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },
    againstUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: DISPUTES.STATUSES,
      default: 'opened',
      required: true,
    },
    statusHistory: {
      type: [statusHistorySchema],
      default: [],
    },
    assignedAgentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    assignedAt: {
      type: Date,
      default: null,
    },
    evidence: {
      type: [evidenceSchema],
      default: [],
    },
    decision: {
      type: decisionSchema,
      default: null,
    },
    appeal: {
      type: appealSchema,
      default: null,
    },
    isEscalated: {
      type: Boolean,
      default: false,
    },
    escalatedAt: {
      type: Date,
      default: null,
    },
    closedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  },
);

// Compound indexes
disputeSchema.index({ status: 1, createdAt: -1 });
disputeSchema.index({ assignedAgentId: 1, status: 1 });

const Dispute = mongoose.models.Dispute || mongoose.model('Dispute', disputeSchema);

export default Dispute;
