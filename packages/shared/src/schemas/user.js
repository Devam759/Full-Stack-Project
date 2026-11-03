import { z } from 'zod';
import { geoPointSchema } from './common.js';
import { BUSINESS_CONFIG } from '../config.js';

export const updateProfileSchema = z
  .object({
    name: z.string().trim().min(2).max(50).optional(),
    phone: z.string().trim().max(20).optional(),
    photoUrl: z.string().trim().url('Must be a valid URL').optional(),
    approxLocation: geoPointSchema.optional(),
  })
  .strict(); // Rejects unknown fields like role, trustScore, status, emailVerified

export const deleteAccountSchema = z.object({
  password: z
    .string()
    .min(1, 'Password is required to confirm deletion')
    .max(BUSINESS_CONFIG.MAX_PASSWORD_LENGTH),
});

export const blockUserSchema = z.object({
  targetUserId: z.string().trim().min(1, 'Target user ID is required'),
});
