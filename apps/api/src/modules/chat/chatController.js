/**
 * @file apps/api/src/modules/chat/chatController.js
 * HTTP controllers for per-booking chat endpoints.
 */

import * as chatService from './chatService.js';

export async function listMessages(req, res, next) {
  try {
    const { id: bookingId } = req.params;
    const { limit, cursor, direction } = req.query;
    const result = await chatService.listMessages(
      bookingId,
      req.user.id,
      { limit, cursor, direction },
      req.user.role,
    );
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

export async function sendMessage(req, res, next) {
  try {
    const { id: bookingId } = req.params;
    const message = await chatService.sendMessage(bookingId, req.user.id, req.body, req.user.role);
    res.status(201).json({ message });
  } catch (error) {
    next(error);
  }
}

export async function confirmPin(req, res, next) {
  try {
    const { id: bookingId } = req.params;
    const confirmedPin = await chatService.confirmPin(bookingId, req.user.id, req.user.role);
    res.status(200).json({ confirmedPin });
  } catch (error) {
    next(error);
  }
}

export async function markMessagesAsRead(req, res, next) {
  try {
    const { id: bookingId } = req.params;
    const { messageIds } = req.body;
    const result = await chatService.markMessagesAsRead(
      bookingId,
      req.user.id,
      messageIds,
      req.user.role,
    );
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}
