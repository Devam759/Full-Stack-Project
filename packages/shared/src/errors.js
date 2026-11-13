/**
 * @file packages/shared/src/errors.js
 * Standard API error codes and response builders matching docs/API_SPEC.md.
 */

export const ERROR_CODES = Object.freeze({
  // 400 Bad Request / Validation
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  BAD_REQUEST: 'BAD_REQUEST',
  INVALID_IDEMPOTENCY_KEY: 'INVALID_IDEMPOTENCY_KEY',
  BOOKING_START_DATE_PASSED: 'BOOKING_START_DATE_PASSED',
  PIN_OUT_OF_BOUNDS: 'PIN_OUT_OF_BOUNDS',

  // 401 Unauthorized
  UNAUTHORIZED: 'UNAUTHORIZED',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  TOKEN_REVOKED: 'TOKEN_REVOKED',
  TOTP_REQUIRED: 'TOTP_REQUIRED',
  INVALID_TOTP: 'INVALID_TOTP',

  // 403 Forbidden
  FORBIDDEN: 'FORBIDDEN',
  EMAIL_NOT_VERIFIED: 'EMAIL_NOT_VERIFIED',
  ACCOUNT_BANNED: 'ACCOUNT_BANNED',
  ACCOUNT_FROZEN: 'ACCOUNT_FROZEN',
  UNDERAGE: 'UNDERAGE',
  COMMUNITY_MEMBERSHIP_REQUIRED: 'COMMUNITY_MEMBERSHIP_REQUIRED',
  NOT_COMMUNITY_MEMBER: 'NOT_COMMUNITY_MEMBER',
  USER_BLOCKED: 'USER_BLOCKED',
  USER_NOT_ELIGIBLE: 'USER_NOT_ELIGIBLE',
  CANNOT_BORROW_OWN_ITEM: 'CANNOT_BORROW_OWN_ITEM',
  CANNOT_CONFIRM_OWN_PIN: 'CANNOT_CONFIRM_OWN_PIN',
  LENDER_UNAVAILABLE: 'LENDER_UNAVAILABLE',
  ITEM_NOT_ACTIVE: 'ITEM_NOT_ACTIVE',

  // 404 Not Found
  NOT_FOUND: 'NOT_FOUND',
  USER_NOT_FOUND: 'USER_NOT_FOUND',
  ITEM_NOT_FOUND: 'ITEM_NOT_FOUND',
  COMMUNITY_NOT_FOUND: 'COMMUNITY_NOT_FOUND',
  BOOKING_NOT_FOUND: 'BOOKING_NOT_FOUND',
  EXTENSION_NOT_FOUND: 'EXTENSION_NOT_FOUND',
  CONVERSATION_NOT_FOUND: 'CONVERSATION_NOT_FOUND',
  NOTIFICATION_NOT_FOUND: 'NOTIFICATION_NOT_FOUND',
  NO_ACTIVE_PIN_PROPOSAL: 'NO_ACTIVE_PIN_PROPOSAL',

  // 409 Conflict
  CONFLICT: 'CONFLICT',
  BOOKING_DATES_TAKEN: 'BOOKING_DATES_TAKEN',
  DATES_NOT_AVAILABLE: 'DATES_NOT_AVAILABLE',
  INVALID_BOOKING_TRANSITION: 'INVALID_BOOKING_TRANSITION',
  BOOKING_EXPIRED: 'BOOKING_EXPIRED',
  BOOKING_REQUEST_EXPIRED: 'BOOKING_REQUEST_EXPIRED',
  ITEM_UNAVAILABLE: 'ITEM_UNAVAILABLE',
  EXTENSION_NOT_ALLOWED: 'EXTENSION_NOT_ALLOWED',
  EXTENSION_ALREADY_PENDING: 'EXTENSION_ALREADY_PENDING',
  MAX_EXTENSIONS_REACHED: 'MAX_EXTENSIONS_REACHED',
  INSUFFICIENT_FUNDS: 'INSUFFICIENT_FUNDS',
  WALLET_CAP_EXCEEDED: 'WALLET_CAP_EXCEEDED',
  IDEMPOTENCY_KEY_REUSE: 'IDEMPOTENCY_KEY_REUSE',
  IDEMPOTENCY_IN_PROGRESS: 'IDEMPOTENCY_IN_PROGRESS',
  OPERATION_ALREADY_APPLIED: 'OPERATION_ALREADY_APPLIED',
  PIN_ALREADY_CONFIRMED: 'PIN_ALREADY_CONFIRMED',
  BOOKING_TERMINAL_CHAT_CLOSED: 'BOOKING_TERMINAL_CHAT_CLOSED',

  // 429 Rate Limit
  RATE_LIMITED: 'RATE_LIMITED',

  // 500 Server Error
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  LEDGER_INVARIANT_VIOLATION: 'LEDGER_INVARIANT_VIOLATION',

  // 503 Service Unavailable
  RETRY_EXHAUSTED: 'RETRY_EXHAUSTED',
});

/**
 * Custom application error with HTTP status code and standard details payload.
 */
export class AppError extends Error {
  /**
   * @param {string} code - One of ERROR_CODES
   * @param {string} message - Human-readable explanation
   * @param {number} [statusCode=500] - HTTP status code
   * @param {Record<string, unknown>} [details={}] - Optional details
   */
  constructor(code, message, statusCode = 500, details = {}) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }

  toJSON() {
    return formatErrorResponse(this.code, this.message, this.details);
  }
}

/**
 * Standard error formatter as specified in docs/API_SPEC.md:
 * { "error": { "code": "...", "message": "...", "details": {} } }
 *
 * @param {string} code
 * @param {string} message
 * @param {Record<string, unknown>} [details={}]
 * @returns {{ error: { code: string, message: string, details: Record<string, unknown> } }}
 */
export function formatErrorResponse(code, message, details = {}) {
  return {
    error: {
      code,
      message,
      details,
    },
  };
}
