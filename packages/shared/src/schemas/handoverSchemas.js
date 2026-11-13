/**
 * @file packages/shared/src/schemas/handoverSchemas.js
 * Zod validation schemas for QR handovers, code fallbacks, condition photos, and return confirmations.
 */

import { z } from 'zod';
import { BUSINESS_CONFIG } from '../config.js';

export const handoverIssueQrSchema = z.object({
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  accuracyM: z.number().min(0).optional(),
});

export const handoverScanSchema = z.object({
  qrToken: z.string().min(1, 'qrToken is required'),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  accuracyM: z.number().min(0).optional(),
});

export const handoverFallbackCodeSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'Code must be exactly 6 digits'),
});

export const handoverPhotosSchema = z.object({
  stage: z.enum(['pickup', 'return']),
  photos: z
    .array(
      z.object({
        publicId: z.string().min(1, 'publicId is required'),
        url: z.string().url('Invalid photo URL'),
      }),
    )
    .min(1, 'At least one photo is required')
    .max(
      BUSINESS_CONFIG.MAX_HANDOVER_PHOTOS,
      `Maximum ${BUSINESS_CONFIG.MAX_HANDOVER_PHOTOS} photos allowed`,
    ),
});

export const returnConfirmSchema = z
  .object({
    outcome: z.enum(['ok', 'problem']),
    note: z.string().max(500, 'Note cannot exceed 500 characters').optional(),
  })
  .refine(
    (data) =>
      data.outcome !== 'problem' || (typeof data.note === 'string' && data.note.trim().length > 0),
    {
      message: 'Note is required when reporting a problem',
      path: ['note'],
    },
  );
