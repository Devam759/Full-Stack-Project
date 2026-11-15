/**
 * @file packages/server-core/src/models/AdSetting.js
 * Model for Google AdSense placement configurations.
 * Sourced per docs/DATABASE_SCHEMA.md: placement (unique), enabled, adsenseSlotId, pages[].
 */

import mongoose from 'mongoose';
import { BUSINESS_CONFIG } from '@borrowloop/shared';

const adSettingSchema = new mongoose.Schema(
  {
    placement: {
      type: String,
      required: true,
      unique: true,
      enum: BUSINESS_CONFIG.ADS.PLACEMENTS,
      index: true,
    },
    enabled: {
      type: Boolean,
      default: false,
    },
    adsenseSlotId: {
      type: String,
      default: '',
      trim: true,
    },
    pages: {
      type: [String],
      default: () => [...BUSINESS_CONFIG.ADS.ALLOWED_SCREENS],
    },
  },
  {
    timestamps: true,
  },
);

export const AdSetting = mongoose.models.AdSetting || mongoose.model('AdSetting', adSettingSchema);
export default AdSetting;
