import { describe, it, expect } from 'vitest';
import { computeDisputeSettlement } from '../src/disputeSettlement.js';

describe('computeDisputeSettlement Pure Engine (Sub-step 9a)', () => {
  it('accurately computes settlement with rent to lender and partial deposit split', () => {
    const result = computeDisputeSettlement({
      rentPaise: 2000_00, // Rs 2000
      depositPaise: 5000_00, // Rs 5000
      appliedLateChargePaise: 500_00, // Rs 500 late fee
      rentOutcome: 'lender',
      depositToLenderPaise: 1500_00, // Rs 1500 damage compensation
      depositToBorrowerPaise: 3000_00, // Rs 3000 remainder (5000 - 500 = 4500; 1500 + 3000 = 4500)
      commissionBps: 1500, // 15%
    });

    // Lender earnings subject to 15%: rent (2000) + late charge (500) = 2500
    // Commission: 15% of 2500_00 = 375_00
    expect(result.commissionPaise).toBe(375_00);
    // Net earnings: 2500_00 - 375_00 = 2125_00
    // Plus deposit compensation (1500_00 with 0% commission): 3625_00
    expect(result.lenderAvailablePaise).toBe(3625_00);
    // Borrower refund: 0 rent refund + 3000_00 deposit = 3000_00
    expect(result.borrowerAvailablePaise).toBe(3000_00);

    // INVARIANT: sum must exactly equal total held (2000 + 5000 = 7000)
    expect(
      result.borrowerAvailablePaise + result.lenderAvailablePaise + result.commissionPaise,
    ).toBe(7000_00);
  });

  it('accurately computes settlement with rent refunded to borrower', () => {
    const result = computeDisputeSettlement({
      rentPaise: 1000_00,
      depositPaise: 2000_00,
      appliedLateChargePaise: 0,
      rentOutcome: 'refund_borrower',
      depositToLenderPaise: 500_00,
      depositToBorrowerPaise: 1500_00,
      commissionBps: 1500,
    });

    // Lender earns 0 rent, 0 late fee -> commission is 0
    expect(result.commissionPaise).toBe(0);
    // Lender gets only deposit compensation (500_00, 0% comm)
    expect(result.lenderAvailablePaise).toBe(500_00);
    // Borrower gets full rent (1000_00) + deposit refund (1500_00) = 2500_00
    expect(result.borrowerAvailablePaise).toBe(2500_00);

    // Sum invariant: 2500 + 500 + 0 = 3000
    expect(
      result.borrowerAvailablePaise + result.lenderAvailablePaise + result.commissionPaise,
    ).toBe(3000_00);
  });

  it('accurately computes no-show full refund with zero commission', () => {
    const result = computeDisputeSettlement({
      rentPaise: 3000_00,
      depositPaise: 4000_00,
      appliedLateChargePaise: 0,
      rentOutcome: 'refund_borrower',
      depositToLenderPaise: 0,
      depositToBorrowerPaise: 4000_00,
      commissionBps: 1500,
    });

    expect(result.commissionPaise).toBe(0);
    expect(result.lenderAvailablePaise).toBe(0);
    expect(result.borrowerAvailablePaise).toBe(7000_00);
    expect(
      result.borrowerAvailablePaise + result.lenderAvailablePaise + result.commissionPaise,
    ).toBe(7000_00);
  });

  it('property-based test: always strictly sums to total held across 100 random permutations', () => {
    for (let i = 0; i < 100; i++) {
      const rentPaise = Math.floor(Math.random() * 50000);
      const depositPaise = Math.floor(Math.random() * 50000);
      const appliedLateChargePaise = Math.floor(Math.random() * depositPaise);
      const remainingDeposit = depositPaise - appliedLateChargePaise;
      const depositToLenderPaise = Math.floor(Math.random() * remainingDeposit);
      const depositToBorrowerPaise = remainingDeposit - depositToLenderPaise;
      const rentOutcome = Math.random() > 0.5 ? 'lender' : 'refund_borrower';

      const res = computeDisputeSettlement({
        rentPaise,
        depositPaise,
        appliedLateChargePaise,
        rentOutcome,
        depositToLenderPaise,
        depositToBorrowerPaise,
        commissionBps: 1500,
      });

      expect(res.borrowerAvailablePaise + res.lenderAvailablePaise + res.commissionPaise).toBe(
        rentPaise + depositPaise,
      );
    }
  });

  it('rejects deposit splits that do not sum to remaining deposit', () => {
    expect(() =>
      computeDisputeSettlement({
        rentPaise: 1000_00,
        depositPaise: 2000_00,
        appliedLateChargePaise: 500_00, // remaining = 1500_00
        rentOutcome: 'lender',
        depositToLenderPaise: 1000_00,
        depositToBorrowerPaise: 1000_00, // sum is 2000 != 1500
      }),
    ).toThrow(/must equal remaining deposit/);
  });

  it('rejects invalid rent outcomes or non-integers', () => {
    expect(() =>
      computeDisputeSettlement({
        rentPaise: 1000.5,
        depositPaise: 2000,
        appliedLateChargePaise: 0,
        rentOutcome: 'lender',
        depositToLenderPaise: 500,
        depositToBorrowerPaise: 1500,
      }),
    ).toThrow(/safe integers/);

    expect(() =>
      computeDisputeSettlement({
        rentPaise: 1000,
        depositPaise: 2000,
        appliedLateChargePaise: 0,
        rentOutcome: 'invalid_outcome',
        depositToLenderPaise: 500,
        depositToBorrowerPaise: 1500,
      }),
    ).toThrow(/Invalid rentOutcome/);
  });
});
