/**
 * @file packages/shared/src/money.js
 * High-integrity monetary helpers using integer paise.
 * In accordance with AGENTS.md Hard Rules 1 & 2:
 * 1. All money amounts are stored as integers in paise. Never use floating point for money.
 * 2. Commission is rounded to the nearest paisa; payout = total - commission.
 */

import { BUSINESS_CONFIG } from './config.js';

/**
 * Asserts that a value is a valid integer paise amount.
 * @param {unknown} value
 * @param {string} [name='amount']
 * @param {boolean} [allowNegative=false]
 * @returns {number}
 */
export function assertPaise(value, name = 'amount', allowNegative = false) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new TypeError(`[Money] ${name} must be a safe integer in paise, received: ${value}`);
  }
  if (!allowNegative && value < 0) {
    throw new RangeError(`[Money] ${name} cannot be negative, received: ${value}`);
  }
  return value;
}

/**
 * Validates integer grouping format for Western (1,000 / 1,000,000) and Indian (1,00,000 / 10,00,000) systems.
 *
 * @param {string} intStr
 * @returns {boolean}
 */
function isValidIntegerGrouping(intStr) {
  // 1. Plain digits without commas
  if (/^\d+$/.test(intStr)) return true;

  // 2. Standard 3-digit grouping (e.g. 1,000 or 1,000,000)
  if (/^\d{1,3}(,\d{3})+$/.test(intStr)) return true;

  // 3. Indian numbering system grouping (e.g. 1,00,000 or 10,00,000 or 1,00,00,000)
  if (/^\d{1,2}(,\d{2})*,\d{3}$/.test(intStr)) return true;

  return false;
}

/**
 * Converts a rupee amount (number or string) to integer paise in a float-safe manner.
 * Handles float inaccuracies like (0.1 + 0.2) while strictly rejecting fractional paise (> 2 decimals).
 * Accepts "1,000" and Indian grouping "1,00,000", but rejects malformed grouping such as "1,00" and "1,,0".
 * Strictly rejects negatives, empty, NaN, and amounts with more than 2 decimal places.
 *
 * @param {number|string} rupees
 * @returns {number} integer paise
 */
export function toPaise(rupees) {
  if (typeof rupees === 'string') {
    const trimmed = rupees.trim();
    if (trimmed.length === 0) {
      throw new TypeError('[Money] Empty string is not a valid amount');
    }

    if (trimmed.startsWith('-')) {
      throw new RangeError(`[Money] Negative amounts not allowed: "${rupees}"`);
    }

    const parts = trimmed.split('.');
    if (parts.length > 2) {
      throw new TypeError(
        `[Money] Invalid rupees string format with multiple decimal points: "${rupees}"`,
      );
    }

    const [intPart, fracPart] = parts;
    if (!intPart || !isValidIntegerGrouping(intPart)) {
      throw new TypeError(`[Money] Invalid rupees string format: "${rupees}"`);
    }

    if (fracPart !== undefined) {
      if (!/^\d+$/.test(fracPart)) {
        throw new TypeError(`[Money] Invalid decimal format: "${rupees}"`);
      }
      if (fracPart.length > 2) {
        throw new RangeError(
          `[Money] Rupees cannot have more than 2 decimal places (fractional paise): "${rupees}"`,
        );
      }
    }

    const cleanInt = intPart.replace(/,/g, '');
    const paddedFrac = ((fracPart || '') + '00').slice(0, 2);
    const paise = Number(cleanInt) * 100 + Number(paddedFrac);

    if (!Number.isSafeInteger(paise)) {
      throw new RangeError(`[Money] Amount exceeds safe integer limits: "${rupees}"`);
    }
    return paise;
  }

  if (typeof rupees === 'number') {
    if (Number.isNaN(rupees)) {
      throw new TypeError('[Money] Rupees must be a finite number, received: NaN');
    }
    if (!Number.isFinite(rupees)) {
      throw new TypeError(`[Money] Rupees must be a finite number, received: ${rupees}`);
    }
    if (rupees < 0) {
      throw new RangeError(`[Money] Negative amounts not allowed: ${rupees}`);
    }

    // Convert using nearest paisa to eliminate IEEE-754 binary float drift (e.g. 0.1 + 0.2 = 0.30000000000000004)
    const paiseCandidate = Math.round(rupees * 100);

    // If the difference between rupees and paiseCandidate / 100 exceeds an epsilon threshold,
    // the user passed genuine fractional paise (e.g. 19.999), which must be rejected.
    if (Math.abs(rupees - paiseCandidate / 100) > 1e-4) {
      throw new RangeError(`[Money] Rupees cannot have fractional paise: ${rupees}`);
    }

    if (!Number.isSafeInteger(paiseCandidate)) {
      throw new RangeError(`[Money] Amount exceeds safe integer limits: ${rupees}`);
    }

    return paiseCandidate;
  }

  throw new TypeError(`[Money] Expected number or string for rupees, received: ${typeof rupees}`);
}

/**
 * Converts integer paise to a rupee decimal number.
 * @param {number} paise
 * @returns {number}
 */
export function toRupees(paise) {
  assertPaise(paise, 'paise', true);
  return paise / 100;
}

/**
 * Formats integer paise for display with currency symbol and optional "Demo money" indicator.
 * @param {number} paise
 * @param {object} [options]
 * @param {boolean} [options.includeSymbol=true]
 * @param {boolean} [options.showDemoTag=false]
 * @returns {string}
 */
export function formatPaise(paise, { includeSymbol = true, showDemoTag = false } = {}) {
  assertPaise(paise, 'paise', true);
  const isNegative = paise < 0;
  const absPaise = Math.abs(paise);
  const rupeesStr = (absPaise / 100).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  const formatted = `${isNegative ? '-' : ''}${includeSymbol ? '₹' : ''}${rupeesStr}`;
  return showDemoTag ? `${formatted} (Demo money)` : formatted;
}

/**
 * Calculates platform commission rounded to the nearest paisa and remaining payout.
 * Invariant: payout = total - commission.
 *
 * @param {number} totalPaise
 * @param {number} [bps=BUSINESS_CONFIG.COMMISSION_BPS]
 * @returns {{ totalPaise: number, commissionPaise: number, payoutPaise: number }}
 */
export function calculateCommission(totalPaise, bps = BUSINESS_CONFIG.COMMISSION_BPS) {
  assertPaise(totalPaise, 'totalPaise');
  assertPaise(bps, 'bps');

  const commissionPaise = Math.round((totalPaise * bps) / 10_000);
  const payoutPaise = totalPaise - commissionPaise;

  return {
    totalPaise,
    commissionPaise,
    payoutPaise,
  };
}

/**
 * Adds multiple integer paise values safely.
 * @param {...number} amounts
 * @returns {number}
 */
export function addPaise(...amounts) {
  return amounts.reduce((acc, curr, idx) => {
    assertPaise(curr, `amounts[${idx}]`, true);
    const sum = acc + curr;
    if (!Number.isSafeInteger(sum)) {
      throw new RangeError(`[Money] Addition overflowed safe integer limits`);
    }
    return sum;
  }, 0);
}

/**
 * Subtracts b from a safely in integer paise.
 * @param {number} a
 * @param {number} b
 * @param {boolean} [allowNegative=false]
 * @returns {number}
 */
export function subtractPaise(a, b, allowNegative = false) {
  assertPaise(a, 'a', allowNegative);
  assertPaise(b, 'b', allowNegative);
  const diff = a - b;
  if (!Number.isSafeInteger(diff)) {
    throw new RangeError(`[Money] Subtraction overflowed safe integer limits`);
  }
  if (!allowNegative && diff < 0) {
    throw new RangeError(`[Money] Insufficient funds: ${a} - ${b} results in negative balance`);
  }
  return diff;
}
