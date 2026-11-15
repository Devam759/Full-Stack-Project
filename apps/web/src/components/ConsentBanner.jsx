import React, { useState, useEffect } from 'react';
import { ShieldCheck } from 'lucide-react';
import { getStoredConsent, setStoredConsent } from '../utils/adConsent.js';

export function ConsentBanner({ onOpenPreferences }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const existing = getStoredConsent();
    if (!existing) {
      setVisible(true);
    }

    const handleConsentChange = () => {
      const updated = getStoredConsent();
      if (updated) {
        setVisible(false);
      }
    };

    window.addEventListener('ad-consent-changed', handleConsentChange);
    return () => window.removeEventListener('ad-consent-changed', handleConsentChange);
  }, []);

  if (!visible) return null;

  const handleAccept = () => {
    setStoredConsent(true);
    setVisible(false);
  };

  const handleDecline = () => {
    setStoredConsent(false);
    setVisible(false);
  };

  return (
    <div className="fixed bottom-16 sm:bottom-4 left-4 right-4 max-w-lg mx-auto z-50 bg-slate-900 text-white p-4 rounded-xl shadow-2xl border border-slate-700 space-y-3 animate-fade-in">
      <div className="flex items-start gap-3">
        <div className="p-2 bg-slate-800 rounded-lg shrink-0 mt-0.5">
          <ShieldCheck className="w-5 h-5 text-teal-400" />
        </div>
        <div className="space-y-1">
          <h4 className="font-heading font-bold text-sm text-white">Privacy & Ad Preferences</h4>
          <p className="text-xs text-slate-300 leading-relaxed">
            We use Google AdSense on public catalog screens to help keep BorrowLoop free for our
            community. No ads will be displayed on sensitive account or booking screens.
          </p>
        </div>
      </div>

      <div className="flex items-center justify-between pt-1 gap-2 border-t border-slate-800">
        <button
          type="button"
          onClick={onOpenPreferences}
          className="text-xs text-slate-400 hover:text-white underline underline-offset-2 transition"
        >
          Ad preferences
        </button>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleDecline}
            className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-lg text-xs font-semibold transition"
          >
            Decline Ads
          </button>
          <button
            type="button"
            onClick={handleAccept}
            className="px-4 py-1.5 bg-teal-500 hover:bg-teal-600 text-slate-950 font-bold rounded-lg text-xs shadow-sm transition"
          >
            Accept Ads
          </button>
        </div>
      </div>
    </div>
  );
}

export default ConsentBanner;
