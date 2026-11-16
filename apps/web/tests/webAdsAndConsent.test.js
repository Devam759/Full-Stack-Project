// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import AdSlot, { clearAdsConfigCache } from '../src/components/AdSlot.jsx';
import ConsentBanner from '../src/components/ConsentBanner.jsx';
import AdPreferencesModal from '../src/components/AdPreferencesModal.jsx';
import { setStoredConsent } from '../src/utils/adConsent.js';

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

  it('ads render automatically without prior consent prompt', async () => {
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

    // Automatically rendered without needing prompt or opt-in
    expect(container.querySelector('[data-testid="ad-slot-home_banner"]')).not.toBeNull();
    const insTag = container.querySelector('ins.adsbygoogle');
    expect(insTag).not.toBeNull();
    expect(insTag.getAttribute('data-ad-client')).toBe('ca-pub-1234567890123456');
    expect(insTag.getAttribute('data-ad-slot')).toBe('1234567890');
    expect(document.querySelector('script[src*="pagead2.googlesyndication.com"]')).not.toBeNull();
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

  it('consent banner is suppressed so no ad preferences banner is shown to users', () => {
    act(() => {
      root.render(React.createElement(ConsentBanner, { onOpenPreferences: vi.fn() }));
    });

    expect(container.innerHTML).toBe('');
    expect(container.textContent).not.toContain('Privacy & Ad Preferences');
  });

  it('ad preferences modal is suppressed and renders null', () => {
    const onClose = vi.fn();
    act(() => {
      root.render(React.createElement(AdPreferencesModal, { isOpen: true, onClose }));
    });

    expect(container.innerHTML).toBe('');
  });
});
