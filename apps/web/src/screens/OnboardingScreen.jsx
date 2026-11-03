import React, { useState } from 'react';
import { MapPin, ArrowRight, ShieldCheck, Repeat, Sparkles } from 'lucide-react';
import { BRAND } from '../brand.js';

export function OnboardingScreen({ onNavigate }) {
  const [locationStatus, setLocationStatus] = useState('idle'); // idle, requesting, resolved
  const [areaInput, setAreaInput] = useState('');

  const requestLocation = () => {
    setLocationStatus('requesting');
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        () => {
          setLocationStatus('resolved');
        },
        () => {
          setLocationStatus('idle');
          alert('Location access denied. Please enter your neighborhood or city manually.');
        },
      );
    } else {
      setLocationStatus('idle');
    }
  };

  return (
    <div className="max-w-md mx-auto p-4 space-y-6">
      {/* Hero */}
      <div className="text-center pt-6 space-y-3">
        <div className="inline-flex p-3 rounded-2xl bg-teal-50 text-primary border border-teal-100">
          <Repeat className="w-8 h-8" />
        </div>
        <h1 className="text-2xl font-heading font-bold text-slate-900 tracking-tight">
          Welcome to {BRAND.appName}
        </h1>
        <p className="text-sm text-text-muted leading-relaxed">
          Borrow everyday items from verified neighbors in your campus, hostel, or neighborhood.
          Save money, earn rent, and reduce waste.
        </p>
      </div>

      {/* Feature Value Props */}
      <div className="bg-surface rounded-brand border border-slate-200 p-4 space-y-3">
        <div className="flex items-start gap-3">
          <ShieldCheck className="w-5 h-5 text-teal-600 mt-0.5 shrink-0" />
          <div>
            <h2 className="text-xs font-semibold text-slate-900">Protected Transactions</h2>
            <p className="text-xs text-text-muted">
              Security deposits and dispute mediation protect borrowers and lenders.
            </p>
          </div>
        </div>

        <div className="flex items-start gap-3">
          <Sparkles className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
          <div>
            <h2 className="text-xs font-semibold text-slate-900">Demo Money Sandbox</h2>
            <p className="text-xs text-text-muted">
              Currently powered by simulated wallet balances to verify community mechanics.
            </p>
          </div>
        </div>
      </div>

      {/* Location Setup */}
      <div className="bg-surface rounded-brand border border-slate-200 p-4 space-y-3">
        <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
          <MapPin className="w-4 h-4 text-primary" />
          Find Nearby Communities
        </h2>
        <p className="text-xs text-text-muted">
          We only store your approximate location (~1 km) to connect you with nearby communities.
        </p>

        {locationStatus === 'resolved' ? (
          <div className="p-2.5 bg-emerald-50 text-emerald-800 text-xs rounded border border-emerald-200 font-medium">
            Approximate location set! You can explore communities nearby.
          </div>
        ) : (
          <div className="space-y-2">
            <button
              type="button"
              onClick={requestLocation}
              disabled={locationStatus === 'requesting'}
              className="w-full py-2.5 px-3 bg-primary hover:bg-primary-dark text-white text-xs font-medium rounded-brand transition flex items-center justify-center gap-2"
            >
              <MapPin className="w-3.5 h-3.5" />
              {locationStatus === 'requesting'
                ? 'Detecting location...'
                : 'Use My Current Location'}
            </button>

            <div className="flex items-center gap-2">
              <input
                type="text"
                placeholder="Or enter city / area (e.g. Koramangala)"
                value={areaInput}
                onChange={(e) => setAreaInput(e.target.value)}
                className="flex-1 text-xs border border-slate-300 rounded-brand px-3 py-2 outline-none focus:border-primary"
              />
              <button
                type="button"
                onClick={() => setLocationStatus('resolved')}
                className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs rounded-brand font-medium"
              >
                Set
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Action Buttons */}
      <div className="space-y-2.5 pt-2">
        <button
          type="button"
          onClick={() => onNavigate('signup')}
          className="w-full py-3 bg-primary hover:bg-primary-dark text-white rounded-brand font-medium text-sm transition flex items-center justify-center gap-2 shadow-sm"
        >
          <span>Get Started (Sign Up)</span>
          <ArrowRight className="w-4 h-4" />
        </button>

        <button
          type="button"
          onClick={() => onNavigate('login')}
          className="w-full py-2.5 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-brand font-medium text-sm transition"
        >
          Already have an account? Log In
        </button>
      </div>
    </div>
  );
}

export default OnboardingScreen;
