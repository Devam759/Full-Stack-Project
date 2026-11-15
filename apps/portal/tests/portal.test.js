// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import App from '../src/App.jsx';
import CaseFileView from '../src/components/CaseFileView.jsx';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('Portal App Authentication and Safety Guards', () => {
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

  it('renders initial portal login screen requiring 2FA credentials', () => {
    act(() => {
      root.render(React.createElement(App));
    });

    expect(container.textContent).toContain('BorrowLoop Operations');
    expect(container.textContent).toContain('Care Agent & Admin Portal');
    expect(container.textContent).toContain('Next: 2FA Authentication');
  });

  it('proves network failures never log anyone in and display clear error message', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('Failed to fetch'));

    act(() => {
      root.render(React.createElement(App));
    });

    const emailInput = container.querySelector('input[type="email"]');
    const passwordInput = container.querySelector('input[type="password"]');
    const form = container.querySelector('form');

    expect(emailInput).not.toBeNull();
    expect(passwordInput).not.toBeNull();

    act(() => {
      setNativeValue(emailInput, 'care_agent@borrowloop.test');
      setNativeValue(passwordInput, 'SecurePassword123!');
    });

    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });

    // Proves user is NOT authenticated and dashboard is NOT rendered
    expect(container.textContent).not.toContain('BorrowLoop Operations Portal');
    expect(container.textContent).not.toContain('Log out');
    // Error message must be rendered
    expect(container.textContent).toContain('Failed to fetch');
  });

  it('completes full 2FA login flow and renders Operations Dashboard with "Demo money" indicator', async () => {
    global.fetch = vi.fn().mockImplementation((url) => {
      if (url === '/v1/portal/auth/login') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ tempToken: 'temp-jwt-token-123' }),
        });
      }
      if (url === '/v1/portal/auth/totp') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            accessToken: 'portal-access-token-456',
            user: { _id: 'care-123', email: 'care@borrowloop.test', role: 'care_agent' },
          }),
        });
      }
      if (url.includes('/v1/care/disputes')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ disputes: [] }),
        });
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    });

    act(() => {
      root.render(React.createElement(App));
    });

    // Step 1: Submit credentials
    const emailInput = container.querySelector('input[type="email"]');
    const passwordInput = container.querySelector('input[type="password"]');
    const form1 = container.querySelector('form');

    act(() => {
      setNativeValue(emailInput, 'care@borrowloop.test');
      setNativeValue(passwordInput, 'Password123!');
    });

    await act(async () => {
      form1.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });

    // Step 2: TOTP screen is presented
    expect(container.textContent).toContain('Two-Factor Authentication Required');
    const totpInput = container.querySelector('input[type="text"]');
    expect(totpInput).not.toBeNull();

    act(() => {
      setNativeValue(totpInput, '123456');
    });

    const form2 = container.querySelector('form');
    await act(async () => {
      form2.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });

    // Step 3: Verified and dashboard rendered with Demo money indicator and navigation
    expect(container.textContent).toContain('BorrowLoop Operations Portal');
    expect(container.textContent).toContain('Demo money');
    expect(container.textContent).toContain('Disputes Queue');
    expect(container.textContent).toContain('Reports & Moderation');
    expect(container.textContent).toContain('User Lookup');
    expect(container.textContent).toContain('Log out');
  });

  it('CaseFileView live ledger preview enforces zero-sum balance and validates deposit split', async () => {
    const mockCaseFile = {
      dispute: {
        _id: 'disp-001',
        disputeReason: 'damage',
        status: 'assigned',
        assignedAgentId: 'agent-123',
        createdAt: new Date().toISOString(),
        evidence: [],
      },
      booking: {
        _id: 'book-001',
        rentPaise: 10000, // ₹100
        depositPaise: 20000, // ₹200
        lateChargePaise: 5000, // ₹50
        status: 'disputed',
        createdAt: new Date().toISOString(),
      },
      item: {
        _id: 'item-001',
        title: 'High-end DSLR Camera',
        rentPerDayPaise: 5000,
        depositPaise: 20000,
      },
      borrower: {
        _id: 'user-borrower-1',
        name: 'Borrower Name',
        email: 'b***@test.com',
        trustScore: 45,
        strikesCount: 1,
        status: 'active',
        createdAt: new Date().toISOString(),
      },
      lender: {
        _id: 'user-lender-1',
        name: 'Lender Name',
        email: 'l***@test.com',
        trustScore: 55,
        strikesCount: 0,
        status: 'active',
        createdAt: new Date().toISOString(),
      },
      messages: [],
    };

    global.fetch = vi.fn().mockImplementation((url) => {
      if (url.includes('/v1/care/disputes/disp-001')) {
        return Promise.resolve({
          ok: true,
          json: async () => mockCaseFile,
        });
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    });

    await act(async () => {
      root.render(
        React.createElement(CaseFileView, {
          disputeId: 'disp-001',
          token: 'test-token',
          currentUser: { _id: 'agent-123', email: 'agent@borrowloop.test' },
          onBack: vi.fn(),
        }),
      );
    });

    expect(container.textContent).toContain('Case File #disp-001');
    expect(container.textContent).toContain('Live Ledger Preview (Double-Entry Zero Sum)');
    expect(container.textContent).toContain('✓ Verified: Double-Entry Zero-Sum');
    expect(container.textContent).toContain('Demo money');

    // Deposit split test: Remaining deposit is 200 - 50 = 150.
    // If we enter an invalid lender deposit amount that causes split mismatch, error is displayed
    const inputs = container.querySelectorAll('input[type="number"]');
    const lenderDepositInput = inputs[0];

    act(() => {
      setNativeValue(lenderDepositInput, '999'); // Invalid amount exceeding deposit
    });

    expect(container.textContent).toContain('Invalid split');
    const submitBtn = container.querySelector('button[type="submit"]');
    expect(submitBtn.disabled).toBe(true);
  });
});
