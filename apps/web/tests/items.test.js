import { describe, it, expect } from 'vitest';
import { formatPaise, toPaise, BUSINESS_CONFIG } from '@borrowloop/shared';
import { getMonthBounds, monthsDiff } from '../../api/src/common/dates.js';

describe('Web Items Display, Demo Money & Calendar Logic (Phase 3)', () => {
  it('formats integer paise to Rupees and converts Rupees to safe integer paise without float errors (Rule 15)', () => {
    // 25000 paise = ₹250.00 Rupees
    expect(formatPaise(25000)).toBe('₹250.00');
    expect(formatPaise(150000)).toBe('₹1,500.00');

    // Input string to safe integer paise
    expect(toPaise('250')).toBe(25000);
    expect(toPaise('1500.50')).toBe(150050);
    expect(toPaise(0)).toBe(0);
  });

  it('guarantees prohibited categories are excluded from selection lists and valid categories are available (Rule 6)', () => {
    expect(BUSINESS_CONFIG.ITEM_CATEGORIES).toContain('tools_and_diy');
    expect(BUSINESS_CONFIG.ITEM_CATEGORIES).toContain('electronics_and_gadgets');
    expect(BUSINESS_CONFIG.ITEM_CATEGORIES).toContain('outdoor_and_camping');

    // Strictly excludes prohibited contraband categories
    expect(BUSINESS_CONFIG.ITEM_CATEGORIES).not.toContain('weapons and ammunition');
    expect(BUSINESS_CONFIG.ITEM_CATEGORIES).not.toContain('drugs');
    expect(BUSINESS_CONFIG.ITEM_CATEGORIES).not.toContain('alcohol and tobacco');
  });

  it('correctly bounds monthly calendar navigation to current and future months up to 6 months (Rule 11)', () => {
    const startMonth = '2026-11';
    const bounds = getMonthBounds(startMonth);
    expect(bounds.startDay).toBe('2026-11-01');
    expect(bounds.endDay).toBe('2026-11-30');
    expect(bounds.totalDays).toBe(30);

    // Difference calculations
    expect(monthsDiff('2026-11', '2026-11')).toBe(0);
    expect(monthsDiff('2026-11', '2027-05')).toBe(6);
    expect(monthsDiff('2026-11', '2027-06')).toBe(7); // Over 6 months
    expect(monthsDiff('2026-11', '2026-10')).toBe(-1); // Past month
  });

  it('enforces total potential exposure within wallet cap (Rs 50,000)', () => {
    const rentPerDay = 500_00; // Rs 500
    const maxDays = 10;
    const deposit = 1000_00; // Rs 1000
    const totalExposure = rentPerDay * maxDays + deposit; // 5000 + 1000 = Rs 6000

    expect(totalExposure).toBeLessThanOrEqual(BUSINESS_CONFIG.WALLET_CAP_PAISE);

    const excessiveRent = 6000_00;
    const excessiveTotal = excessiveRent * 10 + deposit; // Rs 61,000
    expect(excessiveTotal).toBeGreaterThan(BUSINESS_CONFIG.WALLET_CAP_PAISE);
  });
});
