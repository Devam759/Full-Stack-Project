/**
 * @file packages/shared/src/bookingStateMachine.js
 * Single source of truth for the booking lifecycle state transitions.
 * Enforces:
 * - Allowed from/to status transitions
 * - Role authorization per transition
 * - Required guard checks and side-effects
 * Every pair not explicitly in this table is rejected with INVALID_BOOKING_TRANSITION.
 */

export const BOOKING_TRANSITIONS = Object.freeze([
  // 1. Borrower submits request
  {
    from: null,
    event: 'CREATE_REQUEST',
    to: 'requested',
    actors: Object.freeze(['borrower']),
    guards: Object.freeze([
      'borrower_is_active_and_verified',
      'item_is_active',
      'borrower_not_lender',
      'common_community_membership',
      'dates_free_and_valid',
      'borrower_has_available_funds',
    ]),
    ledgerOp: null,
    opRef: null,
  },
  // 2. Lender accepts request
  {
    from: 'requested',
    event: 'ACCEPT_REQUEST',
    to: 'accepted',
    actors: Object.freeze(['lender']),
    guards: Object.freeze([
      'booking_is_requested',
      'item_day_locks_acquired',
      'borrower_has_available_funds',
    ]),
    ledgerOp: 'booking_hold',
    opRef: 'default',
    sideEffects: Object.freeze([
      'create_day_locks',
      'auto_reject_overlapping_requests',
      'emit_accepted_event',
    ]),
  },
  // 3. Lender rejects request
  {
    from: 'requested',
    event: 'REJECT_REQUEST',
    to: 'cancelled',
    actors: Object.freeze(['lender']),
    guards: Object.freeze(['booking_is_requested']),
    ledgerOp: null,
    opRef: null,
    sideEffects: Object.freeze(['emit_rejected_event']),
  },
  // Auto-reject overlapping requests when another booking is accepted
  {
    from: 'requested',
    event: 'AUTO_REJECT_OVERLAPPING',
    to: 'cancelled',
    actors: Object.freeze(['system']),
    guards: Object.freeze(['overlapping_dates_accepted']),
    ledgerOp: null,
    opRef: null,
    sideEffects: Object.freeze(['emit_rejected_event']),
  },
  // 4. Request expires without response (24h)
  {
    from: 'requested',
    event: 'EXPIRE_REQUEST',
    to: 'expired',
    actors: Object.freeze(['system']),
    guards: Object.freeze(['request_older_than_24h']),
    ledgerOp: null,
    opRef: null,
    sideEffects: Object.freeze(['emit_expired_event']),
  },
  // 5. Borrower cancels before acceptance
  {
    from: 'requested',
    event: 'CANCEL_REQUEST',
    to: 'cancelled',
    actors: Object.freeze(['borrower']),
    guards: Object.freeze(['booking_is_requested']),
    ledgerOp: null,
    opRef: null,
    sideEffects: Object.freeze(['emit_cancelled_event']),
  },
  // 6. Cancellation after acceptance but before pickup
  {
    from: 'accepted',
    event: 'CANCEL_BOOKING',
    to: 'cancelled',
    actors: Object.freeze(['borrower', 'lender']),
    guards: Object.freeze(['booking_is_accepted', 'pickup_not_occurred']),
    ledgerOp: 'booking_cancel_refund',
    opRef: 'default',
    sideEffects: Object.freeze([
      'release_day_locks',
      'refund_frozen_funds',
      'check_late_cancel_penalty_stub',
      'emit_cancelled_event',
    ]),
  },
  // 7. Pickup deadline expired (no show by end of start date)
  {
    from: 'accepted',
    event: 'EXPIRE_PICKUP',
    to: 'expired',
    actors: Object.freeze(['system']),
    guards: Object.freeze(['past_pickup_deadline_end_of_start_day', 'pickup_not_occurred']),
    ledgerOp: 'booking_cancel_refund',
    opRef: 'default',
    sideEffects: Object.freeze(['release_day_locks', 'refund_frozen_funds', 'emit_no_show_stub']),
  },
  // 8. Extension requested by borrower
  {
    from: 'accepted',
    event: 'REQUEST_EXTENSION',
    to: 'accepted', // Status remains accepted; extension subdocument is modified
    actors: Object.freeze(['borrower']),
    guards: Object.freeze([
      'booking_is_active',
      'extension_count_under_limit',
      'no_pending_extension',
      'requested_days_free',
      'borrower_has_funds_for_extra_rent',
    ]),
    ledgerOp: null,
    opRef: null,
  },
  // 9. Extension accepted by lender
  {
    from: 'accepted',
    event: 'ACCEPT_EXTENSION',
    to: 'accepted',
    actors: Object.freeze(['lender']),
    guards: Object.freeze([
      'extension_is_requested',
      'requested_days_free',
      'borrower_has_funds_for_extra_rent',
    ]),
    ledgerOp: 'extension_hold',
    opRef: 'extensionId',
    sideEffects: Object.freeze(['create_extension_day_locks', 'emit_extension_accepted_event']),
  },
  // 10. Extension rejected by lender
  {
    from: 'accepted',
    event: 'REJECT_EXTENSION',
    to: 'accepted',
    actors: Object.freeze(['lender']),
    guards: Object.freeze(['extension_is_requested']),
    ledgerOp: null,
    opRef: null,
    sideEffects: Object.freeze(['emit_extension_rejected_event']),
  },
  // 11. Extension expired by system
  {
    from: 'accepted',
    event: 'EXPIRE_EXTENSION',
    to: 'accepted',
    actors: Object.freeze(['system']),
    guards: Object.freeze(['extension_is_requested', 'extension_older_than_24h']),
    ledgerOp: null,
    opRef: null,
    sideEffects: Object.freeze(['refund_extension_hold', 'emit_extension_expired_event']),
  },
  // 12. Pickup handover (lender scans borrower QR code)
  {
    from: 'accepted',
    event: 'PICKUP_HANDOVER',
    to: 'picked_up',
    actors: Object.freeze(['lender']),
    guards: Object.freeze(['booking_is_accepted', 'valid_handover_code']),
    ledgerOp: null,
    opRef: null,
    sideEffects: Object.freeze(['record_pickup_timestamp', 'emit_picked_up_event']),
  },
  // 13. Extensions while picked_up
  {
    from: 'picked_up',
    event: 'REQUEST_EXTENSION',
    to: 'picked_up',
    actors: Object.freeze(['borrower']),
    guards: Object.freeze([
      'booking_is_active',
      'extension_count_under_limit',
      'no_pending_extension',
      'requested_days_free',
      'borrower_has_funds_for_extra_rent',
    ]),
    ledgerOp: null,
    opRef: null,
  },
  {
    from: 'picked_up',
    event: 'ACCEPT_EXTENSION',
    to: 'picked_up',
    actors: Object.freeze(['lender']),
    guards: Object.freeze([
      'extension_is_requested',
      'requested_days_free',
      'borrower_has_funds_for_extra_rent',
    ]),
    ledgerOp: 'extension_hold',
    opRef: 'extensionId',
    sideEffects: Object.freeze(['create_extension_day_locks', 'emit_extension_accepted_event']),
  },
  {
    from: 'picked_up',
    event: 'REJECT_EXTENSION',
    to: 'picked_up',
    actors: Object.freeze(['lender']),
    guards: Object.freeze(['extension_is_requested']),
    ledgerOp: null,
    opRef: null,
    sideEffects: Object.freeze(['emit_extension_rejected_event']),
  },
  {
    from: 'picked_up',
    event: 'EXPIRE_EXTENSION',
    to: 'picked_up',
    actors: Object.freeze(['system']),
    guards: Object.freeze(['extension_is_requested', 'extension_older_than_24h']),
    ledgerOp: null,
    opRef: null,
    sideEffects: Object.freeze(['refund_extension_hold', 'emit_extension_expired_event']),
  },
  // 14. Return handover (lender scans borrower return QR code)
  {
    from: 'picked_up',
    event: 'RETURN_HANDOVER',
    to: 'returned',
    actors: Object.freeze(['lender']),
    guards: Object.freeze(['booking_is_picked_up', 'valid_return_code']),
    ledgerOp: null,
    opRef: null,
    sideEffects: Object.freeze(['record_return_timestamp', 'emit_returned_event']),
  },
  // 15. Lender confirms return / completion
  {
    from: 'returned',
    event: 'CONFIRM_RETURN',
    to: 'completed',
    actors: Object.freeze(['lender']),
    guards: Object.freeze(['booking_is_returned']),
    ledgerOp: 'settlement',
    opRef: 'default',
    sideEffects: Object.freeze([
      'release_deposit',
      'transfer_rent_to_lender_less_commission',
      'emit_completed_event',
    ]),
  },
  // 16. Auto-completion after 24h by system
  {
    from: 'returned',
    event: 'AUTO_COMPLETE',
    to: 'completed',
    actors: Object.freeze(['system']),
    guards: Object.freeze(['booking_is_returned', 'no_active_dispute']),
    ledgerOp: 'settlement',
    opRef: 'default',
    sideEffects: Object.freeze([
      'release_deposit',
      'transfer_rent_to_lender_less_commission',
      'emit_completed_event',
    ]),
  },
]);

/**
 * Validates whether a transition from one state to another via an event is permitted for an actor role.
 *
 * @param {string | null} fromStatus
 * @param {string} event
 * @param {'borrower' | 'lender' | 'system' | 'admin'} actorRole
 * @returns {{ allowed: boolean, transition?: typeof BOOKING_TRANSITIONS[0], reason?: string }}
 */
export function canTransition(fromStatus, event, actorRole) {
  const match = BOOKING_TRANSITIONS.find((t) => t.from === fromStatus && t.event === event);
  if (!match) {
    return {
      allowed: false,
      reason: `No transition defined from status '${fromStatus}' via event '${event}'`,
    };
  }

  if (actorRole !== 'admin' && !match.actors.includes(actorRole)) {
    return {
      allowed: false,
      reason: `Actor role '${actorRole}' is not authorized to trigger '${event}' from '${fromStatus}'`,
    };
  }

  return {
    allowed: true,
    transition: match,
  };
}
