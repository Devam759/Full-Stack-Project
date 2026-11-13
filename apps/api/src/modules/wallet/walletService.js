/**
 * @file apps/api/src/modules/wallet/walletService.js
 * High-level wallet service handling balances overview and cursor-paginated transaction history.
 */

import mongoose from 'mongoose';
import { BUSINESS_CONFIG } from '@borrowloop/shared';
import Wallet from '../../models/Wallet.js';
import LedgerEntry from '../../models/LedgerEntry.js';

/**
 * Encodes a keyset cursor string for transaction pagination.
 *
 * @param {Date} createdAt
 * @param {import('mongoose').Types.ObjectId | string} id
 * @returns {string} base64 encoded cursor
 */
export function encodeCursor(createdAt, id) {
  const payload = JSON.stringify({
    t: createdAt instanceof Date ? createdAt.toISOString() : new Date(createdAt).toISOString(),
    i: id.toString(),
  });
  return Buffer.from(payload, 'utf8').toString('base64url');
}

/**
 * Decodes a keyset cursor string.
 *
 * @param {string} cursor
 * @returns {{ createdAt: Date, id: mongoose.Types.ObjectId } | null}
 */
export function decodeCursor(cursor) {
  try {
    const raw = Buffer.from(cursor, 'base64url').toString('utf8');
    const parsed = JSON.parse(raw);
    if (!parsed.t || !parsed.i) return null;
    return {
      createdAt: new Date(parsed.t),
      id: new mongoose.Types.ObjectId(parsed.i),
    };
  } catch {
    return null;
  }
}

/**
 * Returns wallet balance overview for the user.
 *
 * @param {string | mongoose.Types.ObjectId} userId
 */
export async function getWalletOverview(userId) {
  const wallet = await Wallet.getOrCreate(userId);
  const totalPaise = wallet.availablePaise + wallet.frozenPaise;
  const canAddFunds = totalPaise < BUSINESS_CONFIG.WALLET_CAP_PAISE;

  return {
    availablePaise: wallet.availablePaise,
    frozenPaise: wallet.frozenPaise,
    pendingPaise: 0,
    totalPaise,
    capPaise: BUSINESS_CONFIG.WALLET_CAP_PAISE,
    canAddFunds,
    demo: true,
  };
}

/**
 * Fetches cursor-paginated transaction history for the authenticated user only.
 *
 * @param {string | mongoose.Types.ObjectId} userId
 * @param {object} queryOptions
 * @param {number} [queryOptions.limit=20]
 * @param {string} [queryOptions.cursor]
 */
export async function getTransactionHistory(userId, { limit = 20, cursor = null } = {}) {
  const query = {
    userId: new mongoose.Types.ObjectId(userId),
  };

  if (cursor) {
    const decoded = decodeCursor(cursor);
    if (decoded) {
      query.$or = [
        { createdAt: { $lt: decoded.createdAt } },
        { createdAt: decoded.createdAt, _id: { $lt: decoded.id } },
      ];
    }
  }

  const rawEntries = await LedgerEntry.find(query)
    .sort({ createdAt: -1, _id: -1 })
    .limit(limit + 1)
    .lean();

  const hasNextPage = rawEntries.length > limit;
  const entries = hasNextPage ? rawEntries.slice(0, limit) : rawEntries;

  let nextCursor = null;
  if (hasNextPage && entries.length > 0) {
    const lastEntry = entries[entries.length - 1];
    nextCursor = encodeCursor(lastEntry.createdAt, lastEntry._id);
  }

  // Strict Privacy: Only expose user's own movements, no counterparty details
  const items = entries.map((e) => ({
    id: e._id.toString(),
    amountPaise: e.amountPaise,
    balanceAfterPaise: e.balanceAfterPaise,
    account: e.account,
    type: e.type,
    createdAt: e.createdAt,
  }));

  return {
    items,
    nextCursor,
    demo: true,
  };
}

export default {
  encodeCursor,
  decodeCursor,
  getWalletOverview,
  getTransactionHistory,
};
