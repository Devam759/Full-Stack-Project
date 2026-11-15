/**
 * @file packages/shared/src/schemas/disputeSchemas.js
 * Zod validation schemas for dispute creation, evidence submission, decisions, and appeals.
 */

import { z } from 'zod';
import { BUSINESS_CONFIG } from '../config.js';

export const createDisputeSchema = z.object({
  reason: z.enum(['condition_mismatch', 'no_show'], {
    errorMap: () => ({
      message: "User-initiated dispute reason must be 'condition_mismatch' or 'no_show'",
    }),
  }),
  details: z
    .string()
    .min(10, 'Details must be at least 10 characters')
    .max(
      BUSINESS_CONFIG.DISPUTES?.DETAILS_MAX_LENGTH || 2000,
      `Details cannot exceed ${BUSINESS_CONFIG.DISPUTES?.DETAILS_MAX_LENGTH || 2000} characters`,
    ),
  photos: z
    .array(
      z.object({
        publicId: z.string().min(1, 'Photo publicId is required'),
        url: z.string().url('Photo url must be a valid URL'),
      }),
    )
    .max(
      BUSINESS_CONFIG.DISPUTES?.MAX_EVIDENCE_PHOTOS_PER_ENTRY || 6,
      `Cannot exceed ${BUSINESS_CONFIG.DISPUTES?.MAX_EVIDENCE_PHOTOS_PER_ENTRY || 6} photos per evidence entry`,
    )
    .optional()
    .default([]),
});

export const addEvidenceSchema = z.object({
  notes: z
    .string()
    .min(1, 'Evidence notes are required')
    .max(
      BUSINESS_CONFIG.DISPUTES?.NOTE_MAX_LENGTH || 2000,
      `Notes cannot exceed ${BUSINESS_CONFIG.DISPUTES?.NOTE_MAX_LENGTH || 2000} characters`,
    ),
  photos: z
    .array(
      z.object({
        publicId: z.string().min(1, 'Photo publicId is required'),
        url: z.string().url('Photo url must be a valid URL'),
      }),
    )
    .max(
      BUSINESS_CONFIG.DISPUTES?.MAX_EVIDENCE_PHOTOS_PER_ENTRY || 6,
      `Cannot exceed ${BUSINESS_CONFIG.DISPUTES?.MAX_EVIDENCE_PHOTOS_PER_ENTRY || 6} photos per evidence entry`,
    )
    .optional()
    .default([]),
});

export const disputeDecisionSchema = z.object({
  depositToLenderPaise: z
    .number()
    .int('Deposit to lender must be an integer in paise')
    .min(0, 'Deposit to lender must be non-negative'),
  depositToBorrowerPaise: z
    .number()
    .int('Deposit to borrower must be an integer in paise')
    .min(0, 'Deposit to borrower must be non-negative'),
  applyLateCharge: z.boolean().default(true),
  rentOutcome: z.enum(['lender', 'refund_borrower'], {
    errorMap: () => ({ message: "rentOutcome must be 'lender' or 'refund_borrower'" }),
  }),
  faultUserId: z.string().optional().nullable(),
  penaltyKind: z.enum(['lost_dispute', 'rejected_damage_claim', 'no_show', 'none'], {
    errorMap: () => ({
      message:
        "penaltyKind must be one of 'lost_dispute', 'rejected_damage_claim', 'no_show', 'none'",
    }),
  }),
  borrowerAccountAction: z.enum(['unfreeze', 'keep_frozen']).optional().nullable(),
  note: z
    .string()
    .min(
      BUSINESS_CONFIG.DISPUTES?.DECISION_NOTE_MIN_LENGTH || 20,
      `Decision note must be at least ${BUSINESS_CONFIG.DISPUTES?.DECISION_NOTE_MIN_LENGTH || 20} characters`,
    )
    .max(
      BUSINESS_CONFIG.DISPUTES?.NOTE_MAX_LENGTH || 2000,
      `Decision note cannot exceed ${BUSINESS_CONFIG.DISPUTES?.NOTE_MAX_LENGTH || 2000} characters`,
    ),
  internalNote: z
    .string()
    .max(
      BUSINESS_CONFIG.DISPUTES?.NOTE_MAX_LENGTH || 2000,
      `Internal note cannot exceed ${BUSINESS_CONFIG.DISPUTES?.NOTE_MAX_LENGTH || 2000} characters`,
    )
    .optional()
    .nullable(),
});

export const disputeAppealSchema = z.object({
  reason: z
    .string()
    .min(10, 'Appeal reason must be at least 10 characters')
    .max(1000, 'Appeal reason cannot exceed 1000 characters'),
});

export const appealDisputeSchema = disputeAppealSchema;

export const assignDisputeSchema = z.object({
  agentId: z
    .string()
    .regex(/^[0-9a-fA-F]{24}$/, 'Invalid agentId')
    .optional()
    .nullable(),
});

export const listDisputesQuerySchema = z.object({
  status: z.enum(['opened', 'assigned', 'decided', 'appealed', 'closed']).optional(),
  reason: z.enum(['damage', 'not_returned', 'condition_mismatch', 'no_show']).optional(),
  assignedToMe: z
    .preprocess((val) => val === 'true' || val === true, z.boolean().optional())
    .optional(),
  cursor: z.string().optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(BUSINESS_CONFIG.MAX_PAGE_LIMIT)
    .default(BUSINESS_CONFIG.DEFAULT_PAGE_LIMIT),
});
