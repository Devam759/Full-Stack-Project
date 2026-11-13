/**
 * @file apps/api/src/models/ItemDayLock.js
 * Mongoose schema for item date availability locks.
 * Strictly tracks booked/locked days (YYYY-MM-DD) per item.
 */

import mongoose from 'mongoose';

const itemDayLockSchema = new mongoose.Schema(
  {
    itemId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Item',
      required: true,
      index: true,
    },
    day: {
      type: String,
      required: true,
      match: /^\d{4}-\d{2}-\d{2}$/,
    },
    bookingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Booking',
      default: null,
      index: true,
    },
  },
  {
    timestamps: true,
  },
);

// Compound unique index ensuring an item can only be locked once per day
itemDayLockSchema.index({ itemId: 1, day: 1 }, { unique: true });

export const ItemDayLock =
  mongoose.models.ItemDayLock || mongoose.model('ItemDayLock', itemDayLockSchema);
export default ItemDayLock;
