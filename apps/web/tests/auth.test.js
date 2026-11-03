import { describe, it, expect } from 'vitest';
import { registerSchema, loginSchema, passwordSchema } from '@borrowloop/shared';

describe('Web Auth Validation & Logic', () => {
  it('validates password constraints: min 8, max 128', () => {
    expect(passwordSchema.safeParse('1234567').success).toBe(false);
    expect(passwordSchema.safeParse('12345678').success).toBe(true);
    expect(passwordSchema.safeParse('a'.repeat(129)).success).toBe(false);
  });

  it('validates sign-up schema requires confirmAge and acceptTerms', () => {
    const valid = {
      name: 'John Doe',
      email: 'john@example.com',
      password: 'Password123!',
      confirmAge: true,
      acceptTerms: true,
    };
    expect(registerSchema.safeParse(valid).success).toBe(true);

    const underage = { ...valid, confirmAge: false };
    expect(registerSchema.safeParse(underage).success).toBe(false);
  });

  it('validates login schema format', () => {
    expect(loginSchema.safeParse({ email: 'john@example.com', password: 'pass' }).success).toBe(
      true,
    );
    expect(loginSchema.safeParse({ email: 'invalid-email', password: 'pass' }).success).toBe(false);
  });
});
