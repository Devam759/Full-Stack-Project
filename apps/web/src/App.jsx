import React, { useEffect } from 'react';
import { Home, Search, Calendar, Wallet, User } from 'lucide-react';
import { applyBrandTokens, BRAND } from './brand.js';
import { formatPaise } from '@borrowloop/shared';

export function App() {
  useEffect(() => {
    applyBrandTokens();
  }, []);

  return (
    <div className="min-h-screen flex flex-col bg-background text-text pb-20">
      {/* Top Header */}
      <header className="sticky top-0 z-40 bg-surface border-b border-slate-200 px-4 py-3 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-2">
          <div
            className="w-7 h-7 text-primary"
            dangerouslySetInnerHTML={{ __html: BRAND.logo.svg }}
          />
          <span className="font-heading font-bold text-lg tracking-tight text-primary-dark">
            {BRAND.appName}
          </span>
        </div>

        {/* Demo Money Tag - Hard Rule 9 */}
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800 border border-amber-300">
            Demo money
          </span>
        </div>
      </header>

      {/* Main Content Shell */}
      <main className="flex-1 max-w-lg mx-auto w-full p-4 space-y-4">
        <div className="bg-surface rounded-brand p-5 border border-slate-200 shadow-sm space-y-3">
          <h1 className="text-xl font-heading font-semibold text-slate-900">
            Welcome to BorrowLoop
          </h1>
          <p className="text-sm text-text-muted">
            Lend and borrow everyday items with your local community. All transactions are securely
            backed by a demo-money wallet and deposit hold.
          </p>

          <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-sm">
            <span className="text-text-muted font-medium">Demo Wallet Balance:</span>
            <span className="font-semibold text-slate-900 font-mono">
              {formatPaise(0, { showDemoTag: true })}
            </span>
          </div>
        </div>
      </main>

      {/* Mobile Bottom Navigation Bar */}
      <nav className="fixed bottom-0 left-0 right-0 z-50 bg-surface border-t border-slate-200 max-w-lg mx-auto flex items-center justify-around py-2 px-3 shadow-lg">
        <button
          type="button"
          className="flex flex-col items-center gap-1 text-primary p-2 min-w-[56px] focus:outline-none"
        >
          <Home className="w-5 h-5" />
          <span className="text-[11px] font-medium">Home</span>
        </button>
        <button
          type="button"
          className="flex flex-col items-center gap-1 text-text-muted hover:text-slate-900 p-2 min-w-[56px] focus:outline-none"
        >
          <Search className="w-5 h-5" />
          <span className="text-[11px] font-medium">Search</span>
        </button>
        <button
          type="button"
          className="flex flex-col items-center gap-1 text-text-muted hover:text-slate-900 p-2 min-w-[56px] focus:outline-none"
        >
          <Calendar className="w-5 h-5" />
          <span className="text-[11px] font-medium">Bookings</span>
        </button>
        <button
          type="button"
          className="flex flex-col items-center gap-1 text-text-muted hover:text-slate-900 p-2 min-w-[56px] focus:outline-none"
        >
          <Wallet className="w-5 h-5" />
          <span className="text-[11px] font-medium">Wallet</span>
        </button>
        <button
          type="button"
          className="flex flex-col items-center gap-1 text-text-muted hover:text-slate-900 p-2 min-w-[56px] focus:outline-none"
        >
          <User className="w-5 h-5" />
          <span className="text-[11px] font-medium">Profile</span>
        </button>
      </nav>
    </div>
  );
}

export default App;
