/**
 * @file packages/shared/src/lateCharge.js
 * Pure function calculating overdue days and late fee charges in integer paise.
 * Follows docs/BUSINESS_RULES.md:
 * lateDays = max(0, ceil((effectiveTime - dueAt) / 24h))
 * charge = min(lateDays * lateFeePerDayPaise, depositPaise)
 * effectiveTime is returnAt if returned, else now.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Calculates late days and accrued late charges capped by the security deposit.
 *
 * @param {Object} params
 * @param {Date | string | number} [params.effectiveTime] - Effective cutoff timestamp
 * @param {Date | string | number} [params.returnAt] - Optional return timestamp if effectiveTime not passed
 * @param {Date | string | number} params.dueAt - Booking due deadline
 * @param {number} [params.lateFeePerDayPaise=0] - Daily late charge set by lender
 * @param {number} [params.depositPaise=0] - Security deposit cap
 * @returns {{ lateDays: number, lateChargePaise: number }}
 */
export function calculateLateCharge({
  effectiveTime,
  returnAt,
  dueAt,
  lateFeePerDayPaise = 0,
  depositPaise = 0,
}) {
  const actualEffective = effectiveTime !== undefined ? effectiveTime : (returnAt ?? Date.now());
  const effectiveMs = new Date(actualEffective).getTime();
  const dueMs = new Date(dueAt).getTime();

  if (Number.isNaN(effectiveMs) || Number.isNaN(dueMs)) {
    throw new Error('Invalid timestamp passed to calculateLateCharge');
  }

  const diffMs = effectiveMs - dueMs;
  if (diffMs <= 0) {
    return {
      lateDays: 0,
      lateChargePaise: 0,
    };
  }

  const lateDays = Math.max(0, Math.ceil(diffMs / MS_PER_DAY));
  const fee = Math.max(0, Math.floor(lateFeePerDayPaise));
  const maxDeposit = Math.max(0, Math.floor(depositPaise));
  const lateChargePaise = Math.min(lateDays * fee, maxDeposit);

  return {
    lateDays,
    lateChargePaise,
  };
}

export default calculateLateCharge;
