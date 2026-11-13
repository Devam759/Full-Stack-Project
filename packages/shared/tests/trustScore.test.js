import { describe, it, expect } from 'vitest';
import {
  calculateTrustScore,
  computeDistinctOnTimeCount,
  PENALTY_DELTAS,
} from '../src/trustScore.js';

describe('trustScore (Unit Tests)', () => {
  it('starts at 50 with 0 ratings, 0 on-time completions, and 0 penalties', () => {
    const score = calculateTrustScore({
      ratingAvg: 0,
      ratingCount: 0,
      onTimeCount: 0,
      penalties: 0,
    });
    expect(score).toBe(50);
  });

  it('calculates ratingPart correctly for 1, 10, and 11 ratings', () => {
    // 1 rating of 5 stars: round(20 * ((5 - 3) / 2) * min(1, 10) / 10) = round(20 * 1 * 0.1) = 2
    const score1 = calculateTrustScore({
      ratingAvg: 5.0,
      ratingCount: 1,
      onTimeCount: 0,
      penalties: 0,
    });
    expect(score1).toBe(52); // 50 + 2

    // 10 ratings of 5 stars: round(20 * 1 * 1.0) = 20
    const score10 = calculateTrustScore({
      ratingAvg: 5.0,
      ratingCount: 10,
      onTimeCount: 0,
      penalties: 0,
    });
    expect(score10).toBe(70); // 50 + 20

    // 11 ratings of 5 stars: min(11, 10) / 10 = 1.0, still full effect 20
    const score11 = calculateTrustScore({
      ratingAvg: 5.0,
      ratingCount: 11,
      onTimeCount: 0,
      penalties: 0,
    });
    expect(score11).toBe(70); // 50 + 20

    // 10 ratings of 1 star: round(20 * ((1 - 3) / 2) * 1.0) = -20
    const scoreMin10 = calculateTrustScore({
      ratingAvg: 1.0,
      ratingCount: 10,
      onTimeCount: 0,
      penalties: 0,
    });
    expect(scoreMin10).toBe(30); // 50 - 20
  });

  it('calculates onTimePart and caps at +20 points (10 completions)', () => {
    // 1 on-time completion: 2 * 1 = +2 points
    expect(calculateTrustScore({ onTimeCount: 1 })).toBe(52);

    // 5 on-time completions: 2 * 5 = +10 points
    expect(calculateTrustScore({ onTimeCount: 5 })).toBe(60);

    // 10 on-time completions: 2 * 10 = +20 points
    expect(calculateTrustScore({ onTimeCount: 10 })).toBe(70);

    // 15 on-time completions: capped at +20 points
    expect(calculateTrustScore({ onTimeCount: 15 })).toBe(70);
  });

  it('correctly deduplicates counterparties per role with computeDistinctOnTimeCount', () => {
    const events = [
      { counterpartyId: 'user_A', role: 'lend' },
      { counterpartyId: 'user_A', role: 'lend' }, // duplicate, should be ignored
      { counterpartyId: 'user_A', role: 'borrow' }, // same user, different role -> counts
      { counterpartyId: 'user_B', role: 'lend' }, // distinct user -> counts
      { counterpartyId: 'user_B', role: 'lend' }, // duplicate -> ignored
      { counterpartyId: null, role: 'lend' }, // invalid -> ignored
    ];

    const distinctCount = computeDistinctOnTimeCount(events);
    expect(distinctCount).toBe(3); // (lend:user_A), (borrow:user_A), (lend:user_B)
  });

  it('applies standard penalty deltas correctly', () => {
    // Lost dispute: -10
    expect(calculateTrustScore({ penalties: [PENALTY_DELTAS.lost_dispute] })).toBe(40);

    // Late cancel: -3
    expect(calculateTrustScore({ penalties: [PENALTY_DELTAS.late_cancel] })).toBe(47);

    // Rejected damage claim: -5
    expect(calculateTrustScore({ penalties: [PENALTY_DELTAS.rejected_damage_claim] })).toBe(45);

    // No-show: -5
    expect(calculateTrustScore({ penalties: [PENALTY_DELTAS.no_show] })).toBe(45);

    // Combined penalties as object
    expect(
      calculateTrustScore({
        penalties: {
          lostDisputes: 1, // -10
          lateCancels: 2, // -6
          rejectedDamageClaims: 1, // -5
          noShows: 1, // -5
        },
      }),
    ).toBe(50 - 26); // 24
  });

  it('strictly clamps trust score between 0 and 100', () => {
    // Extreme negative penalties clamped to 0
    const superLow = calculateTrustScore({
      ratingAvg: 1.0,
      ratingCount: 10, // -20
      penalties: -100, // -100
    });
    expect(superLow).toBe(0);

    // Super high positive combination clamped to 100
    const superHigh = calculateTrustScore({
      ratingAvg: 5.0,
      ratingCount: 20, // +20
      onTimeCount: 15, // +20
      penalties: 50, // even if positive adjustment
    });
    expect(superHigh).toBe(100);

    // Property check: random inputs always fall inside [0, 100]
    for (let avg = 1; avg <= 5; avg += 0.5) {
      for (let count = 0; count <= 25; count += 5) {
        for (let onTime = 0; onTime <= 20; onTime += 5) {
          for (let pen = -50; pen <= 10; pen += 10) {
            const score = calculateTrustScore({
              ratingAvg: avg,
              ratingCount: count,
              onTimeCount: onTime,
              penalties: pen,
            });
            expect(score).toBeGreaterThanOrEqual(0);
            expect(score).toBeLessThanOrEqual(100);
          }
        }
      }
    }
  });
});
