/**
 * @file apps/portal/src/utils.js
 * Utility helpers for formatting, PII masking, and idempotency in the Operations Portal.
 */

/**
 * Masks an email address for privacy (e.g. a***@g***.com).
 * @param {string} email
 * @returns {string}
 */
export function maskEmail(email) {
  if (!email || typeof email !== 'string') return '***@***.***';
  const atIdx = email.indexOf('@');
  if (atIdx === -1) return '***';
  const local = email.slice(0, atIdx);
  const domain = email.slice(atIdx + 1);
  const dotIdx = domain.lastIndexOf('.');
  const domainName = dotIdx !== -1 ? domain.slice(0, dotIdx) : domain;
  const domainTld = dotIdx !== -1 ? domain.slice(dotIdx) : '';
  const maskedLocal = local.length > 0 ? `${local[0]}***` : '***';
  const maskedDomain = domainName.length > 0 ? `${domainName[0]}***` : '***';
  return `${maskedLocal}@${maskedDomain}${domainTld}`;
}

/**
 * Formats integer paise into Indian Rupee display.
 * @param {number} paise
 * @returns {string}
 */
export function formatPaise(paise) {
  if (paise === null || paise === undefined || isNaN(paise)) return '₹0.00';
  const rupees = Number(paise) / 100;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(rupees);
}

/**
 * Generates a client-side idempotency key for mutations.
 * @returns {string}
 */
export function generateIdempotencyKey(prefix = 'portal') {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}
