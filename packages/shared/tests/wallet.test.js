import { describe, it, expect } from 'vitest';
import {
  addFundsSchema,
  withdrawFundsSchema,
  walletTransactionsQuerySchema,
} from '../src/schemas/wallet.js';
import { BUSINESS_CONFIG } from '../src/config.js';

describe('packages/shared/schemas/wallet', () => {
  describe('addFundsSchema', () => {
    it('accepts valid amounts in paise within limits', () => {
      const valid = addFundsSchema.safeParse({ amountPaise: 50000 }); // Rs 500
      expect(valid.success).toBe(true);
      expect(valid.data.amountPaise).toBe(50000);
    });

    it('rejects amounts below minimum', () => {
      const result = addFundsSchema.safeParse({
        amountPaise: BUSINESS_CONFIG.MIN_WALLET_ADD_PAISE - 1,
      });
      expect(result.success).toBe(false);
    });

    it('rejects amounts above maximum', () => {
      const result = addFundsSchema.safeParse({
        amountPaise: BUSINESS_CONFIG.MAX_WALLET_ADD_PAISE + 1,
      });
      expect(result.success).toBe(false);
    });

    it('rejects non-integers and fractional paise', () => {
      const result = addFundsSchema.safeParse({ amountPaise: 100.5 });
      expect(result.success).toBe(false);
    });
  });

  describe('withdrawFundsSchema', () => {
    it('accepts valid withdrawal amounts in paise', () => {
      const valid = withdrawFundsSchema.safeParse({ amountPaise: 20000 }); // Rs 200
      expect(valid.success).toBe(true);
    });

    it('rejects withdrawals below minimum', () => {
      const result = withdrawFundsSchema.safeParse({
        amountPaise: BUSINESS_CONFIG.MIN_WALLET_WITHDRAW_PAISE - 1,
      });
      expect(result.success).toBe(false);
    });

    it('rejects negative numbers and non-integers', () => {
      expect(withdrawFundsSchema.safeParse({ amountPaise: -500 }).success).toBe(false);
      expect(withdrawFundsSchema.safeParse({ amountPaise: 1000.25 }).success).toBe(false);
    });
  });

  describe('walletTransactionsQuerySchema', () => {
    it('provides defaults for pagination', () => {
      const parsed = walletTransactionsQuerySchema.parse({});
      expect(parsed.limit).toBe(20);
      expect(parsed.cursor).toBeUndefined();
    });

    it('coerces string limits to numbers and bounds them', () => {
      const parsed = walletTransactionsQuerySchema.parse({ limit: '35', cursor: 'abc123' });
      expect(parsed.limit).toBe(35);
      expect(parsed.cursor).toBe('abc123');

      expect(walletTransactionsQuerySchema.safeParse({ limit: '0' }).success).toBe(false);
      expect(walletTransactionsQuerySchema.safeParse({ limit: '999' }).success).toBe(false);
    });
  });
});
