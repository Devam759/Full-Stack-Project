import { describe, it, expect } from 'vitest';
import { canTransition, BOOKING_TRANSITIONS } from '@borrowloop/shared';

describe('Booking State Machine (Unit Tests)', () => {
  it('allows all legal transitions for authorized roles', () => {
    // 1. Borrower submits request
    const createReq = canTransition(null, 'CREATE_REQUEST', 'borrower');
    expect(createReq.allowed).toBe(true);
    expect(createReq.transition.to).toBe('requested');

    // 2. Lender accepts request
    const acceptReq = canTransition('requested', 'ACCEPT_REQUEST', 'lender');
    expect(acceptReq.allowed).toBe(true);
    expect(acceptReq.transition.to).toBe('accepted');

    // 3. Lender rejects request
    const rejectReq = canTransition('requested', 'REJECT_REQUEST', 'lender');
    expect(rejectReq.allowed).toBe(true);
    expect(rejectReq.transition.to).toBe('cancelled');

    // 4. Request expires without response (24h)
    const expireReq = canTransition('requested', 'EXPIRE_REQUEST', 'system');
    expect(expireReq.allowed).toBe(true);
    expect(expireReq.transition.to).toBe('expired');

    // 5. Borrower cancels before acceptance
    const cancelReq = canTransition('requested', 'CANCEL_REQUEST', 'borrower');
    expect(cancelReq.allowed).toBe(true);
    expect(cancelReq.transition.to).toBe('cancelled');

    // 6. Cancellation after acceptance but before pickup
    const cancelAcceptedBorrower = canTransition('accepted', 'CANCEL_BOOKING', 'borrower');
    expect(cancelAcceptedBorrower.allowed).toBe(true);
    expect(cancelAcceptedBorrower.transition.to).toBe('cancelled');

    const cancelAcceptedLender = canTransition('accepted', 'CANCEL_BOOKING', 'lender');
    expect(cancelAcceptedLender.allowed).toBe(true);
    expect(cancelAcceptedLender.transition.to).toBe('cancelled');

    // 7. Pickup deadline expired
    const expirePickup = canTransition('accepted', 'EXPIRE_PICKUP', 'system');
    expect(expirePickup.allowed).toBe(true);
    expect(expirePickup.transition.to).toBe('expired');

    // 8. Extension requested by borrower
    const reqExt = canTransition('accepted', 'REQUEST_EXTENSION', 'borrower');
    expect(reqExt.allowed).toBe(true);

    // 9. Extension accepted by lender
    const acceptExt = canTransition('accepted', 'ACCEPT_EXTENSION', 'lender');
    expect(acceptExt.allowed).toBe(true);

    // 10. Extension rejected by lender
    const rejectExt = canTransition('accepted', 'REJECT_EXTENSION', 'lender');
    expect(rejectExt.allowed).toBe(true);
  });

  it('rejects unauthorized roles for legal transitions', () => {
    // borrower cannot accept or reject requested booking
    expect(canTransition('requested', 'ACCEPT_REQUEST', 'borrower').allowed).toBe(false);
    expect(canTransition('requested', 'REJECT_REQUEST', 'borrower').allowed).toBe(false);

    // lender cannot cancel requested booking (only borrower can cancel before accept)
    expect(canTransition('requested', 'CANCEL_REQUEST', 'lender').allowed).toBe(false);

    // system cannot accept or reject booking
    expect(canTransition('requested', 'ACCEPT_REQUEST', 'system').allowed).toBe(false);

    // borrower cannot accept extension
    expect(canTransition('accepted', 'ACCEPT_EXTENSION', 'borrower').allowed).toBe(false);

    // lender cannot request extension
    expect(canTransition('accepted', 'REQUEST_EXTENSION', 'lender').allowed).toBe(false);
  });

  it('allows admin role for any transition defined in the table', () => {
    expect(canTransition('requested', 'ACCEPT_REQUEST', 'admin').allowed).toBe(true);
    expect(canTransition('requested', 'REJECT_REQUEST', 'admin').allowed).toBe(true);
    expect(canTransition('requested', 'CANCEL_REQUEST', 'admin').allowed).toBe(true);
  });

  it('rejects illegal transitions from terminal or non-matching states', () => {
    // Terminal states cannot transition
    expect(canTransition('cancelled', 'ACCEPT_REQUEST', 'lender').allowed).toBe(false);
    expect(canTransition('expired', 'ACCEPT_REQUEST', 'lender').allowed).toBe(false);

    // Cannot accept when already accepted
    expect(canTransition('accepted', 'ACCEPT_REQUEST', 'lender').allowed).toBe(false);

    // Cannot trigger extension when requested
    expect(canTransition('requested', 'REQUEST_EXTENSION', 'borrower').allowed).toBe(false);
  });

  it('rejects unknown events or non-existent status', () => {
    expect(canTransition('requested', 'UNKNOWN_EVENT', 'lender').allowed).toBe(false);
    expect(canTransition('non_existent_status', 'ACCEPT_REQUEST', 'lender').allowed).toBe(false);
    expect(canTransition('requested', 'ACCEPT_REQUEST', 'unknown_role').allowed).toBe(false);
  });

  it('verifies BOOKING_TRANSITIONS integrity', () => {
    expect(Array.isArray(BOOKING_TRANSITIONS)).toBe(true);
    for (const t of BOOKING_TRANSITIONS) {
      expect(t).toHaveProperty('event');
      expect(t).toHaveProperty('to');
      expect(Array.isArray(t.actors)).toBe(true);
    }
  });
});
