/**
 * @file packages/shared/src/schemas/wallet.js
 * Zod validation schemas for Wallet and Ledger endpoints.
 */

import { z } from 'zod';
import { BUSINESS_CONFIG } from '../config.js';

/**
 * Validates request to add demo funds to wallet.
 */
export const addFundsSchema = z.object({
  amountPaise: z
    .number({
      required_error: 'amountPaise is required',
      invalid_type_error: 'amountPaise must be an integer',
    })
    .int('amountPaise must be an integer')
    .min(
      BUSINESS_CONFIG.MIN_WALLET_ADD_PAISE,
      `Minimum amount to add is Rs ${BUSINESS_CONFIG.MIN_WALLET_ADD_PAISE / 100}`,
    )
    .max(
      BUSINESS_CONFIG.MAX_WALLET_ADD_PAISE,
      `Maximum amount to add is Rs ${BUSINESS_CONFIG.MAX_WALLET_ADD_PAISE / 100}`,
    ),
});

/**
 * Validates request to withdraw funds from wallet.
 */
export const withdrawFundsSchema = z.object({
  amountPaise: z
    .number({
      required_error: 'amountPaise is required',
      invalid_type_error: 'amountPaise must be an integer',
    })
    .int('amountPaise must be an integer')
    .min(
      BUSINESS_CONFIG.MIN_WALLET_WITHDRAW_PAISE,
      `Minimum withdrawal amount is Rs ${BUSINESS_CONFIG.MIN_WALLET_WITHDRAW_PAISE / 100}`,
    )
    .max(
      BUSINESS_CONFIG.MAX_WALLET_WITHDRAW_PAISE,
      `Maximum withdrawal amount is Rs ${BUSINESS_CONFIG.MAX_WALLET_WITHDRAW_PAISE / 100}`,
    ),
});

/**
 * Validates query parameters for transaction history.
 */
export const walletTransactionsQuerySchema = z.object({
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(BUSINESS_CONFIG.MAX_PAGE_LIMIT)
    .default(BUSINESS_CONFIG.DEFAULT_PAGE_LIMIT),
  cursor: z.string().optional(),
});
