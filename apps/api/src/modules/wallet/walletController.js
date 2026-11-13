/**
 * @file apps/api/src/modules/wallet/walletController.js
 * Express controllers for user wallet endpoints.
 */

import {
  addFundsSchema,
  withdrawFundsSchema,
  walletTransactionsQuerySchema,
  AppError,
  ERROR_CODES,
} from '@borrowloop/shared';
import walletService from './walletService.js';
import defaultPaymentProvider from '../../services/payment/DemoPaymentProvider.js';

export async function getWallet(req, res, next) {
  try {
    const overview = await walletService.getWalletOverview(req.user._id);
    return res.status(200).json(overview);
  } catch (err) {
    return next(err);
  }
}

export async function getTransactions(req, res, next) {
  try {
    const parseResult = walletTransactionsQuerySchema.safeParse(req.query);
    if (!parseResult.success) {
      throw new AppError(
        ERROR_CODES.VALIDATION_ERROR,
        parseResult.error.errors[0]?.message || 'Validation failed',
        400,
        parseResult.error.flatten().fieldErrors,
      );
    }
    const result = await walletService.getTransactionHistory(req.user._id, parseResult.data);
    return res.status(200).json(result);
  } catch (err) {
    return next(err);
  }
}

export async function addFunds(req, res, next) {
  try {
    const parseResult = addFundsSchema.safeParse(req.body);
    if (!parseResult.success) {
      throw new AppError(
        ERROR_CODES.VALIDATION_ERROR,
        parseResult.error.errors[0]?.message || 'Validation failed',
        400,
        parseResult.error.flatten().fieldErrors,
      );
    }
    const { amountPaise } = parseResult.data;
    const result = await defaultPaymentProvider.addFunds(
      req.user._id,
      amountPaise,
      req.idempotency,
    );
    if (result?._isReplay) {
      res.setHeader('X-Idempotent-Replay', 'true');
    }
    const responseBody = { ...result };
    delete responseBody._isReplay;
    delete responseBody._statusCode;
    return res.status(result?._statusCode || 200).json(responseBody);
  } catch (err) {
    return next(err);
  }
}

export async function withdrawFunds(req, res, next) {
  try {
    const parseResult = withdrawFundsSchema.safeParse(req.body);
    if (!parseResult.success) {
      throw new AppError(
        ERROR_CODES.VALIDATION_ERROR,
        parseResult.error.errors[0]?.message || 'Validation failed',
        400,
        parseResult.error.flatten().fieldErrors,
      );
    }
    const { amountPaise } = parseResult.data;
    const result = await defaultPaymentProvider.withdraw(
      req.user._id,
      amountPaise,
      req.idempotency,
    );
    if (result?._isReplay) {
      res.setHeader('X-Idempotent-Replay', 'true');
    }
    const responseBody = { ...result };
    delete responseBody._isReplay;
    delete responseBody._statusCode;
    return res.status(result?._statusCode || 200).json(responseBody);
  } catch (err) {
    return next(err);
  }
}

export default {
  getWallet,
  getTransactions,
  addFunds,
  withdrawFunds,
};
