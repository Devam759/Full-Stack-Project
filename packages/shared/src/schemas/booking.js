/**
 * @file packages/shared/src/schemas/booking.js
 * Zod validation schemas for booking requests, transitions, queries, and extensions.
 */

import { z } from 'zod';
import { BUSINESS_CONFIG } from '../config.js';

const OBJECT_ID_REGEX = /^[0-9a-fA-F]{24}$/;
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export const createBookingSchema = z
  .object({
    itemId: z.string().regex(OBJECT_ID_REGEX, 'Invalid itemId format'),
    startDate: z.string().regex(DATE_REGEX, 'startDate must be in YYYY-MM-DD format'),
    endDate: z.string().regex(DATE_REGEX, 'endDate must be in YYYY-MM-DD format'),
  })
  .refine((data) => data.endDate >= data.startDate, {
    message: 'endDate must be on or after startDate',
    path: ['endDate'],
  });

export const cancelBookingSchema = z.object({
  reason: z.string().max(500, 'Cancellation reason cannot exceed 500 characters').optional(),
});

export const rejectBookingSchema = z.object({
  reason: z.string().max(500, 'Rejection reason cannot exceed 500 characters').optional(),
});

export const createExtensionSchema = z
  .object({
    newEndDate: z.string().regex(DATE_REGEX, 'newEndDate must be in YYYY-MM-DD format').optional(),
    requestedEndDate: z
      .string()
      .regex(DATE_REGEX, 'requestedEndDate must be in YYYY-MM-DD format')
      .optional(),
  })
  .refine((data) => data.newEndDate || data.requestedEndDate, {
    message: 'Either newEndDate or requestedEndDate is required',
    path: ['requestedEndDate'],
  });

export const bookingQuerySchema = z.object({
  role: z.enum(['borrower', 'lender']).optional(),
  status: z.enum(BUSINESS_CONFIG.BOOKING_STATUSES).optional(),
  cursor: z.string().optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(BUSINESS_CONFIG.MAX_PAGE_LIMIT)
    .default(BUSINESS_CONFIG.DEFAULT_PAGE_LIMIT),
});
