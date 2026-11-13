/**
 * @file packages/shared/src/schemas/notification.js
 * Zod schemas for Phase 6 Notifications.
 */

import { z } from 'zod';
import BUSINESS_CONFIG from '../config.js';

export const notificationQuerySchema = z.object({
  limit: z
    .string()
    .optional()
    .transform((val) =>
      val ? parseInt(val, 10) : BUSINESS_CONFIG.NOTIFICATIONS.DEFAULT_PAGE_LIMIT,
    )
    .pipe(
      z
        .number()
        .int()
        .min(1)
        .max(
          BUSINESS_CONFIG.NOTIFICATIONS.MAX_PAGE_LIMIT,
          `Limit cannot exceed ${BUSINESS_CONFIG.NOTIFICATIONS.MAX_PAGE_LIMIT}`,
        ),
    ),
  cursor: z.string().optional(),
  unreadOnly: z
    .string()
    .optional()
    .transform((val) => val === 'true'),
});
