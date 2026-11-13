/**
 * @file apps/api/src/modules/notifications/notificationRoutes.js
 * Express routes for notifications.
 */

import { Router } from 'express';
import { validate } from '../../common/validate.js';
import { authenticate } from '../../common/authMiddleware.js';
import { notificationQuerySchema } from '@borrowloop/shared';
import * as notificationController from './notificationController.js';

const router = Router();

router.use(authenticate());

router.get(
  '/',
  validate({ query: notificationQuerySchema }),
  notificationController.listNotifications,
);
router.post('/:id/read', notificationController.markNotificationAsRead);
router.post('/read-all', notificationController.markAllNotificationsAsRead);

export default router;
