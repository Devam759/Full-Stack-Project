/**
 * @file apps/api/src/modules/notifications/notificationService.js
 * Business logic for in-app notifications.
 */

import { Notification } from '@borrowloop/server-core';
import { AppError, ERROR_CODES } from '@borrowloop/shared';

/**
 * Lists notifications for a user with unread count and cursor pagination.
 */
export async function listNotifications(
  userId,
  { limit = 20, cursor = null, unreadOnly = false } = {},
) {
  const query = { userId };
  if (unreadOnly) {
    query.readAt = null;
  }

  if (cursor) {
    const cursorNotif = await Notification.findById(cursor);
    if (cursorNotif) {
      query.createdAt = { $lt: cursorNotif.createdAt };
    }
  }

  const [notifications, unreadCount] = await Promise.all([
    Notification.find(query).sort({ createdAt: -1 }).limit(limit).lean(),
    Notification.countDocuments({ userId, readAt: null }),
  ]);

  const nextCursor =
    notifications.length === limit ? notifications[notifications.length - 1]._id.toString() : null;

  return {
    notifications: notifications.map((n) => ({
      id: n._id.toString(),
      type: n.type,
      title: n.title,
      body: n.body,
      link: n.link,
      metadata: n.metadata,
      readAt: n.readAt,
      createdAt: n.createdAt,
    })),
    unreadCount,
    nextCursor,
  };
}

/**
 * Marks a specific notification as read.
 */
export async function markNotificationAsRead(userId, notificationId) {
  const notification = await Notification.findOne({ _id: notificationId, userId });
  if (!notification) {
    throw new AppError(ERROR_CODES.NOTIFICATION_NOT_FOUND, 'Notification not found', 404);
  }

  if (!notification.readAt) {
    notification.readAt = new Date();
    await notification.save();
  }

  return {
    notification: {
      id: notification._id.toString(),
      type: notification.type,
      title: notification.title,
      body: notification.body,
      link: notification.link,
      readAt: notification.readAt,
      createdAt: notification.createdAt,
    },
  };
}

/**
 * Marks all unread notifications for a user as read.
 */
export async function markAllNotificationsAsRead(userId) {
  const now = new Date();
  const result = await Notification.updateMany({ userId, readAt: null }, { $set: { readAt: now } });

  return { markedCount: result.modifiedCount };
}
