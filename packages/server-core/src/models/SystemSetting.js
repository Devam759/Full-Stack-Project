/**
 * @file packages/server-core/src/models/SystemSetting.js
 * Model for platform-wide system settings (e.g., ads.masterEnabled, ads.clientId).
 */

import mongoose from 'mongoose';

const systemSettingSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true,
    },
    value: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  {
    timestamps: true,
  },
);

export const SystemSetting =
  mongoose.models.SystemSetting || mongoose.model('SystemSetting', systemSettingSchema);
export default SystemSetting;
