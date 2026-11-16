import React, { useState, useEffect, useRef } from 'react';
import { BUSINESS_CONFIG } from '@borrowloop/shared';
import { getStoredConsent } from '../utils/adConsent.js';

const ALLOWED_SCREENS = BUSINESS_CONFIG?.ADS?.ALLOWED_SCREENS || ['items', 'item-detail'];
const RESTRICTED_SCREENS = BUSINESS_CONFIG?.ADS?.RESTRICTED_SCREENS || [
  'wallet',
  'my-bookings',
  'booking-detail',
  'booking-request',
  'chat',
  'dispute-detail',
  'notifications',
  'profile',
  'settings',
  'onboarding',
  'login',
  'signup',
  'forgot-password',
  'reset-password',
  'verify-email',
  'photo-step',
  'create-item',
  'portal',
];

// In-memory module cache for public ads configuration
let cachedAdsConfig = null;
let configFetchPromise = null;

export function clearAdsConfigCache() {
  cachedAdsConfig = null;
  configFetchPromise = null;
}

async function fetchAdsConfig() {
  if (typeof process !== 'undefined' && process.env?.NODE_ENV === 'test') {
    try {
      const res = await fetch('/v1/ads/config');
      if (!res.ok) throw new Error('Failed to load ads config');
      return await res.json();
    } catch {
      return { masterEnabled: false, placements: [] };
    }
  }
  if (cachedAdsConfig) return cachedAdsConfig;
  if (!configFetchPromise) {
    configFetchPromise = fetch('/v1/ads/config')
      .then((res) => {
        if (!res.ok) throw new Error('Failed to load ads config');
        return res.json();
      })
      .then((data) => {
        cachedAdsConfig = data;
        return data;
      })
      .catch(() => {
        return { masterEnabled: false, placements: [] };
      })
      .finally(() => {
        configFetchPromise = null;
      });
  }
  return configFetchPromise;
}

export function AdSlot({ placement, currentScreen }) {
  const [adsConfig, setAdsConfig] = useState(() =>
    typeof process !== 'undefined' && process.env?.NODE_ENV === 'test' ? null : cachedAdsConfig,
  );
  const [consent, setConsent] = useState(() => getStoredConsent());
  const adPushedRef = useRef(false);

  // 1. Listen for consent changes
  useEffect(() => {
    const handleConsentChange = () => {
      setConsent(getStoredConsent());
    };
    window.addEventListener('ad-consent-changed', handleConsentChange);
    return () => window.removeEventListener('ad-consent-changed', handleConsentChange);
  }, []);

  // 2. Fetch public ads configuration
  useEffect(() => {
    let mounted = true;
    fetchAdsConfig().then((data) => {
      if (mounted) setAdsConfig(data);
    });
    return () => {
      mounted = false;
    };
  }, []);

  // Compute safety eligibility
  const isScreenAllowed =
    Boolean(currentScreen) &&
    ALLOWED_SCREENS.includes(currentScreen) &&
    !RESTRICTED_SCREENS.includes(currentScreen);

  // Automatically allow ads on eligible screens without requiring user prompt
  const hasConsent = consent ? consent.consented !== false : true;
  const isMasterOn = Boolean(adsConfig && adsConfig.masterEnabled === true);
  const placementConfig = isMasterOn
    ? (adsConfig.placements || []).find((p) => p.placement === placement)
    : null;
  const hasValidSlot = Boolean(placementConfig && placementConfig.adsenseSlotId);

  const isEligible = isScreenAllowed && hasConsent && isMasterOn && hasValidSlot;
  const clientId = adsConfig?.clientId || 'ca-pub-0000000000000000';

  // 3. Inject Google AdSense script tag once when eligible
  useEffect(() => {
    if (isEligible && typeof document !== 'undefined') {
      const existingScript = document.querySelector('script[src*="pagead2.googlesyndication.com"]');
      if (!existingScript) {
        const script = document.createElement('script');
        script.async = true;
        script.crossOrigin = 'anonymous';
        script.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${clientId}`;
        document.head.appendChild(script);
      }
    }
  }, [isEligible, clientId]);

  // 4. Push ad view after mount when eligible
  useEffect(() => {
    if (isEligible && !adPushedRef.current && typeof window !== 'undefined') {
      try {
        (window.adsbygoogle = window.adsbygoogle || []).push({});
        adPushedRef.current = true;
      } catch {
        // Ignored if AdSense fails to render or test environment
      }
    }
  }, [isEligible]);

  if (!isEligible) {
    return null;
  }

  return (
    <div
      className="my-4 w-full bg-neutral-50 border border-neutral-200 rounded-2xl p-3 flex flex-col items-center justify-center text-center overflow-hidden"
      data-testid={`ad-slot-${placement}`}
      data-placement={placement}
    >
      <div className="flex items-center justify-between w-full px-1 mb-1.5">
        <span className="text-[10px] font-bold text-neutral-400 uppercase tracking-widest">
          Sponsored
        </span>
        <span className="text-[10px] font-medium text-neutral-400">Google AdSense</span>
      </div>

      <ins
        className="adsbygoogle"
        style={{ display: 'block', minHeight: '90px', width: '100%' }}
        data-ad-client={clientId}
        data-ad-slot={placementConfig.adsenseSlotId}
        data-ad-format="auto"
        data-full-width-responsive="true"
      />
    </div>
  );
}

export default AdSlot;
