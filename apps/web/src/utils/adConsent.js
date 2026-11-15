/**
 * @file apps/web/src/utils/adConsent.js
 * Helpers for GDPR/CCPA ad consent management and 180-day expiry enforcement.
 */

import { BUSINESS_CONFIG } from '@borrowloop/shared';

export const CONSENT_STORAGE_KEY = 'borrowloop_ad_consent';
export const CONSENT_MAX_AGE_DAYS = BUSINESS_CONFIG?.ADS?.CONSENT_MAX_AGE_DAYS || 180;

/**
 * Retrieves valid unexpired consent from localStorage.
 * Returns null if consent is missing or older than 180 days.
 * @returns {{ consented: boolean, timestamp: string } | null}
 */
export function getStoredConsent() {
  if (typeof window === 'undefined' || !window.localStorage) {
    return null;
  }
  try {
    const raw = localStorage.getItem(CONSENT_STORAGE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.consented !== 'boolean' || !parsed.timestamp) {
      return null;
    }

    const recordedTime = new Date(parsed.timestamp).getTime();
    if (isNaN(recordedTime)) return null;

    const ageDays = (Date.now() - recordedTime) / (1000 * 60 * 60 * 24);
    if (ageDays > CONSENT_MAX_AGE_DAYS) {
      return null; // Expired: forces re-prompt
    }

    return parsed;
  } catch {
    return null;
  }
}

/**
 * Saves consent decision with current ISO timestamp.
 * @param {boolean} consented
 * @returns {{ consented: boolean, timestamp: string }}
 */
export function setStoredConsent(consented) {
  if (typeof window === 'undefined' || !window.localStorage) {
    return { consented: Boolean(consented), timestamp: new Date().toISOString() };
  }
  const payload = {
    consented: Boolean(consented),
    timestamp: new Date().toISOString(),
  };
  localStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify(payload));
  window.dispatchEvent(new CustomEvent('ad-consent-changed', { detail: payload }));
  return payload;
}

/**
 * Withdraws consent immediately and dispatches change event.
 */
export function withdrawConsent() {
  return setStoredConsent(false);
}

export default {
  CONSENT_STORAGE_KEY,
  CONSENT_MAX_AGE_DAYS,
  getStoredConsent,
  setStoredConsent,
  withdrawConsent,
};
