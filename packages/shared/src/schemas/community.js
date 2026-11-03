import { z } from 'zod';
import { geoPointSchema } from './common.js';
import { BUSINESS_CONFIG } from '../config.js';

export const createCommunitySchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(2, 'Community name must be at least 2 characters')
      .max(60, 'Community name must not exceed 60 characters')
      .refine(
        (val) => !BUSINESS_CONFIG.RESERVED_COMMUNITY_NAMES.includes(val.toLowerCase()),
        (val) => ({ message: `"${val}" is a reserved name and cannot be used` }),
      ),
    description: z.string().trim().max(500, 'Description cannot exceed 500 characters').default(''),
    type: z.enum(['public', 'private']),
    location: geoPointSchema,
    city: z.string().trim().min(2, 'City is required').max(50),
  })
  .strict();

export const joinCommunitySchema = z
  .object({
    inviteCode: z.string().trim().min(8).max(32).optional(),
  })
  .strict();

export const nearbyCommunityQuerySchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  radius: z.coerce.number().positive().max(50000).default(10000), // In meters (max 50km)
});

export const searchCommunityQuerySchema = z.object({
  q: z.string().trim().optional(),
  city: z.string().trim().optional(),
  cursor: z.string().trim().optional(),
  limit: z.coerce.number().int().positive().max(50).default(20),
});

export const transferOwnerSchema = z
  .object({
    newOwnerId: z.string().trim().min(1, 'New owner user ID is required'),
  })
  .strict();
