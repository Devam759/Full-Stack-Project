/**
 * @file packages/shared/src/schemas/chat.js
 * Zod schemas and sanitizers for Phase 6 Chat, Map Pin, and Messages.
 */

import { z } from 'zod';
import BUSINESS_CONFIG from '../config.js';

export const objectIdSchema = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid ObjectId');

/**
 * Strips HTML tags and unprintable ASCII control characters.
 * Preserves standard whitespace (\n, \r, \t).
 *
 * @param {string} input
 * @returns {string}
 */
export function sanitizeChatMessage(input) {
  if (!input || typeof input !== 'string') return '';
  // Strip script and style blocks entirely
  const withoutScripts = input
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');
  // Strip remaining HTML tags
  const withoutHtml = withoutScripts.replace(/<[^>]*>/g, '');
  // Strip non-printable ASCII control characters (0x00-0x08, 0x0B, 0x0C, 0x0E-0x1F, 0x7F)
  // Preserves \t (0x09), \n (0x0A), \r (0x0D)
  // eslint-disable-next-line no-control-regex
  return withoutHtml.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
}

/**
 * Calculates great-circle distance between two coordinates in kilometers using Haversine formula.
 *
 * @param {number} lat1
 * @param {number} lon1
 * @param {number} lat2
 * @param {number} lon2
 * @returns {number} Distance in kilometers
 */
export function haversineDistanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth's radius in km
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export const pinSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  label: z
    .string()
    .trim()
    .min(1, 'Pin label is required')
    .max(100, 'Pin label must not exceed 100 characters'),
});

export const createMessageSchema = z
  .object({
    clientMessageId: z
      .string()
      .min(8, 'clientMessageId must be at least 8 characters')
      .max(128, 'clientMessageId must not exceed 128 characters'),
    type: z.enum(['text', 'pin']).default('text'),
    text: z.string().optional(),
    pin: pinSchema.optional(),
  })
  .superRefine((val, ctx) => {
    if (val.type === 'text') {
      const sanitized = sanitizeChatMessage(val.text || '').trim();
      if (!sanitized) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Text message cannot be empty or whitespace only',
          path: ['text'],
        });
      } else if (sanitized.length > BUSINESS_CONFIG.CHAT.MAX_MESSAGE_LENGTH) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Text message cannot exceed ${BUSINESS_CONFIG.CHAT.MAX_MESSAGE_LENGTH} characters`,
          path: ['text'],
        });
      }
    } else if (val.type === 'pin') {
      if (!val.pin) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Pin payload is required for pin type message',
          path: ['pin'],
        });
      }
    }
  })
  .transform((val) => {
    if (val.type === 'text') {
      return {
        clientMessageId: val.clientMessageId,
        type: 'text',
        text: sanitizeChatMessage(val.text || '').trim(),
      };
    }
    return {
      clientMessageId: val.clientMessageId,
      type: 'pin',
      pin: val.pin,
    };
  });

export const confirmPinSchema = z.object({
  messageId: objectIdSchema.optional(),
});

export const listMessagesQuerySchema = z.object({
  limit: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val, 10) : BUSINESS_CONFIG.CHAT.DEFAULT_PAGE_LIMIT))
    .pipe(
      z
        .number()
        .int()
        .min(1)
        .max(
          BUSINESS_CONFIG.CHAT.MAX_PAGE_LIMIT,
          `Limit cannot exceed ${BUSINESS_CONFIG.CHAT.MAX_PAGE_LIMIT}`,
        ),
    ),
  cursor: z.string().optional(),
  direction: z.enum(['before', 'after']).default('before'),
});
