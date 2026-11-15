// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import AdSlot, { clearAdsConfigCache } from '../src/components/AdSlot.jsx';
import ConsentBanner from '../src/components/ConsentBanner.jsx';
import AdPreferencesModal from '../src/components/AdPreferencesModal.jsx';
import { CONSENT_STORAGE_KEY, getStoredConsent, setStoredConsent } from '../src/utils/adConsent.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('Sub-step 9g: User Web App Ads & Consent System', () => {
  let container;
  let root;

  beforeEach(() => {
    localStorage.clear();
    clearAdsConfigCache();
    // Clear any injected AdSense scripts
    document
      .querySelectorAll('script[src*="pagead2.googlesyndication.com"]')
      .forEach((el) => el.remove());
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    localStorage.clear();
    clearAdsConfigCache();
    document
      .querySelectorAll('script[src*="pagead2.googlesyndication.com"]')
      .forEach((el) => el.remove());
    vi.restoreAllMocks();
  });

  it('no consent = no ad slot rendered and no script loaded', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        masterEnabled: true,
        clientId: 'ca-pub-1234567890123456',
        placements: [{ placement: 'home_banner', adsenseSlotId: '1234567890' }],
      }),
    });

    await act(async () => {
      root.render(
        React.createElement(AdSlot, { placement: 'home_banner', currentScreen: 'items' }),
      );
    });

    expect(container.innerHTML).toBe('');
    expect(document.querySelector('script[src*="pagead2.googlesyndication.com"]')).toBeNull();
  });

  it('declined consent = no ad slot rendered and no script loaded', async () => {
    setStoredConsent(false);

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        masterEnabled: true,
        clientId: 'ca-pub-1234567890123456',
        placements: [{ placement: 'home_banner', adsenseSlotId: '1234567890' }],
      }),
    });

    await act(async () => {
      root.render(
        React.createElement(AdSlot, { placement: 'home_banner', currentScreen: 'items' }),
      );
    });

    expect(container.innerHTML).toBe('');
    expect(document.querySelector('script[src*="pagead2.googlesyndication.com"]')).toBeNull();
  });

  it('master off = no ad slot rendered', async () => {
    setStoredConsent(true);

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        masterEnabled: false,
        placements: [],
      }),
    });

    await act(async () => {
      root.render(
        React.createElement(AdSlot, { placement: 'home_banner', currentScreen: 'items' }),
      );
    });

    expect(container.innerHTML).toBe('');
    expect(document.querySelector('script[src*="pagead2.googlesyndication.com"]')).toBeNull();
  });

  it('restricted screen = no ad slot even with valid consent and master on', async () => {
    setStoredConsent(true);

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        masterEnabled: true,
        clientId: 'ca-pub-1234567890123456',
        placements: [{ placement: 'home_banner', adsenseSlotId: '1234567890' }],
      }),
    });

    // Test multiple sensitive screens from RESTRICTED_SCREENS
    const restrictedScreens = [
      'wallet',
      'my-bookings',
      'booking-detail',
      'chat',
      'dispute-detail',
      'login',
    ];

    for (const screen of restrictedScreens) {
      await act(async () => {
        root.render(
          React.createElement(AdSlot, { placement: 'home_banner', currentScreen: screen }),
        );
      });
      expect(container.innerHTML).toBe('');
    }
  });

  it('valid consent + allowed screen + master on = ad slot rendered and script injected once', async () => {
    setStoredConsent(true);

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        masterEnabled: true,
        clientId: 'ca-pub-1234567890123456',
        placements: [{ placement: 'home_banner', adsenseSlotId: '1234567890' }],
      }),
    });

    await act(async () => {
      root.render(
        React.createElement(AdSlot, { placement: 'home_banner', currentScreen: 'items' }),
      );
    });

    // Verify slot container rendered
    expect(container.querySelector('[data-testid="ad-slot-home_banner"]')).not.toBeNull();
    const insTag = container.querySelector('ins.adsbygoogle');
    expect(insTag).not.toBeNull();
    expect(insTag.getAttribute('data-ad-client')).toBe('ca-pub-1234567890123456');
    expect(insTag.getAttribute('data-ad-slot')).toBe('1234567890');

    // Verify script tag injected exactly once
    const scripts = document.querySelectorAll('script[src*="pagead2.googlesyndication.com"]');
    expect(scripts.length).toBe(1);
    expect(scripts[0].src).toContain('client=ca-pub-1234567890123456');
  });

  it('consent re-prompt is triggered after 180 days', () => {
    // Save consent timestamped 181 days ago
    const past181Days = new Date(Date.now() - 181 * 24 * 60 * 60 * 1000).toISOString();
    localStorage.setItem(
      CONSENT_STORAGE_KEY,
      JSON.stringify({ consented: true, timestamp: past181Days }),
    );

    // getStoredConsent() must treat expired record as null
    expect(getStoredConsent()).toBeNull();

    // ConsentBanner must render prompt again
    act(() => {
      root.render(React.createElement(ConsentBanner, { onOpenPreferences: vi.fn() }));
    });

    expect(container.textContent).toContain('Privacy & Ad Preferences');
    expect(container.textContent).toContain('Accept Ads');
    expect(container.textContent).toContain('Decline Ads');
  });

  it('footer link / modal allows withdrawing consent at any time', async () => {
    setStoredConsent(true);
    expect(getStoredConsent().consented).toBe(true);

    const onClose = vi.fn();
    act(() => {
      root.render(React.createElement(AdPreferencesModal, { isOpen: true, onClose }));
    });

    expect(container.textContent).toContain('Current Consent Status:');
    expect(container.textContent).toContain('Ads Allowed');

    // Click "Withdraw Ad Consent"
    const withdrawBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent.includes('Withdraw Ad Consent'),
    );
    expect(withdrawBtn).toBeDefined();

    act(() => {
      withdrawBtn.click();
    });

    // Consent is withdrawn in localStorage and UI reflects "Ads Declined"
    expect(getStoredConsent().consented).toBe(false);
    expect(container.textContent).toContain('Ads Declined');
  });
});
