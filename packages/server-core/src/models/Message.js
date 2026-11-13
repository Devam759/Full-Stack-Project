/**
 * @file packages/server-core/src/models/Message.js
 * Mongoose model for messages in a per-booking conversation.
 */

import mongoose from 'mongoose';
import crypto from 'node:crypto';

const pinPayloadSchema = new mongoose.Schema(
  {
    lat: { type: Number, required: true },
    lng: { type: Number, required: true },
    label: { type: String, required: true, maxlength: 100 },
    status: {
      type: String,
      enum: ['proposed', 'confirmed'],
      default: 'proposed',
    },
  },
  { _id: false },
);

const messageSchema = new mongoose.Schema(
  {
    conversationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Conversation',
      required: true,
      index: true,
    },
    bookingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Booking',
      required: true,
      index: true,
    },
    senderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    clientMessageId: {
      type: String,
      required: true,
      minlength: 8,
      maxlength: 128,
      default: () => `sys-${crypto.randomUUID()}`,
    },
    type: {
      type: String,
      enum: ['text', 'pin', 'system'],
      default: 'text',
      required: true,
    },
    text: {
      type: String,
      maxlength: 1000,
      default: null,
    },
    pin: {
      type: pinPayloadSchema,
      default: null,
    },
    readBy: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
      default: [],
    },
  },
  {
    timestamps: true,
  },
);

messageSchema.index({ conversationId: 1, createdAt: 1 });
messageSchema.index({ bookingId: 1, createdAt: 1 });
messageSchema.index(
  { conversationId: 1, senderId: 1, clientMessageId: 1 },
  { unique: true, name: 'uniq_conversation_sender_client_message_id' },
);

const Message = mongoose.models.Message || mongoose.model('Message', messageSchema);

export default Message;
