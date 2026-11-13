import { describe, it, expect } from 'vitest';
import { canTransition, BOOKING_TRANSITIONS } from '../src/bookingStateMachine.js';

describe('Item 4: Generated Exhaustive Test over (status, event, actor) Combinations', () => {
  const allStatuses = [
    null,
    'requested',
    'accepted',
    'picked_up',
    'returned',
    'completed',
    'cancelled',
    'expired',
    'disputed',
    'invalid_status_xyz',
  ];

  const allEvents = [
    'CREATE_REQUEST',
    'ACCEPT_REQUEST',
    'REJECT_REQUEST',
    'AUTO_REJECT_OVERLAPPING',
    'EXPIRE_REQUEST',
    'CANCEL_REQUEST',
    'CANCEL_BOOKING',
    'EXPIRE_PICKUP',
    'REQUEST_EXTENSION',
    'ACCEPT_EXTENSION',
    'REJECT_EXTENSION',
    'EXPIRE_EXTENSION',
    'PICKUP_HANDOVER',
    'RETURN_HANDOVER',
    'CONFIRM_RETURN_ALL_GOOD',
    'AUTO_COMPLETE_ALL_GOOD',
    'CLAIM_LATE_CHARGE',
    'OPEN_DISPUTE_DAMAGED',
    'OPEN_DISPUTE_NOT_RETURNED',
    'DISPUTE_RESOLVED_ALL_GOOD',
    'DISPUTE_RESOLVED_COMPENSATE',
    'ADMIN_OVERRIDE_CANCEL',
    'UNKNOWN_EVENT',
  ];

  const allActors = ['borrower', 'lender', 'system', 'admin', 'care_agent', 'stranger'];

  it('exhaustively evaluates all status x event x actor combinations against the state machine', () => {
    let testedCombinations = 0;
    let allowedCount = 0;
    let rejectedCount = 0;

    for (const status of allStatuses) {
      for (const event of allEvents) {
        for (const actor of allActors) {
          testedCombinations++;
          const result = canTransition(status, event, actor);

          // Find if there is an explicit definition in BOOKING_TRANSITIONS
          const matchingTransition = BOOKING_TRANSITIONS.find(
            (t) => t.from === status && t.event === event,
          );

          const isAuthorized =
            matchingTransition && (actor === 'admin' || matchingTransition.actors.includes(actor));

          if (isAuthorized) {
            expect(
              result.allowed,
              `Expected transition (${status}, ${event}, ${actor}) to be ALLOWED`,
            ).toBe(true);
            expect(result.transition).toBeDefined();
            expect(result.transition.to).toBe(matchingTransition.to);
            allowedCount++;
          } else {
            expect(
              result.allowed,
              `Expected transition (${status}, ${event}, ${actor}) to be REJECTED`,
            ).toBe(false);
            expect(result.reason).toBeDefined();
            rejectedCount++;
          }
        }
      }
    }

    expect(testedCombinations).toBe(allStatuses.length * allEvents.length * allActors.length);
    expect(allowedCount).toBeGreaterThan(0);
    expect(rejectedCount).toBeGreaterThan(0);

    console.info(
      `Exhaustive State Machine Test: Tested ${testedCombinations} combinations (${allowedCount} allowed, ${rejectedCount} rejected).`,
    );
  });
});
