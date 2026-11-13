/**
 * @file packages/shared/src/trustScore.js
 * Pure functions calculating user trust score and counterparty deduplication.
 * Follows docs/BUSINESS_RULES.md:
 * ratingPart = round(20 * ((avg - 3) / 2) * min(count, 10) / 10)
 * onTimePart = min(2 * onTimeCount, 20)
 * score = clamp(50 + ratingPart + onTimePart + sum(penalties), 0, 100)
 * Penalties: lost dispute -10, late cancel -3, rejected damage claim -5, no-show -5.
 * onTimeCount counts each distinct counterparty once per role (lend or borrow).
 */

export const PENALTY_DELTAS = Object.freeze({
  lost_dispute: -10,
  late_cancel: -3,
  rejected_damage_claim: -5,
  no_show: -5,
});

/**
 * Deduplicates completed on-time borrow/lend events by distinct counterparty per role.
 *
 * @param {Array<{ counterpartyId: string | object, role: 'lend' | 'borrow' }>} events
 * @returns {number} Count of unique (role, counterpartyId) pairs
 */
export function computeDistinctOnTimeCount(events = []) {
  if (!Array.isArray(events)) return 0;
  const uniquePairs = new Set();
  for (const ev of events) {
    if (!ev) continue;
    const counterparty = ev.counterpartyId?.toString?.() || String(ev.counterpartyId || '');
    const role = ev.role;
    if (counterparty && (role === 'lend' || role === 'borrow')) {
      uniquePairs.add(`${role}:${counterparty}`);
    }
  }
  return uniquePairs.size;
}

/**
 * Computes the trust score for a user between 0 and 100.
 *
 * @param {Object} params
 * @param {number} [params.ratingAvg=0] - Current average rating (1.0 to 5.0)
 * @param {number} [params.ratingCount=0] - Total count of revealed ratings
 * @param {number} [params.onTimeCount=0] - Number of on-time completions with distinct counterparties per role
 * @param {number | Array<number | string | { delta?: number, type?: string }> | Object} [params.penalties=0] - Penalties or list of penalty events
 * @returns {number} Calculated trust score clamped to [0, 100]
 */
export function calculateTrustScore({
  ratingAvg = 0,
  ratingCount = 0,
  onTimeCount = 0,
  penalties = 0,
}) {
  const count = Math.max(0, Math.floor(ratingCount));
  const avg = count > 0 ? Math.min(5, Math.max(1, Number(ratingAvg) || 0)) : 0;

  // ratingPart = round(20 * ((avg - 3) / 2) * min(count, 10) / 10)
  const ratingPart =
    count === 0 ? 0 : Math.round(20 * ((avg - 3) / 2) * (Math.min(count, 10) / 10));

  // onTimePart = min(2 * onTimeCount, 20)
  const validOnTimeCount = Math.max(0, Math.floor(Number(onTimeCount) || 0));
  const onTimePart = Math.min(2 * validOnTimeCount, 20);

  // Compute sum of penalties
  let penaltySum = 0;
  if (Array.isArray(penalties)) {
    for (const p of penalties) {
      if (typeof p === 'number') {
        penaltySum += p;
      } else if (typeof p === 'string' && PENALTY_DELTAS[p] !== undefined) {
        penaltySum += PENALTY_DELTAS[p];
      } else if (p && typeof p.delta === 'number') {
        penaltySum += p.delta;
      } else if (p && typeof p.type === 'string' && PENALTY_DELTAS[p.type] !== undefined) {
        penaltySum += PENALTY_DELTAS[p.type];
      }
    }
  } else if (typeof penalties === 'number') {
    penaltySum = penalties;
  } else if (penalties && typeof penalties === 'object') {
    if (penalties.lostDisputes) penaltySum += penalties.lostDisputes * PENALTY_DELTAS.lost_dispute;
    if (penalties.lateCancels) penaltySum += penalties.lateCancels * PENALTY_DELTAS.late_cancel;
    if (penalties.rejectedDamageClaims)
      penaltySum += penalties.rejectedDamageClaims * PENALTY_DELTAS.rejected_damage_claim;
    if (penalties.noShows) penaltySum += penalties.noShows * PENALTY_DELTAS.no_show;
  }

  const rawScore = 50 + ratingPart + onTimePart + penaltySum;
  return Math.max(0, Math.min(100, Math.round(rawScore)));
}

export default calculateTrustScore;
