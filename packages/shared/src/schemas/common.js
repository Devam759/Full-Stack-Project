/**
 * @file packages/shared/src/schemas/common.js
 * Shared Zod validation schemas.
 */

import { z } from 'zod';
import { BUSINESS_CONFIG } from '../config.js';

export const integerPaiseSchema = z
  .number({ invalid_type_error: 'Amount must be a number in paise' })
  .int('Paise amount must be an integer')
  .nonnegative('Paise amount cannot be negative')
  .max(Number.MAX_SAFE_INTEGER, 'Amount exceeds safe integer range');

export const walletPaiseSchema = integerPaiseSchema.max(
  BUSINESS_CONFIG.WALLET_CAP_PAISE,
  `Amount exceeds the maximum wallet cap of ₹${BUSINESS_CONFIG.WALLET_CAP_PAISE / 100}`,
);

export const paginationQuerySchema = z.object({
  limit: z.coerce
    .number()
    .int()
    .positive()
    .max(BUSINESS_CONFIG.MAX_PAGE_LIMIT)
    .default(BUSINESS_CONFIG.DEFAULT_PAGE_LIMIT),
  cursor: z.string().trim().optional(),
});

export const geoPointSchema = z.object({
  type: z.literal('Point'),
  coordinates: z.tuple([
    z.number().min(-180).max(180), // longitude
    z.number().min(-90).max(90), // latitude
  ]),
});

export const idempotencyKeySchema = z
  .string()
  .trim()
  .min(8, 'Idempotency-Key must be at least 8 characters')
  .max(128, 'Idempotency-Key must not exceed 128 characters');

export const standardErrorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.record(z.unknown()),
  }),
});
