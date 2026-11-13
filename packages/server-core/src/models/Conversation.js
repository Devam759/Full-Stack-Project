/**
 * @file packages/server-core/src/models/Conversation.js
 * Mongoose model for per-booking conversations.
 * Exactly two participants: borrower and lender.
 */

import mongoose from 'mongoose';

const confirmedPinSchema = new mongoose.Schema(
  {
    lat: { type: Number, required: true },
    lng: { type: Number, required: true },
    label: { type: String, required: true, maxlength: 100 },
    proposedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    confirmedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    confirmedAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const conversationSchema = new mongoose.Schema(
  {
    bookingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Booking',
      required: true,
      unique: true,
      index: true,
    },
    participantIds: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
      required: true,
      validate: [
        (val) => Array.isArray(val) && val.length === 2,
        'Conversation must have exactly 2 participants',
      ],
      index: true,
    },
    lastMessageAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
    confirmedPin: {
      type: confirmedPinSchema,
      default: null,
    },
  },
  {
    timestamps: true,
  },
);

const Conversation =
  mongoose.models.Conversation || mongoose.model('Conversation', conversationSchema);

export default Conversation;
