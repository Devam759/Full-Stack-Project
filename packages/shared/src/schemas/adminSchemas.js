/**
 * @file packages/shared/src/schemas/adminSchemas.js
 * Zod validation schemas for administrative operations (Phase 9).
 */

import { z } from 'zod';
import { BUSINESS_CONFIG } from '../config.js';

const { ADMIN, APPEALS } = BUSINESS_CONFIG;

// User Moderation Schemas
export const adminUserQuerySchema = z.object({
  q: z.string().trim().optional(),
  role: z.enum(['user', 'care_agent', 'admin']).optional(),
  status: z.enum(['active', 'frozen', 'banned']).optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(ADMIN.MAX_PAGE_LIMIT || 50)
    .default(ADMIN.PAGE_LIMIT || 20),
  cursor: z.string().optional(),
});

export const adminBanUserSchema = z.object({
  reason: z
    .string({ required_error: 'Reason is required' })
    .trim()
    .min(
      ADMIN.REASON_MIN_LENGTH || 10,
      `Reason must be at least ${ADMIN.REASON_MIN_LENGTH || 10} characters`,
    )
    .max(1000, 'Reason cannot exceed 1000 characters'),
});

export const adminUnbanUserSchema = z.object({
  reason: z
    .string({ required_error: 'Reason is required' })
    .trim()
    .min(
      ADMIN.REASON_MIN_LENGTH || 10,
      `Reason must be at least ${ADMIN.REASON_MIN_LENGTH || 10} characters`,
    )
    .max(1000, 'Reason cannot exceed 1000 characters'),
});

export const adminReverseStrikeSchema = z.object({
  reason: z
    .string({ required_error: 'Reason is required' })
    .trim()
    .min(
      ADMIN.REASON_MIN_LENGTH || 10,
      `Reason must be at least ${ADMIN.REASON_MIN_LENGTH || 10} characters`,
    )
    .max(1000, 'Reason cannot exceed 1000 characters'),
});

// Community Moderation Schemas
export const adminCommunityQuerySchema = z.object({
  status: z.enum(['active', 'suspended']).optional(),
  type: z.string().optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(ADMIN.MAX_PAGE_LIMIT || 50)
    .default(ADMIN.PAGE_LIMIT || 20),
  cursor: z.string().optional(),
});

export const adminSuspendCommunitySchema = z.object({
  reason: z
    .string({ required_error: 'Reason is required' })
    .trim()
    .min(
      ADMIN.REASON_MIN_LENGTH || 10,
      `Reason must be at least ${ADMIN.REASON_MIN_LENGTH || 10} characters`,
    )
    .max(1000, 'Reason cannot exceed 1000 characters'),
});

export const adminRestoreCommunitySchema = z.object({
  reason: z
    .string({ required_error: 'Reason is required' })
    .trim()
    .min(
      ADMIN.REASON_MIN_LENGTH || 10,
      `Reason must be at least ${ADMIN.REASON_MIN_LENGTH || 10} characters`,
    )
    .max(1000, 'Reason cannot exceed 1000 characters'),
});

// Agent Management Schemas
export const adminPromoteAgentSchema = z.object({
  userId: z
    .string({ required_error: 'userId is required' })
    .regex(/^[0-9a-fA-F]{24}$/, 'Invalid user ID format'),
  reason: z
    .string({ required_error: 'Reason is required' })
    .trim()
    .min(
      ADMIN.REASON_MIN_LENGTH || 10,
      `Reason must be at least ${ADMIN.REASON_MIN_LENGTH || 10} characters`,
    )
    .max(1000, 'Reason cannot exceed 1000 characters'),
});

export const adminDemoteAgentSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(
      ADMIN.REASON_MIN_LENGTH || 10,
      `Reason must be at least ${ADMIN.REASON_MIN_LENGTH || 10} characters`,
    )
    .max(1000, 'Reason cannot exceed 1000 characters')
    .optional(),
});

// Revised Decision and Appeal Schemas
export const adminRevisedDecisionSchema = z.object({
  depositToLenderPaise: z.number().int().min(0),
  depositToBorrowerPaise: z.number().int().min(0),
  rentOutcome: z.enum(['lender', 'refund_borrower']),
  faultUserId: z
    .string()
    .regex(/^[0-9a-fA-F]{24}$/, 'Invalid faultUserId format')
    .nullable()
    .optional(),
  penaltyKind: z.enum(['lost_dispute', 'rejected_damage_claim', 'no_show', 'none']),
  borrowerAccountAction: z.enum(['none', 'unfreeze', 'keep_frozen', 'warn', 'strike']).optional(),
});

export const adminAppealPreviewSchema = z.object({
  revisedDecision: adminRevisedDecisionSchema,
});

export const adminAppealDecisionSchema = z
  .object({
    decision: z.enum(['upheld', 'overturned']),
    note: z
      .string({ required_error: 'Note is required' })
      .trim()
      .min(
        APPEALS.DECISION_NOTE_MIN_LENGTH || 20,
        `Note must be at least ${APPEALS.DECISION_NOTE_MIN_LENGTH || 20} characters`,
      )
      .max(
        APPEALS.DECISION_NOTE_MAX_LENGTH || 2000,
        `Note cannot exceed ${APPEALS.DECISION_NOTE_MAX_LENGTH || 2000} characters`,
      ),
    revisedDecision: adminRevisedDecisionSchema.optional(),
    acknowledgeShortfall: z.boolean().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.decision === 'overturned' && !data.revisedDecision) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['revisedDecision'],
        message: 'Revised decision details are required when overturning an appeal',
      });
    }
  });

// Ad Settings Schemas
export const adminPatchAdPlacementSchema = z.object({
  enabled: z.boolean().optional(),
  adsenseSlotId: z.string().optional(),
  reason: z
    .string({ required_error: 'Reason is required' })
    .trim()
    .min(
      ADMIN.REASON_MIN_LENGTH || 10,
      `Reason must be at least ${ADMIN.REASON_MIN_LENGTH || 10} characters`,
    )
    .max(1000, 'Reason cannot exceed 1000 characters'),
});

export const adminPatchAdMasterSchema = z.object({
  enabled: z.boolean(),
  confirm: z.string().optional(),
  clientId: z.string().optional(),
  reason: z
    .string({ required_error: 'Reason is required' })
    .trim()
    .min(
      ADMIN.REASON_MIN_LENGTH || 10,
      `Reason must be at least ${ADMIN.REASON_MIN_LENGTH || 10} characters`,
    )
    .max(1000, 'Reason cannot exceed 1000 characters'),
});

// Audit Query Schema
export const adminAuditQuerySchema = z.object({
  actorId: z.string().optional(),
  action: z.string().optional(),
  targetType: z.string().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(ADMIN.MAX_PAGE_LIMIT || 50)
    .default(ADMIN.PAGE_LIMIT || 20),
  cursor: z.string().optional(),
});

// Reconciliation Run Trigger Schema
export const adminTriggerReconciliationSchema = z.object({
  reason: z
    .string({ required_error: 'Reason is required' })
    .trim()
    .min(
      ADMIN.REASON_MIN_LENGTH || 10,
      `Reason must be at least ${ADMIN.REASON_MIN_LENGTH || 10} characters`,
    )
    .max(1000, 'Reason cannot exceed 1000 characters'),
});

export default {
  adminUserQuerySchema,
  adminBanUserSchema,
  adminUnbanUserSchema,
  adminReverseStrikeSchema,
  adminCommunityQuerySchema,
  adminSuspendCommunitySchema,
  adminRestoreCommunitySchema,
  adminPromoteAgentSchema,
  adminDemoteAgentSchema,
  adminRevisedDecisionSchema,
  adminAppealPreviewSchema,
  adminAppealDecisionSchema,
  adminPatchAdPlacementSchema,
  adminPatchAdMasterSchema,
  adminAuditQuerySchema,
  adminTriggerReconciliationSchema,
};
