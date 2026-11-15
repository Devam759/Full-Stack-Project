/**
 * @file packages/shared/src/schemas/reportSchemas.js
 * Zod validation schemas for reporting items, users, messages, and care moderation actions.
 */

import { z } from 'zod';
import { BUSINESS_CONFIG } from '../config.js';

export const createReportSchema = z
  .object({
    targetType: z.enum(['item', 'user', 'message'], {
      errorMap: () => ({ message: "targetType must be 'item', 'user', or 'message'" }),
    }),
    targetId: z.string().min(1, 'targetId is required'),
    reason: z.string().min(1, 'reason is required'),
    details: z
      .string()
      .max(
        BUSINESS_CONFIG.REPORTS?.DETAILS_MAX_LENGTH || 1000,
        `Details cannot exceed ${BUSINESS_CONFIG.REPORTS?.DETAILS_MAX_LENGTH || 1000} characters`,
      )
      .optional()
      .default(''),
  })
  .refine(
    (data) => {
      const allowed = BUSINESS_CONFIG.REPORTS?.REASONS?.[data.targetType];
      return allowed && allowed.includes(data.reason);
    },
    {
      message: 'Invalid report reason for specified targetType',
      path: ['reason'],
    },
  );

export const careReportActionSchema = z.object({
  action: z.enum(
    BUSINESS_CONFIG.REPORTS?.CARE_ACTIONS || [
      'dismiss',
      'hide_item',
      'remove_item',
      'restore_item',
      'warn_user',
      'strike_user',
    ],
    {
      errorMap: () => ({ message: 'Invalid care moderation action' }),
    },
  ),
  notes: z
    .string()
    .max(
      BUSINESS_CONFIG.DISPUTES?.NOTE_MAX_LENGTH || 2000,
      `Action note cannot exceed ${BUSINESS_CONFIG.DISPUTES?.NOTE_MAX_LENGTH || 2000} characters`,
    )
    .optional(),
  note: z
    .string()
    .max(
      BUSINESS_CONFIG.DISPUTES?.NOTE_MAX_LENGTH || 2000,
      `Action note cannot exceed ${BUSINESS_CONFIG.DISPUTES?.NOTE_MAX_LENGTH || 2000} characters`,
    )
    .optional(),
});

export const listReportsQuerySchema = z.object({
  status: z.enum(['pending', 'reviewed']).optional(),
  targetType: z.enum(['item', 'user', 'message']).optional(),
  cursor: z.string().optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(BUSINESS_CONFIG.MAX_PAGE_LIMIT || 50)
    .default(BUSINESS_CONFIG.DEFAULT_PAGE_LIMIT || 20),
});
