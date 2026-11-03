import { z } from 'zod';
import { BUSINESS_CONFIG } from '../config.js';

export const passwordSchema = z
  .string({ required_error: 'Password is required' })
  .min(
    BUSINESS_CONFIG.MIN_PASSWORD_LENGTH,
    `Password must be at least ${BUSINESS_CONFIG.MIN_PASSWORD_LENGTH} characters`,
  )
  .max(
    BUSINESS_CONFIG.MAX_PASSWORD_LENGTH,
    `Password cannot exceed ${BUSINESS_CONFIG.MAX_PASSWORD_LENGTH} characters`,
  );

export const registerSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, 'Name must be at least 2 characters')
    .max(50, 'Name must not exceed 50 characters'),
  email: z.string().trim().email('Invalid email address').max(255).toLowerCase(),
  password: passwordSchema,
  confirmAge: z.literal(true, {
    errorMap: () => ({ message: 'You must confirm that you are at least 18 years old' }),
  }),
  acceptTerms: z.literal(true, {
    errorMap: () => ({ message: 'You must accept the terms of service' }),
  }),
});

export const loginSchema = z.object({
  email: z.string().trim().email('Invalid email address').toLowerCase(),
  password: z.string().min(1, 'Password is required').max(BUSINESS_CONFIG.MAX_PASSWORD_LENGTH),
});

export const verifyEmailSchema = z.object({
  token: z.string().trim().min(1, 'Verification token is required'),
});

export const resendVerificationSchema = z.object({
  email: z.string().trim().email('Invalid email address').toLowerCase(),
});

export const forgotPasswordSchema = z.object({
  email: z.string().trim().email('Invalid email address').toLowerCase(),
});

export const resetPasswordSchema = z.object({
  token: z.string().trim().min(1, 'Reset token is required'),
  newPassword: passwordSchema,
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: passwordSchema,
});

export const portalLoginSchema = z.object({
  email: z.string().trim().email('Invalid email address').toLowerCase(),
  password: z.string().min(1, 'Password is required'),
});

export const portalTotpSchema = z.object({
  tempToken: z.string().trim().min(1, 'Temporary session token is required'),
  totpCode: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'TOTP code must be 6 digits'),
});

export const portalEnrollTotpSchema = z.object({
  enrollmentToken: z.string().trim().min(1, 'Enrollment token is required'),
  totpCode: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'TOTP code must be 6 digits'),
});
