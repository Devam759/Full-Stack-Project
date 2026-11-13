/**
 * @file apps/api/src/modules/wallet/ledgerService.js
 * Core double-entry ledger engine executing high-integrity financial operations.
 * Implements:
 * - Invariant verification (sum of entries per txnId === 0)
 * - Atomic conditional balance updates with w: majority write concern
 * - Automatic retry on transient transaction errors
 * - balanceAfterPaise tracking on all user entries
 * - Idempotency key preservation inside the same transaction
 */

import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { BUSINESS_CONFIG, AppError, ERROR_CODES, assertPaise } from '@borrowloop/shared';
import Wallet from '../models/Wallet.js';
import LedgerEntry from '../models/LedgerEntry.js';
import LedgerOperation from '../models/LedgerOperation.js';
import IdempotencyKey from '../models/IdempotencyKey.js';
import User from '../models/User.js';
import { saveIdempotencyRecord } from '../common/idempotency.js';

/**
 * Asserts that the user is eligible for monetary actions.
 *
 * @param {object} user
 */
export function assertUserEligibleForWallet(user) {
  if (!user) {
    throw new AppError(ERROR_CODES.UNAUTHORIZED, 'User not found', 401);
  }
  if (!user.emailVerified) {
    throw new AppError(
      ERROR_CODES.EMAIL_NOT_VERIFIED,
      'Email confirmation is required before accessing wallet functions',
      403,
    );
  }
  if (user.status === 'banned') {
    throw new AppError(ERROR_CODES.ACCOUNT_BANNED, 'Account is banned', 403);
  }
  if (user.status === 'frozen') {
    throw new AppError(ERROR_CODES.ACCOUNT_FROZEN, 'Account is frozen', 403);
  }
  if (user.status === 'deleted' || user.status !== 'active') {
    throw new AppError(ERROR_CODES.FORBIDDEN, 'Account is not active', 403);
  }
}

/**
 * Executes a callback inside a MongoDB transaction with majority write concern,
 * automatically retrying on transient errors with exponential backoff and full jitter.
 *
 * @template T
 * @param {(session: mongoose.ClientSession) => Promise<T>} workFn
 * @param {number} [maxRetries=BUSINESS_CONFIG.TRANSACTION_RETRY_CAP]
 * @returns {Promise<T>}
 */
export async function runInTransactionWithRetry(
  workFn,
  maxRetries = BUSINESS_CONFIG.TRANSACTION_RETRY_CAP || 30,
) {
  let attempt = 0;
  while (attempt < maxRetries) {
    attempt += 1;
    const session = await mongoose.startSession();
    try {
      session.startTransaction({
        readConcern: { level: 'snapshot' },
        writeConcern: { w: 'majority' },
      });

      const result = await workFn(session);
      await session.commitTransaction();
      return result;
    } catch (error) {
      if (session.inTransaction()) {
        try {
          await session.abortTransaction();
        } catch {
          // Ignore abort errors
        }
      }

      const isTransient =
        error?.hasErrorLabel?.('TransientTransactionError') ||
        error?.hasErrorLabel?.('UnknownTransactionCommitResult') ||
        error?.errorLabels?.includes?.('TransientTransactionError') ||
        error?.errorLabels?.includes?.('UnknownTransactionCommitResult') ||
        error?.code === 112 || // WriteConflict
        error?.codeName === 'WriteConflict' ||
        error?.code === 24 || // LockTimeout
        error?.codeName === 'LockTimeout' ||
        (typeof error?.message === 'string' && error.message.includes('Write conflict')) ||
        (typeof error?.message === 'string' && error.message.includes('Unable to acquire')) ||
        error?.code === 251; // NoSuchTransaction

      if (isTransient) {
        if (attempt < maxRetries) {
          // Exponential backoff with full jitter (AWS decorrelated / standard full jitter)
          const maxDelay = Math.min(1000, 20 * Math.pow(2, Math.min(attempt, 8)));
          const delayMs = Math.floor(Math.random() * maxDelay);
          await new Promise((res) => setTimeout(res, delayMs));
          continue;
        }

        // Retries exhausted on transient error
        throw new AppError(
          ERROR_CODES.RETRY_EXHAUSTED,
          'Transaction failed due to concurrent write contention after maximum retries; please retry your operation',
          503,
          { retryable: true, attempts: attempt },
        );
      }
      throw error;
    } finally {
      await session.endSession();
    }
  }
  throw new AppError(
    ERROR_CODES.RETRY_EXHAUSTED,
    'Transaction failed after maximum retries; please retry your operation',
    503,
    { retryable: true, attempts: attempt },
  );
}

/**
 * Validates the double-entry invariant: entries within a transaction must sum to zero.
 *
 * @param {Array<{ amountPaise: number }>} entries
 */
function assertZeroSum(entries) {
  const sum = entries.reduce((acc, curr) => acc + curr.amountPaise, 0);
  if (sum !== 0) {
    throw new AppError(
      ERROR_CODES.LEDGER_INVARIANT_VIOLATION,
      `Double-entry invariant violation: transaction entries sum to ${sum} paise instead of 0`,
      500,
    );
  }
}

/**
 * Checks if an error is a duplicate key error on the idempotency_keys collection.
 *
 * @param {any} err
 * @returns {boolean}
 */
function isIdempotencyDuplicateError(err) {
  if (!err) return false;
  if (err.code === 11000) {
    const msg = String(err.message || '');
    if (
      msg.includes('idempotency_keys') ||
      msg.includes('IdempotencyKey') ||
      err.keyPattern?.key ||
      err.keyValue?.key
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Checks if an error is a duplicate key error on the ledger_operations collection.
 *
 * @param {any} err
 * @returns {boolean}
 */
function isLedgerOpDuplicateError(err) {
  if (!err) return false;
  if (err.code === 11000) {
    const msg = String(err.message || '');
    if (
      msg.includes('ledgeroperations') ||
      msg.includes('LedgerOperation') ||
      msg.includes('ledger_operations') ||
      err.keyPattern?.bookingId
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Records an operation in LedgerOperation to guarantee settle-once and prevent duplicate execution.
 *
 * @param {object} params
 * @param {import('mongoose').ClientSession} params.session
 * @param {string | import('mongoose').Types.ObjectId} params.bookingId
 * @param {string} params.operationType
 * @param {string} [params.opRef='default']
 * @param {object} [params.meta={}]
 * @param {boolean} [params.throwOnAlreadyApplied=false]
 * @returns {Promise<{ alreadyApplied: boolean, status?: string, bookingId?: any, operationType?: string, opRef?: string }>}
 */
async function recordLedgerOperation({
  session,
  bookingId,
  operationType,
  opRef = 'default',
  meta = {},
  throwOnAlreadyApplied = false,
}) {
  const stringOpRef = String(opRef || 'default');
  const existing = await LedgerOperation.findOne({
    bookingId,
    operationType,
    opRef: stringOpRef,
  }).session(session);

  if (existing) {
    if (throwOnAlreadyApplied) {
      throw new AppError(
        ERROR_CODES.OPERATION_ALREADY_APPLIED,
        `Operation ${operationType} has already been applied for booking ${bookingId}`,
        409,
        { bookingId, operationType, opRef: stringOpRef },
      );
    }
    return {
      alreadyApplied: true,
      status: 'already_applied',
      bookingId,
      operationType,
      opRef: stringOpRef,
    };
  }

  await LedgerOperation.create(
    [
      {
        bookingId,
        operationType,
        opRef: stringOpRef,
        createdAt: new Date(),
        meta,
      },
    ],
    { session },
  );
  return { alreadyApplied: false };
}

/**
 * Adds demo funds to a user's wallet.
 */
export async function addDemoFunds({ userId, amountPaise, idempotency = null, meta = {} }) {
  assertPaise(amountPaise, 'amountPaise');

  try {
    return await runInTransactionWithRetry(async (session) => {
      // 1. Verify user status
      const user = await User.findById(userId).session(session);
      assertUserEligibleForWallet(user);

      // 2. Ensure wallet document exists
      await Wallet.getOrCreate(userId, session);

      // 3. Conditional atomic update: balance + amount must not exceed WALLET_CAP_PAISE
      const updatedWallet = await Wallet.findOneAndUpdate(
        {
          userId,
          $expr: {
            $lte: [
              { $add: ['$availablePaise', '$frozenPaise'] },
              BUSINESS_CONFIG.WALLET_CAP_PAISE - amountPaise,
            ],
          },
        },
        {
          $inc: { availablePaise: amountPaise },
          $set: { updatedAt: new Date() },
        },
        { session, new: true },
      );

      if (!updatedWallet) {
        throw new AppError(
          ERROR_CODES.WALLET_CAP_EXCEEDED,
          `Adding Rs ${amountPaise / 100} would exceed the maximum wallet cap of Rs ${
            BUSINESS_CONFIG.WALLET_CAP_PAISE / 100
          }`,
          409,
        );
      }

      const txnId = crypto.randomUUID();

      // 4. Ledger entries
      const entries = [
        {
          txnId,
          account: 'demo_funding',
          userId: null,
          amountPaise: -amountPaise,
          balanceAfterPaise: null,
          type: 'deposit_funds',
          idempotencyKey: idempotency?.key || null,
          meta,
          createdAt: new Date(),
        },
        {
          txnId,
          account: 'available',
          userId,
          amountPaise,
          balanceAfterPaise: updatedWallet.availablePaise,
          type: 'deposit_funds',
          idempotencyKey: idempotency?.key || null,
          meta,
          createdAt: new Date(),
        },
      ];

      assertZeroSum(entries);
      await LedgerEntry.insertMany(entries, { session });

      const responseData = {
        availablePaise: updatedWallet.availablePaise,
        frozenPaise: updatedWallet.frozenPaise,
        pendingPaise: 0,
        addedPaise: amountPaise,
        demo: true,
      };

      if (idempotency) {
        await saveIdempotencyRecord({
          userId,
          key: idempotency.key,
          requestHash: idempotency.requestHash,
          statusCode: 200,
          responseBody: responseData,
          session,
        });
      }

      return responseData;
    });
  } catch (error) {
    if (idempotency && isIdempotencyDuplicateError(error)) {
      let existing = await IdempotencyKey.findOne({
        userId,
        key: idempotency.key,
      });
      if (!existing) {
        for (let i = 0; i < 4; i++) {
          await new Promise((resolve) => setTimeout(resolve, 50));
          existing = await IdempotencyKey.findOne({
            userId,
            key: idempotency.key,
          });
          if (existing) break;
        }
      }
      if (existing) {
        if (existing.requestHash !== idempotency.requestHash) {
          throw new AppError(
            ERROR_CODES.IDEMPOTENCY_KEY_REUSE,
            'Idempotency key has already been used with different request parameters',
            409,
          );
        }
        return {
          ...existing.responseBody,
          _isReplay: true,
          _statusCode: existing.statusCode,
        };
      }
      throw new AppError(
        ERROR_CODES.IDEMPOTENCY_IN_PROGRESS,
        'A request with this idempotency key is currently in progress',
        409,
      );
    }
    throw error;
  }
}

/**
 * Withdraws demo funds from a user's wallet.
 */
export async function withdrawDemoFunds({ userId, amountPaise, idempotency = null, meta = {} }) {
  assertPaise(amountPaise, 'amountPaise');

  try {
    return await runInTransactionWithRetry(async (session) => {
      // 1. Verify user status
      const user = await User.findById(userId).session(session);
      assertUserEligibleForWallet(user);

      await Wallet.getOrCreate(userId, session);

      // 2. Conditional atomic update: availablePaise must be >= amountPaise
      const updatedWallet = await Wallet.findOneAndUpdate(
        {
          userId,
          availablePaise: { $gte: amountPaise },
        },
        {
          $inc: { availablePaise: -amountPaise },
          $set: { updatedAt: new Date() },
        },
        { session, new: true },
      );

      if (!updatedWallet) {
        throw new AppError(
          ERROR_CODES.INSUFFICIENT_FUNDS,
          'Insufficient available wallet balance for withdrawal',
          409,
        );
      }

      const txnId = crypto.randomUUID();

      const entries = [
        {
          txnId,
          account: 'available',
          userId,
          amountPaise: -amountPaise,
          balanceAfterPaise: updatedWallet.availablePaise,
          type: 'withdraw_funds',
          idempotencyKey: idempotency?.key || null,
          meta,
          createdAt: new Date(),
        },
        {
          txnId,
          account: 'demo_funding',
          userId: null,
          amountPaise,
          balanceAfterPaise: null,
          type: 'withdraw_funds',
          idempotencyKey: idempotency?.key || null,
          meta,
          createdAt: new Date(),
        },
      ];

      assertZeroSum(entries);
      await LedgerEntry.insertMany(entries, { session });

      const responseData = {
        availablePaise: updatedWallet.availablePaise,
        frozenPaise: updatedWallet.frozenPaise,
        pendingPaise: 0,
        withdrawnPaise: amountPaise,
        demo: true,
      };

      if (idempotency) {
        await saveIdempotencyRecord({
          userId,
          key: idempotency.key,
          requestHash: idempotency.requestHash,
          statusCode: 200,
          responseBody: responseData,
          session,
        });
      }

      return responseData;
    });
  } catch (error) {
    if (idempotency && isIdempotencyDuplicateError(error)) {
      let existing = await IdempotencyKey.findOne({
        userId,
        key: idempotency.key,
      });
      if (!existing) {
        for (let i = 0; i < 4; i++) {
          await new Promise((resolve) => setTimeout(resolve, 50));
          existing = await IdempotencyKey.findOne({
            userId,
            key: idempotency.key,
          });
          if (existing) break;
        }
      }
      if (existing) {
        if (existing.requestHash !== idempotency.requestHash) {
          throw new AppError(
            ERROR_CODES.IDEMPOTENCY_KEY_REUSE,
            'Idempotency key has already been used with different request parameters',
            409,
          );
        }
        return {
          ...existing.responseBody,
          _isReplay: true,
          _statusCode: existing.statusCode,
        };
      }
      throw new AppError(
        ERROR_CODES.IDEMPOTENCY_IN_PROGRESS,
        'A request with this idempotency key is currently in progress',
        409,
      );
    }
    throw error;
  }
}

/**
 * Freezes funds in borrower's wallet for a booking hold (rent + deposit).
 */
export async function freezeBookingFunds({
  borrowerId,
  bookingId,
  rentPaise,
  depositPaise,
  opRef = 'default',
  idempotency = null,
  meta = {},
  throwOnAlreadyApplied = false,
  session: externalSession = null,
}) {
  assertPaise(rentPaise, 'rentPaise');
  assertPaise(depositPaise, 'depositPaise');
  const totalHoldPaise = rentPaise + depositPaise;

  const execute = async (session) => {
    const op = await recordLedgerOperation({
      session,
      bookingId,
      operationType: 'booking_hold',
      opRef,
      meta,
      throwOnAlreadyApplied,
    });
    if (op.alreadyApplied) {
      return op;
    }

    const user = await User.findById(borrowerId).session(session);
    assertUserEligibleForWallet(user);

    await Wallet.getOrCreate(borrowerId, session);

    const updatedWallet = await Wallet.findOneAndUpdate(
      {
        userId: borrowerId,
        availablePaise: { $gte: totalHoldPaise },
      },
      {
        $inc: { availablePaise: -totalHoldPaise, frozenPaise: totalHoldPaise },
        $set: { updatedAt: new Date() },
      },
      { session, new: true },
    );

    if (!updatedWallet) {
      throw new AppError(
        ERROR_CODES.INSUFFICIENT_FUNDS,
        'Insufficient available wallet balance to accept booking hold',
        409,
      );
    }

    const txnId = crypto.randomUUID();
    const holdMeta = { ...meta, rentPaise, depositPaise };

    const entries = [
      {
        txnId,
        bookingId,
        account: 'available',
        userId: borrowerId,
        amountPaise: -totalHoldPaise,
        balanceAfterPaise: updatedWallet.availablePaise,
        type: 'booking_hold',
        idempotencyKey: idempotency?.key || null,
        meta: holdMeta,
        createdAt: new Date(),
      },
      {
        txnId,
        bookingId,
        account: 'frozen',
        userId: borrowerId,
        amountPaise: totalHoldPaise,
        balanceAfterPaise: updatedWallet.frozenPaise,
        type: 'booking_hold',
        idempotencyKey: idempotency?.key || null,
        meta: holdMeta,
        createdAt: new Date(),
      },
    ];

    assertZeroSum(entries);
    await LedgerEntry.insertMany(entries, { session });

    return {
      availablePaise: updatedWallet.availablePaise,
      frozenPaise: updatedWallet.frozenPaise,
      heldPaise: totalHoldPaise,
    };
  };

  try {
    if (externalSession) {
      return await execute(externalSession);
    }
    return await runInTransactionWithRetry(execute);
  } catch (err) {
    if (isLedgerOpDuplicateError(err)) {
      if (throwOnAlreadyApplied) {
        throw new AppError(
          ERROR_CODES.OPERATION_ALREADY_APPLIED,
          `Operation booking_hold has already been applied for booking ${bookingId}`,
          409,
          { bookingId, operationType: 'booking_hold', opRef },
        );
      }
      return {
        alreadyApplied: true,
        status: 'already_applied',
        bookingId,
        operationType: 'booking_hold',
        opRef,
      };
    }
    throw err;
  }
}

/**
 * Holds additional funds for an approved booking extension.
 */
export async function holdExtensionFunds({
  borrowerId,
  bookingId,
  extraRentPaise,
  extensionId = null,
  opRef = null,
  idempotency = null,
  meta = {},
  throwOnAlreadyApplied = false,
  session: externalSession = null,
}) {
  assertPaise(extraRentPaise, 'extraRentPaise');
  const actualOpRef = extensionId || opRef || 'default';

  const execute = async (session) => {
    const op = await recordLedgerOperation({
      session,
      bookingId,
      operationType: 'extension_hold',
      opRef: actualOpRef,
      meta,
      throwOnAlreadyApplied,
    });
    if (op.alreadyApplied) {
      return op;
    }

    const user = await User.findById(borrowerId).session(session);
    assertUserEligibleForWallet(user);

    await Wallet.getOrCreate(borrowerId, session);

    const updatedWallet = await Wallet.findOneAndUpdate(
      {
        userId: borrowerId,
        availablePaise: { $gte: extraRentPaise },
      },
      {
        $inc: { availablePaise: -extraRentPaise, frozenPaise: extraRentPaise },
        $set: { updatedAt: new Date() },
      },
      { session, new: true },
    );

    if (!updatedWallet) {
      throw new AppError(
        ERROR_CODES.INSUFFICIENT_FUNDS,
        'Insufficient available wallet balance for extension',
        409,
      );
    }

    const txnId = crypto.randomUUID();

    const entries = [
      {
        txnId,
        bookingId,
        account: 'available',
        userId: borrowerId,
        amountPaise: -extraRentPaise,
        balanceAfterPaise: updatedWallet.availablePaise,
        type: 'extension_hold',
        idempotencyKey: idempotency?.key || null,
        meta,
        createdAt: new Date(),
      },
      {
        txnId,
        bookingId,
        account: 'frozen',
        userId: borrowerId,
        amountPaise: extraRentPaise,
        balanceAfterPaise: updatedWallet.frozenPaise,
        type: 'extension_hold',
        idempotencyKey: idempotency?.key || null,
        meta,
        createdAt: new Date(),
      },
    ];

    assertZeroSum(entries);
    await LedgerEntry.insertMany(entries, { session });

    return {
      availablePaise: updatedWallet.availablePaise,
      frozenPaise: updatedWallet.frozenPaise,
      extraHeldPaise: extraRentPaise,
    };
  };

  try {
    if (externalSession) {
      return await execute(externalSession);
    }
    return await runInTransactionWithRetry(execute);
  } catch (err) {
    if (isLedgerOpDuplicateError(err)) {
      if (throwOnAlreadyApplied) {
        throw new AppError(
          ERROR_CODES.OPERATION_ALREADY_APPLIED,
          `Operation extension_hold has already been applied for booking ${bookingId}`,
          409,
          { bookingId, operationType: 'extension_hold', opRef: actualOpRef },
        );
      }
      return {
        alreadyApplied: true,
        status: 'already_applied',
        bookingId,
        operationType: 'extension_hold',
        opRef: actualOpRef,
      };
    }
    throw err;
  }
}

/**
 * Releases deposit funds from borrower's frozen account back to available.
 */
export async function releaseDeposit({
  borrowerId,
  bookingId,
  depositPaise,
  opRef = 'default',
  idempotency = null,
  meta = {},
  throwOnAlreadyApplied = false,
}) {
  assertPaise(depositPaise, 'depositPaise');

  try {
    return await runInTransactionWithRetry(async (session) => {
      const op = await recordLedgerOperation({
        session,
        bookingId,
        operationType: 'deposit_release',
        opRef,
        meta,
        throwOnAlreadyApplied,
      });
      if (op.alreadyApplied) {
        return op;
      }

      // Item 3: Compute held deposit from ledger for this booking inside transaction
      const depositHolds = await LedgerEntry.find({
        userId: borrowerId,
        bookingId,
        account: 'frozen',
      }).session(session);

      const netFrozenPaise = depositHolds.reduce((sum, e) => sum + e.amountPaise, 0);
      const holdEntry = depositHolds.find((e) => e.type === 'booking_hold' && e.amountPaise > 0);
      const maxAllowedDeposit =
        holdEntry?.meta?.depositPaise !== undefined ? holdEntry.meta.depositPaise : netFrozenPaise;

      const refundableDeposit = Math.min(netFrozenPaise, maxAllowedDeposit);

      if (refundableDeposit <= 0 || depositPaise > refundableDeposit) {
        throw new AppError(
          ERROR_CODES.INSUFFICIENT_FUNDS,
          `Deposit release amount (${depositPaise} paise) exceeds held deposit funds (${refundableDeposit} paise) for booking ${bookingId}`,
          400,
          { bookingId, depositPaise, refundableDeposit },
        );
      }

      await Wallet.getOrCreate(borrowerId, session);

      const updatedWallet = await Wallet.findOneAndUpdate(
        {
          userId: borrowerId,
          frozenPaise: { $gte: depositPaise },
        },
        {
          $inc: { frozenPaise: -depositPaise, availablePaise: depositPaise },
          $set: { updatedAt: new Date() },
        },
        { session, new: true },
      );

      if (!updatedWallet) {
        throw new AppError(
          ERROR_CODES.INTERNAL_ERROR,
          'Insufficient frozen funds to release deposit',
          500,
        );
      }

      const txnId = crypto.randomUUID();

      const entries = [
        {
          txnId,
          bookingId,
          account: 'frozen',
          userId: borrowerId,
          amountPaise: -depositPaise,
          balanceAfterPaise: updatedWallet.frozenPaise,
          type: 'deposit_release',
          idempotencyKey: idempotency?.key || null,
          meta,
          createdAt: new Date(),
        },
        {
          txnId,
          bookingId,
          account: 'available',
          userId: borrowerId,
          amountPaise: depositPaise,
          balanceAfterPaise: updatedWallet.availablePaise,
          type: 'deposit_release',
          idempotencyKey: idempotency?.key || null,
          meta,
          createdAt: new Date(),
        },
      ];

      assertZeroSum(entries);
      await LedgerEntry.insertMany(entries, { session });

      return {
        availablePaise: updatedWallet.availablePaise,
        frozenPaise: updatedWallet.frozenPaise,
        releasedPaise: depositPaise,
      };
    });
  } catch (err) {
    if (isLedgerOpDuplicateError(err)) {
      if (throwOnAlreadyApplied) {
        throw new AppError(
          ERROR_CODES.OPERATION_ALREADY_APPLIED,
          `Operation deposit_release has already been applied for booking ${bookingId}`,
          409,
          { bookingId, operationType: 'deposit_release', opRef },
        );
      }
      return {
        alreadyApplied: true,
        status: 'already_applied',
        bookingId,
        operationType: 'deposit_release',
        opRef,
      };
    }
    throw err;
  }
}

/**
 * Refunds all frozen booking funds upon cancellation before pickup.
 */
export async function refundCancelledBooking({
  borrowerId,
  bookingId,
  totalFrozenPaise,
  opRef = 'default',
  idempotency = null,
  meta = {},
  throwOnAlreadyApplied = false,
  session: externalSession = null,
}) {
  assertPaise(totalFrozenPaise, 'totalFrozenPaise');

  const execute = async (session) => {
    const op = await recordLedgerOperation({
      session,
      bookingId,
      operationType: 'booking_cancel_refund',
      opRef,
      meta,
      throwOnAlreadyApplied,
    });
    if (op.alreadyApplied) {
      return op;
    }

    // Item 3: Compute held frozen amount from the ledger for this booking inside transaction
    const frozenEntries = await LedgerEntry.find({
      userId: borrowerId,
      bookingId,
      account: 'frozen',
    }).session(session);

    const heldFrozenPaise = frozenEntries.reduce((sum, e) => sum + e.amountPaise, 0);

    if (heldFrozenPaise <= 0 || totalFrozenPaise > heldFrozenPaise) {
      throw new AppError(
        ERROR_CODES.INSUFFICIENT_FUNDS,
        `Refund amount (${totalFrozenPaise} paise) exceeds held frozen funds (${heldFrozenPaise} paise) for booking ${bookingId}`,
        400,
        { bookingId, totalFrozenPaise, heldFrozenPaise },
      );
    }

    await Wallet.getOrCreate(borrowerId, session);

    const updatedWallet = await Wallet.findOneAndUpdate(
      {
        userId: borrowerId,
        frozenPaise: { $gte: totalFrozenPaise },
      },
      {
        $inc: { frozenPaise: -totalFrozenPaise, availablePaise: totalFrozenPaise },
        $set: { updatedAt: new Date() },
      },
      { session, new: true },
    );

    if (!updatedWallet) {
      throw new AppError(
        ERROR_CODES.INTERNAL_ERROR,
        'Insufficient frozen funds for cancellation refund',
        500,
      );
    }

    const txnId = crypto.randomUUID();

    const entries = [
      {
        txnId,
        bookingId,
        account: 'frozen',
        userId: borrowerId,
        amountPaise: -totalFrozenPaise,
        balanceAfterPaise: updatedWallet.frozenPaise,
        type: 'booking_cancel_refund',
        idempotencyKey: idempotency?.key || null,
        meta,
        createdAt: new Date(),
      },
      {
        txnId,
        bookingId,
        account: 'available',
        userId: borrowerId,
        amountPaise: totalFrozenPaise,
        balanceAfterPaise: updatedWallet.availablePaise,
        type: 'booking_cancel_refund',
        idempotencyKey: idempotency?.key || null,
        meta,
        createdAt: new Date(),
      },
    ];

    assertZeroSum(entries);
    await LedgerEntry.insertMany(entries, { session });

    return {
      availablePaise: updatedWallet.availablePaise,
      frozenPaise: updatedWallet.frozenPaise,
      refundedPaise: totalFrozenPaise,
    };
  };

  try {
    if (externalSession) {
      return await execute(externalSession);
    }
    return await runInTransactionWithRetry(execute);
  } catch (err) {
    if (isLedgerOpDuplicateError(err)) {
      if (throwOnAlreadyApplied) {
        throw new AppError(
          ERROR_CODES.OPERATION_ALREADY_APPLIED,
          `Operation booking_cancel_refund has already been applied for booking ${bookingId}`,
          409,
          { bookingId, operationType: 'booking_cancel_refund', opRef },
        );
      }
      return {
        alreadyApplied: true,
        status: 'already_applied',
        bookingId,
        operationType: 'booking_cancel_refund',
        opRef,
      };
    }
    throw err;
  }
}

/**
 * Settles booking completion with 15% platform commission rounded to nearest paisa.
 * Payout above wallet cap is explicitly permitted.
 */
export async function settleBookingCompletion({
  bookingId,
  lenderId,
  borrowerId,
  rentPaise,
  depositPaise,
  lateChargePaise = 0,
  opRef = 'default',
  idempotency = null,
  meta = {},
  throwOnAlreadyApplied = false,
  session: externalSession = null,
}) {
  assertPaise(rentPaise, 'rentPaise');
  assertPaise(depositPaise, 'depositPaise');
  assertPaise(lateChargePaise, 'lateChargePaise');

  const totalHeldPaise = rentPaise + depositPaise;
  if (lateChargePaise > depositPaise) {
    throw new AppError(
      ERROR_CODES.VALIDATION_ERROR,
      'Late charge cannot exceed security deposit',
      400,
    );
  }

  // Earnings subject to commission: rent + late charge
  const lenderEarningsPaise = rentPaise + lateChargePaise;
  const commissionPaise = Math.round(
    (lenderEarningsPaise * BUSINESS_CONFIG.COMMISSION_BPS) / 10000,
  );
  const lenderPayoutPaise = lenderEarningsPaise - commissionPaise;
  const borrowerDepositRefundPaise = depositPaise - lateChargePaise;

  const execute = async (session) => {
    const op = await recordLedgerOperation({
      session,
      bookingId,
      operationType: 'settlement',
      opRef,
      meta,
      throwOnAlreadyApplied,
    });
    if (op.alreadyApplied) {
      return op;
    }

    // 1. Ensure wallets exist
    await Wallet.getOrCreate(borrowerId, session);
    await Wallet.getOrCreate(lenderId, session);

    // 2. Decrement borrower frozen funds and refund unused deposit
    const borrowerWallet = await Wallet.findOneAndUpdate(
      {
        userId: borrowerId,
        frozenPaise: { $gte: totalHeldPaise },
      },
      {
        $inc: {
          frozenPaise: -totalHeldPaise,
          availablePaise: borrowerDepositRefundPaise,
        },
        $set: { updatedAt: new Date() },
      },
      { session, new: true },
    );

    if (!borrowerWallet) {
      throw new AppError(
        ERROR_CODES.INTERNAL_ERROR,
        'Borrower does not have sufficient frozen funds for settlement',
        500,
      );
    }

    // 3. Credit lender available balance (no cap restriction for payouts!)
    const lenderWallet = await Wallet.findOneAndUpdate(
      { userId: lenderId },
      {
        $inc: { availablePaise: lenderPayoutPaise },
        $set: { updatedAt: new Date() },
      },
      { session, new: true },
    );

    const txnId = crypto.randomUUID();

    // 4. Balanced double-entry records
    const entries = [
      // Borrower frozen debit for full hold
      {
        txnId,
        bookingId,
        account: 'frozen',
        userId: borrowerId,
        amountPaise: -totalHeldPaise,
        balanceAfterPaise: borrowerWallet.frozenPaise,
        type: 'settlement',
        idempotencyKey: idempotency?.key || null,
        meta,
        createdAt: new Date(),
      },
    ];

    // Deposit release to borrower if refund > 0
    if (borrowerDepositRefundPaise > 0) {
      entries.push({
        txnId,
        bookingId,
        account: 'available',
        userId: borrowerId,
        amountPaise: borrowerDepositRefundPaise,
        balanceAfterPaise: borrowerWallet.availablePaise,
        type: 'deposit_release',
        idempotencyKey: idempotency?.key || null,
        meta,
        createdAt: new Date(),
      });
    }

    // Lender payout
    entries.push({
      txnId,
      bookingId,
      account: 'available',
      userId: lenderId,
      amountPaise: lenderPayoutPaise,
      balanceAfterPaise: lenderWallet.availablePaise,
      type: 'settlement',
      idempotencyKey: idempotency?.key || null,
      meta,
      createdAt: new Date(),
    });

    // Platform commission
    entries.push({
      txnId,
      bookingId,
      account: 'platform_revenue',
      userId: null,
      amountPaise: commissionPaise,
      balanceAfterPaise: null,
      type: 'commission',
      idempotencyKey: idempotency?.key || null,
      meta,
      createdAt: new Date(),
    });

    assertZeroSum(entries);
    await LedgerEntry.insertMany(entries, { session });

    return {
      borrowerRefundPaise: borrowerDepositRefundPaise,
      lenderPayoutPaise,
      commissionPaise,
      lenderEarningsPaise,
    };
  };

  try {
    if (externalSession) {
      return await execute(externalSession);
    }
    return await runInTransactionWithRetry(execute);
  } catch (err) {
    if (isLedgerOpDuplicateError(err)) {
      if (throwOnAlreadyApplied) {
        throw new AppError(
          ERROR_CODES.OPERATION_ALREADY_APPLIED,
          `Operation settlement has already been applied for booking ${bookingId}`,
          409,
          { bookingId, operationType: 'settlement', opRef },
        );
      }
      return {
        alreadyApplied: true,
        status: 'already_applied',
        bookingId,
        operationType: 'settlement',
        opRef,
      };
    }
    throw err;
  }
}

export default {
  assertUserEligibleForWallet,
  runInTransactionWithRetry,
  addDemoFunds,
  withdrawDemoFunds,
  freezeBookingFunds,
  holdExtensionFunds,
  releaseDeposit,
  refundCancelledBooking,
  settleBookingCompletion,
};
