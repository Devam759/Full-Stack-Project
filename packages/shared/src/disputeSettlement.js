/**
 * @file packages/shared/src/disputeSettlement.js
 * Pure mathematical calculation engine for dispute settlements and appeal reversals.
 * Enforces zero-sum double-entry ledger invariant:
 * borrowerAvailablePaise + lenderAvailablePaise + commissionPaise === rentPaise + depositPaise (totalHeldPaise).
 */

import { BUSINESS_CONFIG } from './config.js';

/**
 * Computes exact dispute settlement distribution in integer paise.
 *
 * @param {object} params
 * @param {number} params.rentPaise - Total rent held for booking (integer paise)
 * @param {number} params.depositPaise - Total deposit held for booking (integer paise)
 * @param {number} [params.appliedLateChargePaise=0] - Late charge accrued and applied (integer paise)
 * @param {'lender'|'refund_borrower'} params.rentOutcome - Whether lender earns rent or borrower is refunded
 * @param {number} params.depositToLenderPaise - Deposit compensation to lender (0% commission, integer paise)
 * @param {number} params.depositToBorrowerPaise - Remaining deposit refund to borrower (integer paise)
 * @param {number} [params.commissionBps=1500] - Platform commission basis points (15% = 1500)
 * @returns {object} Calculated monetary distribution
 */
export function computeDisputeSettlement({
  rentPaise,
  depositPaise,
  appliedLateChargePaise = 0,
  rentOutcome,
  depositToLenderPaise,
  depositToBorrowerPaise,
  commissionBps = BUSINESS_CONFIG.COMMISSION_BPS || 1500,
}) {
  if (
    !Number.isSafeInteger(rentPaise) ||
    !Number.isSafeInteger(depositPaise) ||
    !Number.isSafeInteger(appliedLateChargePaise) ||
    !Number.isSafeInteger(depositToLenderPaise) ||
    !Number.isSafeInteger(depositToBorrowerPaise)
  ) {
    throw new Error('All monetary amounts must be safe integers');
  }

  if (rentOutcome !== 'lender' && rentOutcome !== 'refund_borrower') {
    throw new Error(`Invalid rentOutcome '${rentOutcome}'. Must be 'lender' or 'refund_borrower'.`);
  }

  const remainingDepositPaise = depositPaise - appliedLateChargePaise;
  if (remainingDepositPaise < 0) {
    throw new Error('Applied late charge exceeds total security deposit');
  }

  if (depositToLenderPaise + depositToBorrowerPaise !== remainingDepositPaise) {
    throw new Error(
      `Deposit split (${depositToLenderPaise} + ${depositToBorrowerPaise} = ${depositToLenderPaise + depositToBorrowerPaise} paise) must equal remaining deposit (${remainingDepositPaise} paise)`,
    );
  }

  const totalHeldPaise = rentPaise + depositPaise;

  // Lender earnings subject to commission (15%): rent (if lender) + applied late charge
  const lenderEarningsPaise = (rentOutcome === 'lender' ? rentPaise : 0) + appliedLateChargePaise;
  const commissionPaise = Math.round((lenderEarningsPaise * commissionBps) / 10000);
  const netLenderEarningsPaise = lenderEarningsPaise - commissionPaise;

  // Deposit compensation to lender has 0% commission
  const lenderAvailablePaise = netLenderEarningsPaise + depositToLenderPaise;

  // Borrower refund: rent (if refund_borrower) + depositToBorrower
  const borrowerRentRefundPaise = rentOutcome === 'refund_borrower' ? rentPaise : 0;
  const borrowerAvailablePaise = borrowerRentRefundPaise + depositToBorrowerPaise;

  // Strict invariant sanity check
  if (borrowerAvailablePaise + lenderAvailablePaise + commissionPaise !== totalHeldPaise) {
    throw new Error(
      `Zero-sum violation: borrower (${borrowerAvailablePaise}) + lender (${lenderAvailablePaise}) + commission (${commissionPaise}) !== total held (${totalHeldPaise})`,
    );
  }

  return {
    borrowerAvailablePaise,
    lenderAvailablePaise,
    commissionPaise,
    lenderPayoutPaise: lenderAvailablePaise,
    borrowerRefundPaise: borrowerAvailablePaise,
    borrowerRentRefundPaise,
    totalHeldPaise,
    appliedLateChargePaise,
    remainingDepositPaise,
    lenderEarningsPaise,
    netLenderEarningsPaise,
    depositToLenderPaise,
    depositToBorrowerPaise,
    rentOutcome,
  };
}

export default {
  computeDisputeSettlement,
};
