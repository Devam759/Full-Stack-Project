import { describe, it, expect } from 'vitest';
import { calculateLateCharge } from '../src/lateCharge.js';

describe('lateCharge (Unit Tests)', () => {
  const baseDue = new Date('2026-06-10T12:00:00.000Z');
  const feePerDay = 500_00; // Rs 500/day
  const deposit = 2000_00; // Rs 2000 deposit

  it('calculates 0 late days and 0 charge when returned exactly on time or early (0 s late)', () => {
    // Exactly on time (0s late)
    const exact = calculateLateCharge({
      effectiveTime: baseDue,
      dueAt: baseDue,
      lateFeePerDayPaise: feePerDay,
      depositPaise: deposit,
    });
    expect(exact.lateDays).toBe(0);
    expect(exact.lateChargePaise).toBe(0);

    // Early return (1 hour before due)
    const early = calculateLateCharge({
      effectiveTime: new Date(baseDue.getTime() - 3600 * 1000),
      dueAt: baseDue,
      lateFeePerDayPaise: feePerDay,
      depositPaise: deposit,
    });
    expect(early.lateDays).toBe(0);
    expect(early.lateChargePaise).toBe(0);
  });

  it('calculates 1 late day and 1 day fee when 1 second late', () => {
    const oneSecLate = new Date(baseDue.getTime() + 1000);
    const res = calculateLateCharge({
      effectiveTime: oneSecLate,
      dueAt: baseDue,
      lateFeePerDayPaise: feePerDay,
      depositPaise: deposit,
    });
    expect(res.lateDays).toBe(1);
    expect(res.lateChargePaise).toBe(feePerDay);
  });

  it('calculates exactly 1 late day when exactly 24 hours late', () => {
    const exactly24h = new Date(baseDue.getTime() + 24 * 60 * 60 * 1000);
    const res = calculateLateCharge({
      effectiveTime: exactly24h,
      dueAt: baseDue,
      lateFeePerDayPaise: feePerDay,
      depositPaise: deposit,
    });
    expect(res.lateDays).toBe(1);
    expect(res.lateChargePaise).toBe(feePerDay);
  });

  it('calculates 2 late days when 24 hours and 1 second late', () => {
    const twentyFourAndOneSec = new Date(baseDue.getTime() + 24 * 60 * 60 * 1000 + 1000);
    const res = calculateLateCharge({
      effectiveTime: twentyFourAndOneSec,
      dueAt: baseDue,
      lateFeePerDayPaise: feePerDay,
      depositPaise: deposit,
    });
    expect(res.lateDays).toBe(2);
    expect(res.lateChargePaise).toBe(2 * feePerDay);
  });

  it('strictly caps the total late charge at the security deposit', () => {
    // 10 days late would be 10 * 500 = 5000, but deposit is 2000
    const tenDaysLate = new Date(baseDue.getTime() + 10 * 24 * 60 * 60 * 1000);
    const res = calculateLateCharge({
      effectiveTime: tenDaysLate,
      dueAt: baseDue,
      lateFeePerDayPaise: feePerDay,
      depositPaise: deposit,
    });
    expect(res.lateDays).toBe(10);
    expect(res.lateChargePaise).toBe(deposit);
    expect(res.lateChargePaise).toBeLessThanOrEqual(deposit);
  });

  it('calculates 0 late charge when late fee per day is 0', () => {
    const fiveDaysLate = new Date(baseDue.getTime() + 5 * 24 * 60 * 60 * 1000);
    const res = calculateLateCharge({
      effectiveTime: fiveDaysLate,
      dueAt: baseDue,
      lateFeePerDayPaise: 0,
      depositPaise: deposit,
    });
    expect(res.lateDays).toBe(5);
    expect(res.lateChargePaise).toBe(0);
  });

  it('uses returnAt when effectiveTime is omitted', () => {
    const returnedLate = new Date(baseDue.getTime() + 2 * 24 * 60 * 60 * 1000);
    const res = calculateLateCharge({
      returnAt: returnedLate,
      dueAt: baseDue,
      lateFeePerDayPaise: feePerDay,
      depositPaise: deposit,
    });
    expect(res.lateDays).toBe(2);
    expect(res.lateChargePaise).toBe(2 * feePerDay);
  });

  it('throws an error if invalid date timestamps are passed', () => {
    expect(() =>
      calculateLateCharge({
        effectiveTime: 'invalid-date',
        dueAt: baseDue,
      }),
    ).toThrow('Invalid timestamp passed to calculateLateCharge');
  });
});
