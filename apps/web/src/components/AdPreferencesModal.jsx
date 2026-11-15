import React, { useState, useEffect } from 'react';
import { X, ShieldCheck, CheckCircle2, XCircle } from 'lucide-react';
import { getStoredConsent, setStoredConsent, withdrawConsent } from '../utils/adConsent.js';

export function AdPreferencesModal({ isOpen, onClose }) {
  const [consent, setConsent] = useState(() => getStoredConsent());

  useEffect(() => {
    if (isOpen) {
      setConsent(getStoredConsent());
    }

    const handleConsentChange = (e) => {
      setConsent(e.detail || getStoredConsent());
    };

    window.addEventListener('ad-consent-changed', handleConsentChange);
    return () => window.removeEventListener('ad-consent-changed', handleConsentChange);
  }, [isOpen]);

  if (!isOpen) return null;

  const handleWithdraw = () => {
    withdrawConsent();
  };

  const handleEnable = () => {
    setStoredConsent(true);
  };

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4 z-50">
      <div className="bg-surface rounded-xl max-w-md w-full p-6 space-y-4 border border-slate-200 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-primary" />
            <h3 className="font-heading font-bold text-base text-slate-900">
              Advertisement Preferences
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-3 text-xs text-text-muted">
          <p>
            BorrowLoop uses privacy-first Google AdSense placements on allowed public screens (Item
            catalog and details) to fund infrastructure.
          </p>

          <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-slate-700">Current Consent Status:</span>
              {consent?.consented ? (
                <span className="flex items-center gap-1 font-bold text-emerald-700">
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Ads Allowed</span>
                </span>
              ) : (
                <span className="flex items-center gap-1 font-bold text-slate-500">
                  <XCircle className="w-4 h-4 text-slate-400" />
                  <span>Ads Declined</span>
                </span>
              )}
            </div>

            {consent?.timestamp && (
              <p className="text-[11px] text-slate-500">
                Last decided: {new Date(consent.timestamp).toLocaleDateString()} (valid for 180
                days)
              </p>
            )}
          </div>

          <div className="p-3 bg-teal-50 border border-teal-200 rounded-lg text-teal-900 space-y-1">
            <span className="font-semibold block">Safety & Privacy Guarantee:</span>
            <p className="text-[11px] text-teal-800 leading-relaxed">
              Ads are strictly barred from all transaction, wallet, booking, and dispute screens.
              Declining consent turns off all advertisements immediately.
            </p>
          </div>
        </div>

        <div className="flex justify-between items-center pt-2 border-t border-slate-100">
          {consent?.consented ? (
            <button
              type="button"
              onClick={handleWithdraw}
              className="px-3 py-1.5 bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 rounded-lg text-xs font-semibold transition"
            >
              Withdraw Ad Consent
            </button>
          ) : (
            <button
              type="button"
              onClick={handleEnable}
              className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold shadow-xs transition"
            >
              Enable Advertisements
            </button>
          )}

          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold transition"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

export default AdPreferencesModal;
