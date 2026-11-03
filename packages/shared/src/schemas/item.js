/**
 * @file packages/shared/src/schemas/item.js
 * Zod validation schemas for Items, Search, and Availability (Phase 3).
 */

import { z } from 'zod';
import { BUSINESS_CONFIG } from '../config.js';

const sanitizeText = (val) =>
  typeof val === 'string'
    ? val
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
        .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
        .replace(/<[^>]*>?/gm, '')
        .replace(/\s+/g, ' ')
        .trim()
    : val;

export const createItemSchema = z
  .object({
    title: z
      .string()
      .transform(sanitizeText)
      .pipe(z.string().min(3, 'Title must be at least 3 characters').max(100, 'Title too long')),
    description: z
      .string()
      .transform(sanitizeText)
      .pipe(
        z
          .string()
          .min(10, 'Description must be at least 10 characters')
          .max(2000, 'Description too long'),
      ),
    category: z.enum(BUSINESS_CONFIG.ITEM_CATEGORIES, {
      errorMap: () => ({ message: 'Invalid or prohibited category' }),
    }),
    condition: z.enum(BUSINESS_CONFIG.ITEM_CONDITIONS, {
      errorMap: () => ({ message: 'Invalid item condition' }),
    }),
    photos: z
      .array(z.string().url('Each photo must be a valid URL'))
      .min(1, 'At least one photo is required')
      .max(
        BUSINESS_CONFIG.MAX_ITEM_PHOTOS,
        `Maximum ${BUSINESS_CONFIG.MAX_ITEM_PHOTOS} photos allowed`,
      ),
    rentPerDayPaise: z
      .number()
      .int('Rent must be an integer in paise')
      .min(
        BUSINESS_CONFIG.MIN_RENT_PER_DAY_PAISE,
        `Rent must be at least ${BUSINESS_CONFIG.MIN_RENT_PER_DAY_PAISE} paise`,
      )
      .max(
        BUSINESS_CONFIG.MAX_RENT_PER_DAY_PAISE,
        `Rent cannot exceed ${BUSINESS_CONFIG.MAX_RENT_PER_DAY_PAISE} paise`,
      ),
    depositPaise: z
      .number()
      .int('Deposit must be an integer in paise')
      .min(
        BUSINESS_CONFIG.MIN_DEPOSIT_PAISE,
        `Deposit must be at least ${BUSINESS_CONFIG.MIN_DEPOSIT_PAISE} paise`,
      )
      .max(
        BUSINESS_CONFIG.MAX_DEPOSIT_PAISE,
        `Deposit cannot exceed ${BUSINESS_CONFIG.MAX_DEPOSIT_PAISE} paise`,
      ),
    lateFeePerDayPaise: z
      .number()
      .int('Late fee must be an integer in paise')
      .min(0, 'Late fee cannot be negative')
      .max(
        BUSINESS_CONFIG.MAX_LATE_FEE_PER_DAY_PAISE,
        `Late fee cannot exceed ${BUSINESS_CONFIG.MAX_LATE_FEE_PER_DAY_PAISE} paise`,
      )
      .default(0),
    minDays: z
      .number()
      .int('minDays must be an integer')
      .min(
        BUSINESS_CONFIG.MIN_BOOKING_DAYS,
        `Minimum booking days is ${BUSINESS_CONFIG.MIN_BOOKING_DAYS}`,
      )
      .max(
        BUSINESS_CONFIG.MAX_BOOKING_DAYS,
        `Maximum booking days is ${BUSINESS_CONFIG.MAX_BOOKING_DAYS}`,
      )
      .default(BUSINESS_CONFIG.MIN_BOOKING_DAYS),
    maxDays: z
      .number()
      .int('maxDays must be an integer')
      .min(
        BUSINESS_CONFIG.MIN_BOOKING_DAYS,
        `Minimum booking days is ${BUSINESS_CONFIG.MIN_BOOKING_DAYS}`,
      )
      .max(
        BUSINESS_CONFIG.MAX_BOOKING_DAYS,
        `Maximum booking days is ${BUSINESS_CONFIG.MAX_BOOKING_DAYS}`,
      )
      .default(BUSINESS_CONFIG.MAX_BOOKING_DAYS),
    communityIds: z
      .array(z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid community ID format'))
      .min(1, 'Item must be listed in at least one community'),
    location: z
      .object({
        lat: z.number().min(-90).max(90),
        lng: z.number().min(-180).max(180),
      })
      .optional(),
    electronicsWarningAccepted: z.boolean().optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (data.minDays > data.maxDays) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['minDays'],
        message: 'minDays cannot be greater than maxDays',
      });
    }

    const totalPotentialExposure = data.rentPerDayPaise * data.maxDays + data.depositPaise;
    if (totalPotentialExposure > BUSINESS_CONFIG.WALLET_CAP_PAISE) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['depositPaise'],
        message: `Total rent (${data.rentPerDayPaise * data.maxDays} paise) plus deposit exceeds wallet cap (${BUSINESS_CONFIG.WALLET_CAP_PAISE} paise)`,
      });
    }

    if (
      BUSINESS_CONFIG.DATA_SENSITIVE_CATEGORIES.includes(data.category) &&
      !data.electronicsWarningAccepted
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['electronicsWarningAccepted'],
        message: 'You must acknowledge the data-reset warning for electronics and storage devices',
      });
    }
  });

export const updateItemSchema = z
  .object({
    title: z.string().transform(sanitizeText).pipe(z.string().min(3).max(100)).optional(),
    description: z.string().transform(sanitizeText).pipe(z.string().min(10).max(2000)).optional(),
    category: z.enum(BUSINESS_CONFIG.ITEM_CATEGORIES).optional(),
    condition: z.enum(BUSINESS_CONFIG.ITEM_CONDITIONS).optional(),
    photos: z.array(z.string().url()).min(1).max(BUSINESS_CONFIG.MAX_ITEM_PHOTOS).optional(),
    rentPerDayPaise: z
      .number()
      .int()
      .min(BUSINESS_CONFIG.MIN_RENT_PER_DAY_PAISE)
      .max(BUSINESS_CONFIG.MAX_RENT_PER_DAY_PAISE)
      .optional(),
    depositPaise: z
      .number()
      .int()
      .min(BUSINESS_CONFIG.MIN_DEPOSIT_PAISE)
      .max(BUSINESS_CONFIG.MAX_DEPOSIT_PAISE)
      .optional(),
    lateFeePerDayPaise: z
      .number()
      .int()
      .min(0)
      .max(BUSINESS_CONFIG.MAX_LATE_FEE_PER_DAY_PAISE)
      .optional(),
    minDays: z
      .number()
      .int()
      .min(BUSINESS_CONFIG.MIN_BOOKING_DAYS)
      .max(BUSINESS_CONFIG.MAX_BOOKING_DAYS)
      .optional(),
    maxDays: z
      .number()
      .int()
      .min(BUSINESS_CONFIG.MIN_BOOKING_DAYS)
      .max(BUSINESS_CONFIG.MAX_BOOKING_DAYS)
      .optional(),
    communityIds: z
      .array(z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid community ID format'))
      .min(1)
      .optional(),
    status: z.enum(['active', 'paused']).optional(),
    location: z
      .object({
        lat: z.number().min(-90).max(90),
        lng: z.number().min(-180).max(180),
      })
      .optional(),
    electronicsWarningAccepted: z.boolean().optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (data.minDays && data.maxDays && data.minDays > data.maxDays) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['minDays'],
        message: 'minDays cannot be greater than maxDays',
      });
    }
  });

export const itemSearchQuerySchema = z
  .object({
    q: z.string().transform(sanitizeText).optional(),
    category: z.enum(BUSINESS_CONFIG.ITEM_CATEGORIES).optional(),
    lat: z.coerce.number().min(-90).max(90).optional(),
    lng: z.coerce.number().min(-180).max(180).optional(),
    radius: z.coerce
      .number()
      .min(0.1)
      .max(BUSINESS_CONFIG.MAX_SEARCH_RADIUS_KM)
      .default(BUSINESS_CONFIG.DEFAULT_SEARCH_RADIUS_KM),
    communityId: z
      .string()
      .regex(/^[0-9a-fA-F]{24}$/)
      .optional(),
    minPrice: z.coerce.number().int().min(0).optional(),
    maxPrice: z.coerce.number().int().min(0).optional(),
    from: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'from must be YYYY-MM-DD')
      .optional(),
    to: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'to must be YYYY-MM-DD')
      .optional(),
    cursor: z.string().optional(),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(BUSINESS_CONFIG.MAX_PAGE_LIMIT)
      .default(BUSINESS_CONFIG.DEFAULT_PAGE_LIMIT),
  })
  .superRefine((data, ctx) => {
    if (
      (data.lat !== undefined && data.lng === undefined) ||
      (data.lng !== undefined && data.lat === undefined)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['lat'],
        message: 'Both lat and lng must be provided together',
      });
    }

    if ((data.from && !data.to) || (data.to && !data.from)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['from'],
        message: 'Both from and to dates must be provided for availability search',
      });
    }

    if (data.from && data.to && data.from > data.to) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['from'],
        message: 'from date cannot be after to date',
      });
    }
  });

export const itemAvailabilityQuerySchema = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Month must be in YYYY-MM format'),
});
