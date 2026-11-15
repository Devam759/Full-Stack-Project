// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import App from '../src/App.jsx';
import AdminAds from '../src/components/admin/AdminAds.jsx';
import AdminAppeals from '../src/components/admin/AdminAppeals.jsx';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('Sub-step 9f: Portal Admin Frontend & RBAC Integration Tests', () => {
  let container;
  let root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.restoreAllMocks();
  });

  const setNativeValue = (element, value) => {
    const valueSetter = Object.getOwnPropertyDescriptor(element, 'value')?.set;
    const prototype = Object.getPrototypeOf(element);
    const prototypeValueSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
    if (prototypeValueSetter && valueSetter !== prototypeValueSetter) {
      prototypeValueSetter.call(element, value);
    } else {
      element.value = value;
    }
    element.dispatchEvent(new Event('input', { bubbles: true }));
  };

  it('care agent login does not render admin navigation', async () => {
    global.fetch = vi.fn().mockImplementation((url) => {
      if (url === '/v1/portal/auth/login') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ tempToken: 'temp-care-jwt' }),
        });
      }
      if (url === '/v1/portal/auth/totp') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            accessToken: 'portal-token-care-1',
            user: {
              _id: 'agent-101',
              email: 'agent101@borrowloop.test',
              role: 'care_agent',
              name: 'Care Agent 101',
            },
          }),
        });
      }
      if (url.includes('/v1/care/disputes')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ disputes: [] }),
        });
      }
      return Promise.reject(new Error(`Unhandled: ${url}`));
    });

    act(() => {
      root.render(React.createElement(App));
    });

    // Step 1: Submit email/password
    const emailInput = container.querySelector('input[type="email"]');
    const passwordInput = container.querySelector('input[type="password"]');
    const form1 = container.querySelector('form');

    act(() => {
      setNativeValue(emailInput, 'agent101@borrowloop.test');
      setNativeValue(passwordInput, 'ValidPassword123!');
    });

    await act(async () => {
      form1.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });

    // Step 2: Submit TOTP
    const totpInput = container.querySelector('input[type="text"]');
    act(() => {
      setNativeValue(totpInput, '654321');
    });

    const form2 = container.querySelector('form');
    await act(async () => {
      form2.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });

    // Care agent must see Care workspace, masked email, Care Agent badge
    expect(container.textContent).toContain('BorrowLoop Operations Portal');
    expect(container.textContent).toContain('Care Agent');
    expect(container.textContent).toContain('a***@b***.test');
    expect(container.textContent).toContain('Disputes Queue');

    // Care agent MUST NOT see any admin tabs
    expect(container.textContent).not.toContain('Administration');
    expect(container.textContent).not.toContain('Overview & Analytics');
    expect(container.textContent).not.toContain('User Moderation');
    expect(container.textContent).not.toContain('Communities');
    expect(container.textContent).not.toContain('Staff Management');
    expect(container.textContent).not.toContain('Dispute Appeals');
    expect(container.textContent).not.toContain('Ledger Reconciliation');
    expect(container.textContent).not.toContain('Audit Trail');
    expect(container.textContent).not.toContain('Ads & Monetization');
  });

  it('admin login renders overview with Demo money badges and admin navigation', async () => {
    global.fetch = vi.fn().mockImplementation((url) => {
      if (url === '/v1/portal/auth/login') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ tempToken: 'temp-admin-jwt' }),
        });
      }
      if (url === '/v1/portal/auth/totp') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            accessToken: 'portal-token-admin-1',
            user: {
              _id: 'admin-001',
              email: 'admin@borrowloop.test',
              role: 'admin',
              name: 'Super Admin',
            },
          }),
        });
      }
      if (url === '/v1/admin/analytics/overview') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            volumePaise: 500000,
            depositsHeldPaise: 250000,
            commissionEarnedPaise: 50000,
            disputeRatioPct: 2.5,
            openDisputesCount: 3,
            pendingAppealsCount: 1,
            rentedNow: 8,
            users: { total: 100, active: 95, frozen: 3, banned: 2 },
            items: { total: 50, active: 40, paused: 5, hidden: 5 },
            bookings: { byStatus: { requested: 4, picked_up: 8, completed: 80 } },
          }),
        });
      }
      return Promise.reject(new Error(`Unhandled: ${url}`));
    });

    act(() => {
      root.render(React.createElement(App));
    });

    // Step 1: Submit email/password
    const emailInput = container.querySelector('input[type="email"]');
    const passwordInput = container.querySelector('input[type="password"]');
    const form1 = container.querySelector('form');

    act(() => {
      setNativeValue(emailInput, 'admin@borrowloop.test');
      setNativeValue(passwordInput, 'ValidAdminPassword123!');
    });

    await act(async () => {
      form1.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });

    // Step 2: Submit TOTP
    const totpInput = container.querySelector('input[type="text"]');
    act(() => {
      setNativeValue(totpInput, '112233');
    });

    const form2 = container.querySelector('form');
    await act(async () => {
      form2.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });

    // Admin lands on Overview & Analytics tab
    expect(container.textContent).toContain('Admin');
    expect(container.textContent).toContain('a***@b***.test');
    expect(container.textContent).toContain('Administration');
    expect(container.textContent).toContain('Overview & Analytics');
    expect(container.textContent).toContain('Executive Analytics Overview');
    expect(container.textContent).toContain('Completed Volume');
    expect(container.textContent).toContain('Deposits Held');
    expect(container.textContent).toContain('Commission Earned');
    expect(container.textContent).toContain('Demo money');
    expect(container.textContent).toContain('8 rented now');
  });

  it('master ad toggle shows confirm modal with required ENABLE_ADS input', async () => {
    global.fetch = vi.fn().mockImplementation((url) => {
      if (url === '/v1/admin/ads') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            masterEnabled: false,
            clientId: 'ca-pub-1234567890123456',
            placements: [
              {
                placement: 'home_banner',
                enabled: false,
                adsenseSlotId: '1234567890',
                pages: ['items'],
              },
            ],
          }),
        });
      }
      return Promise.reject(new Error(`Unhandled: ${url}`));
    });

    await act(async () => {
      root.render(React.createElement(AdminAds, { token: 'admin-test-token' }));
    });

    expect(container.textContent).toContain('Platform AdSense Master Switch');
    expect(container.textContent).toContain('Disabled (OFF)');

    // Click "Turn Master Ads ON"
    const toggleBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent.includes('Turn Master Ads ON'),
    );
    expect(toggleBtn).toBeDefined();

    act(() => {
      toggleBtn.click();
    });

    // Confirmation modal must be rendered
    expect(container.textContent).toContain('Enable Master AdSense Network');
    expect(container.textContent).toContain("Type 'ENABLE_ADS' to confirm");
    expect(container.textContent).toContain('Security & Commercial Confirmation');
  });

  it('appeal preview renders shortfall warning when present', async () => {
    const mockAppealDispute = {
      _id: 'disp-appeal-999',
      itemTitle: 'Professional DSLR Camera Kit',
      disputeReason: 'damage',
      requesterRole: 'borrower',
      careDecision: {
        rentOutcome: 'lender',
        depositToLenderPaise: 15000,
        depositToBorrowerPaise: 5000,
        note: 'Care decider ruled partial damage charge.',
      },
      appeal: {
        status: 'pending',
        reason: 'The item was returned in pristine condition with prior wear.',
      },
    };

    global.fetch = vi.fn().mockImplementation((url) => {
      if (
        url.includes('/v1/admin/appeals') &&
        !url.includes('/preview') &&
        !url.includes('/decide')
      ) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ appeals: [mockAppealDispute] }),
        });
      }
      if (url.includes('/v1/admin/appeals/disp-appeal-999/preview')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            deltas: { borrower: 10000, lender: -10000, platform: 0 },
            shortfallPaise: 5000, // ₹50 unrecovered shortfall!
            acknowledgeRequired: true,
          }),
        });
      }
      return Promise.reject(new Error(`Unhandled: ${url}`));
    });

    await act(async () => {
      root.render(React.createElement(AdminAppeals, { token: 'admin-test-token' }));
    });

    expect(container.textContent).toContain('Professional DSLR Camera Kit');
    expect(container.textContent).toContain('Appealed by borrower');

    // Click "Review & Decide Appeal"
    const reviewBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent.includes('Review & Decide Appeal'),
    );
    expect(reviewBtn).toBeDefined();

    act(() => {
      reviewBtn.click();
    });

    // Select "Overturn & Recompute Settlement"
    const overturnTabBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent.includes('Overturn & Recompute Settlement'),
    );
    act(() => {
      overturnTabBtn.click();
    });

    // Click "Preview Reversal Calculations"
    const previewBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent.includes('Preview Reversal Calculations'),
    );
    expect(previewBtn).toBeDefined();

    await act(async () => {
      previewBtn.click();
    });

    // Shortfall warning must be visible
    expect(container.textContent).toContain('Shortfall Detected: ₹50.00');
    expect(container.textContent).toContain(
      'The debited party has already withdrawn their funds. Debit is strictly capped at available wallet balance',
    );
    expect(container.textContent).toContain(
      'I acknowledge and authorize the unrecovered shortfall of ₹50.00',
    );

    // Checkbox is present
    const checkbox = container.querySelector('input[type="checkbox"]');
    expect(checkbox).not.toBeNull();
    expect(checkbox.checked).toBe(false);
  });
});
