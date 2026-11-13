/**
 * @file apps/api/src/modules/chat/chatService.js
 * Business logic for per-booking chat, map pin proposals, confirmation, and read state.
 */

import mongoose from 'mongoose';
import {
  Booking,
  Item,
  Conversation,
  Message,
  Notification,
  Block,
  User,
  runInTransactionWithRetry,
} from '@borrowloop/server-core';
import { AppError, ERROR_CODES, BUSINESS_CONFIG, haversineDistanceKm } from '@borrowloop/shared';
import { emitToConversation, emitToUser } from '../../sockets/socketServer.js';

const TERMINAL_STATUSES = ['completed', 'cancelled', 'expired'];

/**
 * Validates that the caller is an active participant (borrower or lender) without block relations.
 * Staff roles (care_agent, admin) must not use participant routes (must use portal routes).
 *
 * @param {string|import('mongoose').Types.ObjectId} bookingId
 * @param {string|import('mongoose').Types.ObjectId} userId
 * @param {string} [role='user']
 * @returns {Promise<{ booking: import('@borrowloop/server-core').Booking, conversation: import('@borrowloop/server-core').Conversation, isBorrower: boolean, isLender: boolean }>}
 */
export async function getAuthorizedBookingAndConversation(bookingId, userId, role = 'user') {
  const booking = await Booking.findById(bookingId);
  if (!booking) {
    throw new AppError(ERROR_CODES.BOOKING_NOT_FOUND, 'Booking not found', 404);
  }

  const userIdStr = userId.toString();
  const isBorrower = booking.borrowerId.toString() === userIdStr;
  const isLender = booking.lenderId.toString() === userIdStr;

  // Item 3: Participant access check.
  // Allow an admin or agent account that is also a participant to use participant routes for their own bookings.
  // Non-participants (including staff) are strictly forbidden.
  if (!isBorrower && !isLender) {
    if (role === 'care_agent' || role === 'admin') {
      throw new AppError(
        ERROR_CODES.FORBIDDEN,
        'Staff must not use participant routes for non-participant bookings',
        403,
      );
    }
    throw new AppError(
      ERROR_CODES.FORBIDDEN,
      'You are not authorized to access this booking chat',
      403,
    );
  }

  // Item 9: Reject non-active users
  const user = await User.findById(userId);
  if (!user || user.status !== 'active') {
    throw new AppError(
      user?.status === 'banned'
        ? ERROR_CODES.ACCOUNT_BANNED
        : user?.status === 'frozen'
          ? ERROR_CODES.ACCOUNT_FROZEN
          : ERROR_CODES.FORBIDDEN,
      `User account is ${user?.status || 'inactive'}`,
      403,
    );
  }

  // Item 9: Reject blocked relationships
  const otherParticipantId = isBorrower ? booking.lenderId : booking.borrowerId;
  const isBlocked = await Block.exists({
    $or: [
      { blockerId: userId, blockedId: otherParticipantId },
      { blockerId: otherParticipantId, blockedId: userId },
    ],
  });

  if (isBlocked) {
    throw new AppError(
      ERROR_CODES.USER_BLOCKED,
      'Cannot access chat because a user block is in effect between participants',
      403,
    );
  }

  // Item 14: Handle Conversation lazy-create duplicate key race
  let conversation = await Conversation.findOne({ bookingId: booking._id });
  if (!conversation) {
    try {
      conversation = await Conversation.create({
        bookingId: booking._id,
        participantIds: [booking.borrowerId, booking.lenderId],
        lastMessageAt: booking.createdAt || new Date(),
      });
    } catch (err) {
      if (err.code === 11000) {
        conversation = await Conversation.findOne({ bookingId: booking._id });
      } else {
        throw err;
      }
    }
  }

  return { booking, conversation, isBorrower, isLender };
}

/**
 * Encodes a keyset cursor { createdAt, id } into an opaque base64url string.
 */
function encodeCursor(createdAt, id) {
  return Buffer.from(
    JSON.stringify({
      createdAt:
        createdAt instanceof Date ? createdAt.toISOString() : new Date(createdAt).toISOString(),
      id: id.toString(),
    }),
  ).toString('base64url');
}

/**
 * Decodes and validates an opaque base64url keyset cursor.
 * Throws HTTP 400 on malformed/garbage cursors.
 */
function decodeCursor(cursor) {
  if (!cursor) return null;
  try {
    const raw = Buffer.from(cursor, 'base64url').toString('utf8');
    const parsed = JSON.parse(raw);
    if (
      !parsed.createdAt ||
      !parsed.id ||
      !mongoose.Types.ObjectId.isValid(parsed.id) ||
      isNaN(new Date(parsed.createdAt).getTime())
    ) {
      throw new Error('Malformed cursor payload');
    }
    return {
      createdAt: new Date(parsed.createdAt),
      id: new mongoose.Types.ObjectId(parsed.id),
    };
  } catch {
    throw new AppError(ERROR_CODES.BAD_REQUEST, 'Invalid pagination cursor', 400);
  }
}

/**
 * Lists messages for a booking conversation with keyset pagination.
 * - Initial load and "before" return the newest page in chronological order.
 * - "after" returns newer messages ascending.
 * - Keyset on (createdAt, _id) with opaque cursor (400 on garbage).
 */
export async function listMessages(
  bookingId,
  userId,
  { limit = 30, cursor = null, direction = 'before' } = {},
  role = 'user',
) {
  const { conversation } = await getAuthorizedBookingAndConversation(bookingId, userId, role);
  const parsedCursor = decodeCursor(cursor);

  const query = { conversationId: conversation._id };
  let sort = { createdAt: -1, _id: -1 };

  if (direction === 'after') {
    sort = { createdAt: 1, _id: 1 };
    if (parsedCursor) {
      query.$or = [
        { createdAt: { $gt: parsedCursor.createdAt } },
        { createdAt: parsedCursor.createdAt, _id: { $gt: parsedCursor.id } },
      ];
    }
  } else {
    // direction === 'before' or initial load
    sort = { createdAt: -1, _id: -1 };
    if (parsedCursor) {
      query.$or = [
        { createdAt: { $lt: parsedCursor.createdAt } },
        { createdAt: parsedCursor.createdAt, _id: { $lt: parsedCursor.id } },
      ];
    }
  }

  const rawMessages = await Message.find(query).sort(sort).limit(limit).lean();

  // If queried newest-first (before/initial), reverse array to display ascending chronological order
  const messages = direction === 'after' ? rawMessages : [...rawMessages].reverse();

  let nextCursor = null;
  if (rawMessages.length === limit) {
    // For "before", nextCursor is the oldest message so caller can fetch even older
    // For "after", nextCursor is the newest message
    const boundary =
      direction === 'after'
        ? rawMessages[rawMessages.length - 1]
        : rawMessages[rawMessages.length - 1];
    nextCursor = encodeCursor(boundary.createdAt, boundary._id);
  }

  return {
    messages: messages.map((m) => ({
      id: m._id.toString(),
      conversationId: m.conversationId.toString(),
      bookingId: m.bookingId.toString(),
      senderId: m.senderId.toString(),
      clientMessageId: m.clientMessageId,
      type: m.type,
      text: m.text,
      pin: m.pin,
      readBy: (m.readBy || []).map((id) => id.toString()),
      createdAt: m.createdAt,
      cursor: encodeCursor(m.createdAt, m._id),
    })),
    conversation: {
      id: conversation._id.toString(),
      bookingId: conversation.bookingId.toString(),
      lastMessageAt: conversation.lastMessageAt,
      confirmedPin: conversation.confirmedPin,
    },
    nextCursor,
  };
}

/**
 * Sends a message (text or pin) in the conversation.
 */
export async function sendMessage(bookingId, userId, messageData, role = 'user') {
  const { booking, conversation } = await getAuthorizedBookingAndConversation(
    bookingId,
    userId,
    role,
  );

  if (TERMINAL_STATUSES.includes(booking.status)) {
    throw new AppError(
      ERROR_CODES.BOOKING_TERMINAL_CHAT_CLOSED,
      `Chat is closed because the booking is ${booking.status}`,
      409,
    );
  }

  let pinData = null;
  if (messageData.type === 'pin') {
    const item = await Item.findById(booking.itemId);
    // Item 10: Always enforce distance rule (reject when item has no location coordinates)
    if (!item?.location?.coordinates || item.location.coordinates.length < 2) {
      throw new AppError(
        ERROR_CODES.BAD_REQUEST,
        'Cannot propose meeting pin because item has no location coordinates',
        400,
      );
    }

    const [itemLng, itemLat] = item.location.coordinates;
    const distance = haversineDistanceKm(
      itemLat,
      itemLng,
      messageData.pin.lat,
      messageData.pin.lng,
    );
    if (distance > BUSINESS_CONFIG.CHAT.MAX_PIN_RADIUS_KM) {
      throw new AppError(
        ERROR_CODES.PIN_OUT_OF_BOUNDS,
        `Proposed meeting pin cannot be more than ${BUSINESS_CONFIG.CHAT.MAX_PIN_RADIUS_KM} km from the item location`,
        400,
      );
    }

    // Item 4: Keep conversation.confirmedPin until the NEW pin is confirmed.
    // A mere proposal must NOT clear an agreed place.
    // Mark prior unconfirmed proposed pins as superseded.
    await Message.updateMany(
      {
        conversationId: conversation._id,
        type: 'pin',
        'pin.status': 'proposed',
      },
      {
        $set: { 'pin.status': 'superseded' },
      },
    );

    pinData = {
      lat: messageData.pin.lat,
      lng: messageData.pin.lng,
      label: messageData.pin.label || null,
      status: 'proposed',
    };
  }

  let message;
  try {
    message = await Message.create({
      conversationId: conversation._id,
      bookingId: booking._id,
      senderId: userId,
      clientMessageId: messageData.clientMessageId,
      type: messageData.type,
      text: messageData.text || null,
      pin: pinData,
      readBy: [userId],
    });
  } catch (err) {
    if (err.code === 11000) {
      // Idempotent retry: return existing message with this clientMessageId
      const existing = await Message.findOne({
        conversationId: conversation._id,
        senderId: userId,
        clientMessageId: messageData.clientMessageId,
      });
      if (existing) {
        return {
          id: existing._id.toString(),
          conversationId: existing.conversationId.toString(),
          bookingId: existing.bookingId.toString(),
          senderId: existing.senderId.toString(),
          clientMessageId: existing.clientMessageId,
          type: existing.type,
          text: existing.text,
          pin: existing.pin,
          readBy: (existing.readBy || []).map((id) => id.toString()),
          createdAt: existing.createdAt,
        };
      }
    }
    throw err;
  }

  // Update conversation lastMessageAt
  conversation.lastMessageAt = message.createdAt;
  await conversation.save();

  const payload = {
    id: message._id.toString(),
    conversationId: conversation._id.toString(),
    bookingId: booking._id.toString(),
    senderId: userId.toString(),
    clientMessageId: message.clientMessageId,
    type: message.type,
    text: message.text,
    pin: message.pin,
    readBy: [userId.toString()],
    createdAt: message.createdAt.toISOString(),
  };

  // Socket emissions (Messages are saved to DB before emit)
  const eventName = message.type === 'pin' ? 'pin:proposed' : 'message:new';
  emitToConversation(conversation._id.toString(), eventName, { message: payload });

  // In-app alert to recipient: one aggregated unread notification per conversation, in-app only, never email
  const recipientId =
    booking.borrowerId.toString() === userId.toString()
      ? booking.lenderId.toString()
      : booking.borrowerId.toString();

  try {
    const dedupeKey = `notif:chat:${conversation._id}:${recipientId}`;
    await Notification.findOneAndUpdate(
      { userId: recipientId, dedupeKey },
      {
        $set: {
          type: 'message_received',
          title: message.type === 'pin' ? 'Meeting place proposed' : 'New message',
          body:
            message.type === 'pin'
              ? 'A meetup pin was proposed for your booking.'
              : (message.text || '').slice(0, 100),
          link: `/bookings/${booking._id}`,
          readAt: null,
        },
        $setOnInsert: {
          createdAt: new Date(),
        },
      },
      { upsert: true, new: true },
    );

    emitToUser(recipientId, 'notification:new', {
      notification: {
        type: message.type === 'pin' ? 'pin_proposed' : 'message_received',
        title: message.type === 'pin' ? 'Meeting place proposed' : 'New message',
        body: 'You have a new update regarding your booking.',
        link: `/bookings/${booking._id}`,
        createdAt: new Date().toISOString(),
      },
    });
  } catch {
    // Non-blocking notification update
  }

  return payload;
}

/**
 * Convenience helper to propose a meetup pin.
 */
export async function proposePin(bookingId, userId, pinData, role = 'user') {
  return sendMessage(
    bookingId,
    userId,
    {
      type: 'pin',
      pin: {
        lat: pinData.lat,
        lng: pinData.lng,
        label: pinData.label || null,
      },
      clientMessageId: pinData.clientMessageId,
    },
    role,
  );
}

/**
 * Confirms a proposed map pin atomically.
 */
export async function confirmPin(bookingId, userId, role = 'user', messageId = null) {
  const { booking, conversation } = await getAuthorizedBookingAndConversation(
    bookingId,
    userId,
    role,
  );

  if (TERMINAL_STATUSES.includes(booking.status)) {
    throw new AppError(
      ERROR_CODES.BOOKING_TERMINAL_CHAT_CLOSED,
      `Cannot confirm meeting pin because booking is ${booking.status}`,
      409,
    );
  }

  let confirmedPinObj = null;

  await runInTransactionWithRetry(async (session) => {
    // Proposer is strictly forbidden from confirming their own proposal
    const targetPin = messageId
      ? await Message.findById(messageId).session(session)
      : await Message.findOne({
          conversationId: conversation._id,
          type: 'pin',
        })
          .sort({ createdAt: -1 })
          .session(session);

    if (targetPin && targetPin.senderId.toString() === userId.toString()) {
      throw new AppError(
        ERROR_CODES.CANNOT_CONFIRM_OWN_PIN,
        'Only the other party can confirm a proposed meeting place',
        403,
      );
    }

    // Item 4: Atomic conditional update on Message inside single transaction
    // Exclude proposer (senderId != userId)
    const confirmedMsg = await Message.findOneAndUpdate(
      {
        conversationId: conversation._id,
        type: 'pin',
        'pin.status': 'proposed',
        senderId: { $ne: userId },
      },
      {
        $set: { 'pin.status': 'confirmed' },
      },
      { new: true, sort: { createdAt: -1 }, session },
    );

    if (!confirmedMsg) {
      // Check if another concurrent confirm succeeded (idempotent winner resolution)
      const reloadedConv = await Conversation.findById(conversation._id).session(session);
      if (reloadedConv?.confirmedPin?.confirmedAt) {
        confirmedPinObj = reloadedConv.confirmedPin;
        return;
      }

      throw new AppError(
        ERROR_CODES.NO_ACTIVE_PIN_PROPOSAL,
        'No active proposed pin found to confirm',
        404,
      );
    }

    // Mark any prior confirmed pins as superseded
    await Message.updateMany(
      {
        conversationId: conversation._id,
        _id: { $ne: confirmedMsg._id },
        type: 'pin',
        'pin.status': 'confirmed',
      },
      {
        $set: { 'pin.status': 'superseded' },
      },
      { session },
    );

    confirmedPinObj = {
      lat: confirmedMsg.pin.lat,
      lng: confirmedMsg.pin.lng,
      label: confirmedMsg.pin.label || null,
      proposedBy: confirmedMsg.senderId,
      confirmedBy: userId,
      confirmedAt: new Date(),
    };

    await Conversation.updateOne(
      { _id: conversation._id },
      { $set: { confirmedPin: confirmedPinObj } },
      { session },
    );
  });

  emitToConversation(conversation._id.toString(), 'pin:confirmed', {
    confirmedPin: {
      lat: confirmedPinObj.lat,
      lng: confirmedPinObj.lng,
      label: confirmedPinObj.label,
      proposedBy: confirmedPinObj.proposedBy.toString(),
      confirmedBy: confirmedPinObj.confirmedBy.toString(),
      confirmedAt: confirmedPinObj.confirmedAt.toISOString
        ? confirmedPinObj.confirmedAt.toISOString()
        : new Date(confirmedPinObj.confirmedAt).toISOString(),
    },
  });

  return confirmedPinObj;
}

/**
 * Marks messages in a conversation as read by the user.
 */
export async function markMessagesAsRead(bookingId, userId, messageIds = null, role = 'user') {
  const { conversation } = await getAuthorizedBookingAndConversation(bookingId, userId, role);

  const query = {
    conversationId: conversation._id,
    readBy: { $ne: userId },
  };

  if (Array.isArray(messageIds) && messageIds.length > 0) {
    query._id = { $in: messageIds };
  }

  const result = await Message.updateMany(query, {
    $addToSet: { readBy: userId },
  });

  if (result.modifiedCount > 0) {
    emitToConversation(conversation._id.toString(), 'message:read', {
      conversationId: conversation._id.toString(),
      userId: userId.toString(),
      messageIds: messageIds || [],
    });
  }

  return { markedCount: result.modifiedCount };
}

export default {
  getAuthorizedBookingAndConversation,
  listMessages,
  sendMessage,
  proposePin,
  confirmPin,
  markMessagesAsRead,
};
