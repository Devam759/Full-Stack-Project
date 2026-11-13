/**
 * @file apps/api/src/modules/notifications/notificationController.js
 * HTTP controllers for notification endpoints.
 */

import * as notificationService from './notificationService.js';

export async function listNotifications(req, res, next) {
  try {
    const { limit, cursor, unreadOnly } = req.query;
    const result = await notificationService.listNotifications(req.user.id, {
      limit,
      cursor,
      unreadOnly,
    });
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

export async function markNotificationAsRead(req, res, next) {
  try {
    const { id } = req.params;
    const result = await notificationService.markNotificationAsRead(req.user.id, id);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

export async function markAllNotificationsAsRead(req, res, next) {
  try {
    const result = await notificationService.markAllNotificationsAsRead(req.user.id);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}
