import { describe, it, expect } from 'vitest';
import { BUSINESS_CONFIG } from '../src/config.js';

describe('packages/shared/config', () => {
  it('contains immutable config object', () => {
    expect(Object.isFrozen(BUSINESS_CONFIG)).toBe(true);
    expect(Object.isFrozen(BUSINESS_CONFIG.COMMISSION_APPLIES_TO)).toBe(true);
    expect(Object.isFrozen(BUSINESS_CONFIG.COMMISSION_DOES_NOT_APPLY_TO)).toBe(true);
    expect(Object.isFrozen(BUSINESS_CONFIG.PROHIBITED_CATEGORIES)).toBe(true);
  });

  it('matches all specified money and commission values', () => {
    expect(BUSINESS_CONFIG.CURRENCY).toBe('INR');
    expect(BUSINESS_CONFIG.PAISE_PER_RUPEE).toBe(100);
    expect(BUSINESS_CONFIG.WALLET_CAP_PAISE).toBe(5000000); // Rs 50,000 in paise
    expect(BUSINESS_CONFIG.COMMISSION_BPS).toBe(1500); // 15%
    expect(BUSINESS_CONFIG.COMMISSION_APPLIES_TO).toContain('rent');
    expect(BUSINESS_CONFIG.COMMISSION_APPLIES_TO).toContain('late_charge');
    expect(BUSINESS_CONFIG.COMMISSION_DOES_NOT_APPLY_TO).toContain('deposit_compensation');
  });

  it('matches booking durations and thresholds', () => {
    expect(BUSINESS_CONFIG.MIN_BOOKING_DAYS).toBe(1);
    expect(BUSINESS_CONFIG.MAX_BOOKING_DAYS).toBe(30);
    expect(BUSINESS_CONFIG.REQUEST_EXPIRY_HOURS).toBe(24);
    expect(BUSINESS_CONFIG.LATE_CANCEL_THRESHOLD_HOURS).toBe(6);
    expect(BUSINESS_CONFIG.OVERDUE_DISPUTE_DAYS).toBe(3);
    expect(BUSINESS_CONFIG.RETURN_CONFIRMATION_WINDOW_HOURS).toBe(24);
  });

  it('matches QR security, tokens, and rating rules', () => {
    expect(BUSINESS_CONFIG.QR_EXPIRY_SECONDS).toBe(30);
    expect(BUSINESS_CONFIG.ACCESS_TOKEN_EXPIRY_SECONDS).toBe(900); // 15 min
    expect(BUSINESS_CONFIG.RATING_REVEAL_DAYS).toBe(7);
    expect(BUSINESS_CONFIG.STRIKE_2_BAN_DAYS).toBe(7);
    expect(BUSINESS_CONFIG.MIN_USER_AGE_YEARS).toBe(18);
    expect(BUSINESS_CONFIG.BCRYPT_SALT_ROUNDS).toBe(12);
  });

  it('matches upload limits and moderation rules', () => {
    expect(BUSINESS_CONFIG.MAX_ITEM_PHOTOS).toBe(6);
    expect(BUSINESS_CONFIG.ITEM_REPORTS_HIDE_THRESHOLD).toBe(3);
    expect(BUSINESS_CONFIG.ALLOWED_IMAGE_MIME_TYPES).toEqual([
      'image/jpeg',
      'image/png',
      'image/webp',
    ]);
  });

  it('matches item categories, conditions, and limits for Phase 3', () => {
    expect(BUSINESS_CONFIG.ITEM_CATEGORIES).toContain('books_and_study');
    expect(BUSINESS_CONFIG.ITEM_CATEGORIES).not.toContain('weapons and ammunition');
    expect(BUSINESS_CONFIG.ITEM_CONDITIONS).toEqual(['new', 'like_new', 'good', 'fair']);
    expect(BUSINESS_CONFIG.MAX_ACTIVE_ITEMS_PER_USER).toBe(50);
    expect(BUSINESS_CONFIG.PROHIBITED_WORDS_BLOCKLIST).toContain('gun');
    expect(BUSINESS_CONFIG.PROHIBITED_WORDS_BLOCKLIST).toContain('cocaine');
    expect(BUSINESS_CONFIG.ACTIVE_BOOKING_STATUSES).toEqual([
      'accepted',
      'picked_up',
      'returned',
      'disputed',
    ]);
  });
});
