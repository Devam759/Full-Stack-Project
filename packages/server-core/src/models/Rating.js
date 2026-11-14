/**
 * @file packages/server-core/src/models/Rating.js
 * Mongoose model for blind ratings between borrower and lender.
 * Ratings remain blind (unrevealed) until both parties submit or the reveal window expires.
 */

import mongoose from 'mongoose';
import { BUSINESS_CONFIG } from '@borrowloop/shared';

const ratingSchema = new mongoose.Schema(
  {
    bookingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Booking',
      required: true,
      index: true,
    },
    raterId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    rateeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    targetRole: {
      type: String,
      enum: ['lender', 'borrower'],
      required: true,
    },
    itemId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Item',
      default: null,
    },
    stars: {
      type: Number,
      required: true,
      min: 1,
      max: 5,
    },
    comment: {
      type: String,
      maxlength: BUSINESS_CONFIG.RATINGS?.COMMENT_MAX_LENGTH || 500,
      default: '',
    },
    isRevealed: {
      type: Boolean,
      default: false,
      index: true,
    },
    revealedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

// One rating per rater per booking
ratingSchema.index({ bookingId: 1, raterId: 1 }, { unique: true });

// Efficient lookups for revealed reviews of a user
ratingSchema.index({ rateeId: 1, isRevealed: 1, createdAt: -1 });

// Query for unrevealed ratings by booking
ratingSchema.index({ bookingId: 1, isRevealed: 1 });

const Rating = mongoose.models.Rating || mongoose.model('Rating', ratingSchema);

export default Rating;
