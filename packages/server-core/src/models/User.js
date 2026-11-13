import mongoose from 'mongoose';
import { BUSINESS_CONFIG } from '@borrowloop/shared';

const UserSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 50,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    emailVerified: {
      type: Boolean,
      default: false,
    },
    passwordHash: {
      type: String,
      required: true,
      select: false, // Don't return in queries by default
    },
    photoUrl: {
      type: String,
      trim: true,
      default: null,
    },
    phone: {
      type: String,
      trim: true,
      default: null,
    },
    role: {
      type: String,
      enum: ['user', 'care_agent', 'admin'],
      default: 'user',
    },
    status: {
      type: String,
      enum: ['active', 'banned', 'frozen', 'deleted'],
      default: 'active',
      index: true,
    },
    banUntil: {
      type: Date,
      default: null,
    },
    strikes: {
      type: Number,
      default: 0,
      min: 0,
    },
    trustScore: {
      type: Number,
      default: BUSINESS_CONFIG.INITIAL_TRUST_SCORE,
      min: BUSINESS_CONFIG.MIN_TRUST_SCORE,
      max: BUSINESS_CONFIG.MAX_TRUST_SCORE,
    },
    ratingAvg: {
      type: Number,
      default: 0,
      min: 0,
      max: 5,
    },
    ratingCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    approxLocation: {
      type: {
        type: String,
        enum: ['Point'],
        default: 'Point',
      },
      coordinates: {
        type: [Number], // [longitude, latitude]
        default: [0, 0],
      },
    },
    totpSecret: {
      type: String,
      default: null,
      select: false, // Never return in queries
    },
    lastTotpStep: {
      type: Number,
      default: 0,
      select: false,
    },
    termsAcceptedAt: {
      type: Date,
      default: Date.now,
    },
    ageConfirmedAt: {
      type: Date,
      default: Date.now,
    },
    lastLoginAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform: (_doc, ret) => {
        delete ret.passwordHash;
        delete ret.totpSecret;
        delete ret.lastTotpStep;
        delete ret.__v;
        return ret;
      },
    },
    toObject: {
      transform: (_doc, ret) => {
        delete ret.passwordHash;
        delete ret.totpSecret;
        delete ret.lastTotpStep;
        delete ret.__v;
        return ret;
      },
    },
  },
);

// 2dsphere index for location queries
UserSchema.index({ approxLocation: '2dsphere' });

export const User = mongoose.models.User || mongoose.model('User', UserSchema);
export default User;
