import { describe, it, expect } from 'vitest';
import {
  toPaise,
  toRupees,
  formatPaise,
  calculateCommission,
  assertPaise,
  addPaise,
  subtractPaise,
} from '../src/money.js';

describe('packages/shared/money', () => {
  describe('toPaise (float safety & precision)', () => {
    it('handles famous IEEE-754 float drift (0.1 + 0.2) safely', () => {
      const floatSum = 0.1 + 0.2; // 0.30000000000000004
      expect(toPaise(floatSum)).toBe(30);
    });

    it('correctly converts decimal numbers to integer paise', () => {
      expect(toPaise(0)).toBe(0);
      expect(toPaise(1)).toBe(100);
      expect(toPaise(19.99)).toBe(1999);
      expect(toPaise(500.5)).toBe(50050);
      expect(toPaise(0.05)).toBe(5);
      expect(toPaise(0.01)).toBe(1);
    });

    it('correctly converts decimal string inputs', () => {
      expect(toPaise('0')).toBe(0);
      expect(toPaise('10')).toBe(1000);
      expect(toPaise('19.99')).toBe(1999);
      expect(toPaise('50000.00')).toBe(5000000);
      expect(toPaise('0.5')).toBe(50);
      expect(toPaise('0.05')).toBe(5);
      expect(toPaise('  120.75  ')).toBe(12075);
    });

    it('rejects numbers with fractional paise (> 2 decimal places)', () => {
      expect(() => toPaise(19.999)).toThrow(RangeError);
      expect(() => toPaise(0.001)).toThrow(RangeError);
      expect(() => toPaise(12.3456)).toThrow(RangeError);
    });

    it('rejects strings with fractional paise (> 2 decimal places)', () => {
      expect(() => toPaise('19.999')).toThrow(RangeError);
      expect(() => toPaise('0.005')).toThrow(RangeError);
      expect(() => toPaise('12.3456')).toThrow(RangeError);
    });

    it('rejects invalid types and non-numeric strings', () => {
      expect(() => toPaise('abc')).toThrow(TypeError);
      expect(() => toPaise('12.34.56')).toThrow(TypeError);
      expect(() => toPaise(null)).toThrow(TypeError);
      expect(() => toPaise(undefined)).toThrow(TypeError);
      expect(() => toPaise(NaN)).toThrow(TypeError);
      expect(() => toPaise(Infinity)).toThrow(TypeError);
    });
  });

  describe('toRupees', () => {
    it('converts paise to rupees decimal', () => {
      expect(toRupees(1999)).toBe(19.99);
      expect(toRupees(100)).toBe(1);
      expect(toRupees(0)).toBe(0);
      expect(toRupees(5000000)).toBe(50000);
    });
  });

  describe('formatPaise', () => {
    it('formats rupees with 2 decimal places and currency symbol', () => {
      expect(formatPaise(1999)).toBe('₹19.99');
      expect(formatPaise(5000000)).toBe('₹50,000.00');
      expect(formatPaise(0)).toBe('₹0.00');
    });

    it('appends Demo money tag when requested', () => {
      expect(formatPaise(1999, { showDemoTag: true })).toBe('₹19.99 (Demo money)');
      expect(formatPaise(5000000, { showDemoTag: true })).toBe('₹50,000.00 (Demo money)');
    });
  });

  describe('calculateCommission (rounded to nearest paisa & payout invariant)', () => {
    it('calculates 15% commission correctly and maintains payout = total - commission', () => {
      // 1000 paise * 15% = 150 paise
      const res1 = calculateCommission(1000);
      expect(res1.commissionPaise).toBe(150);
      expect(res1.payoutPaise).toBe(850);
      expect(res1.commissionPaise + res1.payoutPaise).toBe(res1.totalPaise);

      // 105 paise * 15% = 15.75 paise -> rounded to 16 paise
      const res2 = calculateCommission(105);
      expect(res2.commissionPaise).toBe(16);
      expect(res2.payoutPaise).toBe(89);
      expect(res2.commissionPaise + res2.payoutPaise).toBe(res2.totalPaise);

      // 103 paise * 15% = 15.45 paise -> rounded to 15 paise
      const res3 = calculateCommission(103);
      expect(res3.commissionPaise).toBe(15);
      expect(res3.payoutPaise).toBe(88);
      expect(res3.commissionPaise + res3.payoutPaise).toBe(res3.totalPaise);
    });
  });

  describe('assertPaise, addPaise and subtractPaise', () => {
    it('assertPaise validates integers and detects floats', () => {
      expect(assertPaise(100)).toBe(100);
      expect(() => assertPaise(10.5)).toThrow(TypeError);
      expect(() => assertPaise(-50)).toThrow(RangeError);
      expect(assertPaise(-50, 'delta', true)).toBe(-50);
    });

    it('addPaise sums integer amounts safely', () => {
      expect(addPaise(100, 250, 50)).toBe(400);
    });

    it('subtractPaise subtracts and rejects negative balance by default', () => {
      expect(subtractPaise(500, 200)).toBe(300);
      expect(() => subtractPaise(200, 500)).toThrow(RangeError);
      expect(subtractPaise(200, 500, true)).toBe(-300);
    });
  });
});
