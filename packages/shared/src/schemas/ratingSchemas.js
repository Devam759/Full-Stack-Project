/**
 * @file packages/shared/src/schemas/ratingSchemas.js
 * Zod validation schemas for rating submissions and query listings.
 */

import { z } from 'zod';
import { BUSINESS_CONFIG } from '../config.js';

export const createRatingSchema = z.object({
  stars: z
    .number()
    .int()
    .min(
      BUSINESS_CONFIG.MIN_RATING_STARS,
      `Stars must be at least ${BUSINESS_CONFIG.MIN_RATING_STARS}`,
    )
    .max(
      BUSINESS_CONFIG.MAX_RATING_STARS,
      `Stars cannot exceed ${BUSINESS_CONFIG.MAX_RATING_STARS}`,
    ),
  comment: z
    .string()
    .max(
      BUSINESS_CONFIG.RATINGS?.COMMENT_MAX_LENGTH || 500,
      `Comment cannot exceed ${BUSINESS_CONFIG.RATINGS?.COMMENT_MAX_LENGTH || 500} characters`,
    )
    .optional(),
});

export const listRatingsQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(BUSINESS_CONFIG.MAX_PAGE_LIMIT)
    .default(BUSINESS_CONFIG.DEFAULT_PAGE_LIMIT),
});
