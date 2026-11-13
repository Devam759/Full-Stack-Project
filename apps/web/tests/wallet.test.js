import { describe, it, expect } from 'vitest';
import { formatPaise, toPaise, toRupees, BUSINESS_CONFIG } from '@borrowloop/shared';

describe('Web App: Wallet Formatting & Demo Rules', () => {
  it('formats paise into INR rupees with demo label according to Hard Rule 9', () => {
    const formatted = formatPaise(50000, { showDemoTag: true });
    expect(formatted).toContain('500');
    expect(formatted).toContain('Demo money');
  });

  it('safely converts rupees string input to integer paise without float drift', () => {
    expect(toPaise('100')).toBe(10000);
    expect(toPaise('500.50')).toBe(50050);
    expect(toPaise('19.99')).toBe(1999);
  });

  it('converts paise to rupees decimal accurately', () => {
    expect(toRupees(10000)).toBe(100);
    expect(toRupees(5000000)).toBe(50000);
  });

  it('enforces maximum wallet cap bounds in configuration', () => {
    expect(BUSINESS_CONFIG.WALLET_CAP_PAISE).toBe(5000000);
    expect(BUSINESS_CONFIG.CURRENCY).toBe('INR');
  });
});
