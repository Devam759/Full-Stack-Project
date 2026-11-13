/**
 * @file apps/api/src/models/Item.js
 * Mongoose model for Items available for borrowing in communities.
 */

import mongoose from 'mongoose';
import { BUSINESS_CONFIG } from '@borrowloop/shared';

const itemSchema = new mongoose.Schema(
  {
    ownerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
      minlength: 3,
      maxlength: 100,
    },
    description: {
      type: String,
      required: true,
      trim: true,
      minlength: 10,
      maxlength: 2000,
    },
    category: {
      type: String,
      required: true,
      enum: BUSINESS_CONFIG.ITEM_CATEGORIES,
    },
    condition: {
      type: String,
      required: true,
      enum: BUSINESS_CONFIG.ITEM_CONDITIONS,
    },
    photos: {
      type: [String],
      required: true,
      validate: [
        (val) => val.length >= 1 && val.length <= BUSINESS_CONFIG.MAX_ITEM_PHOTOS,
        `Must have between 1 and ${BUSINESS_CONFIG.MAX_ITEM_PHOTOS} photos`,
      ],
    },
    rentPerDayPaise: {
      type: Number,
      required: true,
      min: BUSINESS_CONFIG.MIN_RENT_PER_DAY_PAISE,
      max: BUSINESS_CONFIG.MAX_RENT_PER_DAY_PAISE,
    },
    depositPaise: {
      type: Number,
      required: true,
      min: BUSINESS_CONFIG.MIN_DEPOSIT_PAISE,
      max: BUSINESS_CONFIG.MAX_DEPOSIT_PAISE,
    },
    lateFeePerDayPaise: {
      type: Number,
      default: 0,
      min: 0,
      max: BUSINESS_CONFIG.MAX_LATE_FEE_PER_DAY_PAISE,
    },
    minDays: {
      type: Number,
      required: true,
      default: BUSINESS_CONFIG.MIN_BOOKING_DAYS,
      min: BUSINESS_CONFIG.MIN_BOOKING_DAYS,
      max: BUSINESS_CONFIG.MAX_BOOKING_DAYS,
    },
    maxDays: {
      type: Number,
      required: true,
      default: BUSINESS_CONFIG.MAX_BOOKING_DAYS,
      min: BUSINESS_CONFIG.MIN_BOOKING_DAYS,
      max: BUSINESS_CONFIG.MAX_BOOKING_DAYS,
    },
    communityIds: {
      type: [
        {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'Community',
        },
      ],
      default: [],
    },
    location: {
      type: {
        type: String,
        enum: ['Point'],
        default: 'Point',
      },
      coordinates: {
        type: [Number], // [longitude, latitude]
        required: true,
      },
    },
    status: {
      type: String,
      enum: BUSINESS_CONFIG.ITEM_STATUSES,
      default: 'active',
      index: true,
    },
    reportCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    ratingAvg: {
      type: Number,
      default: null,
      min: 1,
      max: 5,
    },
    ratingCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    electronicsWarningAcceptedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform: (doc, ret) => {
        // Strict Privacy Rule (Phase 3 refinement 8):
        // NEVER expose exact or approximate GPS coordinates in API responses.
        delete ret.location;
        delete ret.__v;
        return ret;
      },
    },
  },
);

// Indexes matching DATABASE_SCHEMA.md + owner index
itemSchema.index({ location: '2dsphere' });
itemSchema.index({ title: 'text', description: 'text' });
itemSchema.index({ communityIds: 1, status: 1, category: 1, createdAt: -1 });
itemSchema.index({ ownerId: 1, status: 1 });
itemSchema.index({ ownerId: 1 });

export const Item = mongoose.models.Item || mongoose.model('Item', itemSchema);
export default Item;
