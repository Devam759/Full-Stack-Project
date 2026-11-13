import React, { useState, useEffect, useCallback } from 'react';
import {
  Wallet as WalletIcon,
  PlusCircle,
  ArrowUpRight,
  ArrowDownLeft,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  Clock,
  Shield,
} from 'lucide-react';
import { toPaise, formatPaise, toRupees, BUSINESS_CONFIG } from '@borrowloop/shared';
import { apiRequest } from '../api/client.js';

/**
 * Generates a standard RFC4122 v4 UUID for request idempotency.
 */
function generateUUID() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function WalletScreen() {
  const [wallet, setWallet] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [nextCursor, setNextCursor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Modal / Action states
  const [activeTab, setActiveTab] = useState('overview'); // 'overview' | 'add' | 'withdraw'
  const [inputRupees, setInputRupees] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [actionSuccess, setActionSuccess] = useState(null);

  // Stored idempotency keys for retry reuse
  const [addIdempotencyKey, setAddIdempotencyKey] = useState(() => generateUUID());
  const [withdrawIdempotencyKey, setWithdrawIdempotencyKey] = useState(() => generateUUID());

  const fetchWallet = useCallback(async () => {
    try {
      setError(null);
      const data = await apiRequest('/wallet');
      setWallet(data);
    } catch (err) {
      setError(err?.message || 'Failed to load wallet');
    }
  }, []);

  const fetchTransactions = useCallback(async (cursor = null) => {
    try {
      const url = cursor ? `/wallet/transactions?cursor=${cursor}` : '/wallet/transactions';
      const data = await apiRequest(url);
      setTransactions((prev) => (cursor ? [...prev, ...(data.items || [])] : data.items || []));
      setNextCursor(data.nextCursor || null);
    } catch {
      // Non-blocking history load
    }
  }, []);

  useEffect(() => {
    async function init() {
      setLoading(true);
      await Promise.all([fetchWallet(), fetchTransactions()]);
      setLoading(false);
    }
    init();
  }, [fetchWallet, fetchTransactions]);

  const handleAddFunds = async (e) => {
    e.preventDefault();
    if (isSubmitting) return;

    setActionSuccess(null);
    setError(null);

    let amountPaise;
    try {
      amountPaise = toPaise(inputRupees);
    } catch (err) {
      setError(err.message || 'Invalid amount format');
      return;
    }

    setIsSubmitting(true);
    try {
      await apiRequest('/wallet/add', {
        method: 'POST',
        headers: {
          'Idempotency-Key': addIdempotencyKey,
        },
        body: JSON.stringify({ amountPaise }),
      });

      setActionSuccess(`Successfully added ₹${toRupees(amountPaise).toFixed(2)} to your wallet!`);
      setInputRupees('');
      // Generate a fresh key for next logical attempt
      setAddIdempotencyKey(generateUUID());
      await Promise.all([fetchWallet(), fetchTransactions()]);
      setActiveTab('overview');
    } catch (err) {
      // Re-use same idempotency key on failure for retry
      setError(err?.message || 'Failed to add money. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleWithdrawFunds = async (e) => {
    e.preventDefault();
    if (isSubmitting) return;

    setActionSuccess(null);
    setError(null);

    let amountPaise;
    try {
      amountPaise = toPaise(inputRupees);
    } catch (err) {
      setError(err.message || 'Invalid amount format');
      return;
    }

    setIsSubmitting(true);
    try {
      await apiRequest('/wallet/withdraw', {
        method: 'POST',
        headers: {
          'Idempotency-Key': withdrawIdempotencyKey,
        },
        body: JSON.stringify({ amountPaise }),
      });

      setActionSuccess(
        `Successfully withdrew ₹${toRupees(amountPaise).toFixed(2)} from your wallet!`,
      );
      setInputRupees('');
      // Generate fresh key for next logical attempt
      setWithdrawIdempotencyKey(generateUUID());
      await Promise.all([fetchWallet(), fetchTransactions()]);
      setActiveTab('overview');
    } catch (err) {
      // Re-use same idempotency key on failure for retry
      setError(err?.message || 'Failed to withdraw money. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const capRemainingPaise = wallet
    ? Math.max(0, BUSINESS_CONFIG.WALLET_CAP_PAISE - wallet.totalPaise)
    : 0;

  if (loading) {
    return (
      <div className="p-6 text-center text-text-muted flex flex-col items-center justify-center min-h-[50vh]">
        <RefreshCw className="w-8 h-8 animate-spin text-primary mb-3" />
        <p className="text-sm font-medium">Loading demo wallet...</p>
      </div>
    );
  }

  return (
    <div className="p-4 pb-24 max-w-lg mx-auto space-y-5 animate-fade-in">
      {/* Demo Money Hard Rule 9 Visible Indicator */}
      <div className="bg-amber-50 border border-amber-300 rounded-lg p-3 flex items-start gap-3 shadow-xs">
        <Shield className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
        <div className="text-xs text-amber-900 leading-relaxed">
          <span className="font-bold uppercase tracking-wider text-amber-800 bg-amber-200 px-1.5 py-0.5 rounded mr-1">
            Demo Money Only
          </span>
          All funds on BorrowLoop are simulated demo credits for testing. No real money is
          deposited, withdrawn, or stored.
        </div>
      </div>

      {/* Notifications */}
      {error && (
        <div className="bg-rose-50 border border-rose-200 text-rose-800 text-sm p-3 rounded-lg flex items-center gap-2">
          <AlertCircle className="w-5 h-5 text-rose-600 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {actionSuccess && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm p-3 rounded-lg flex items-center gap-2">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
          <span>{actionSuccess}</span>
        </div>
      )}

      {/* Wallet Balance Card */}
      <div className="bg-surface rounded-xl border border-slate-200 p-5 shadow-xs space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary">
              <WalletIcon className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-text-muted">Available Balance</h2>
              <div className="text-2xl font-bold font-heading text-slate-900">
                {formatPaise(wallet?.availablePaise || 0, { showDemoTag: false })}
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              fetchWallet();
              fetchTransactions();
            }}
            className="p-2 text-slate-400 hover:text-slate-600 rounded-lg transition"
            title="Refresh balance"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3 pt-3 border-t border-slate-100 text-xs">
          <div>
            <span className="text-text-muted block mb-0.5">Held in Bookings</span>
            <span className="font-semibold text-slate-700">
              {formatPaise(wallet?.frozenPaise || 0, { showDemoTag: false })}
            </span>
          </div>
          <div>
            <span className="text-text-muted block mb-0.5">Wallet Cap Limit</span>
            <span className="font-semibold text-slate-700">₹50,000.00</span>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="grid grid-cols-2 gap-3 pt-2">
          <button
            type="button"
            onClick={() => {
              setActiveTab(activeTab === 'add' ? 'overview' : 'add');
              setInputRupees('');
              setError(null);
            }}
            disabled={!wallet?.canAddFunds}
            className={`flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg font-medium text-sm transition ${
              activeTab === 'add'
                ? 'bg-primary-dark text-white'
                : 'bg-primary text-white hover:bg-primary-dark shadow-xs'
            } ${!wallet?.canAddFunds ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            <PlusCircle className="w-4 h-4" />
            <span>Add Money</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveTab(activeTab === 'withdraw' ? 'overview' : 'withdraw');
              setInputRupees('');
              setError(null);
            }}
            disabled={!wallet || wallet.availablePaise <= 0}
            className={`flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg font-medium text-sm transition border ${
              activeTab === 'withdraw'
                ? 'bg-slate-800 text-white border-slate-800'
                : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
            } ${!wallet || wallet.availablePaise <= 0 ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            <ArrowUpRight className="w-4 h-4" />
            <span>Withdraw</span>
          </button>
        </div>
      </div>

      {/* Add Money Form Panel */}
      {activeTab === 'add' && (
        <form
          onSubmit={handleAddFunds}
          className="bg-surface rounded-xl border border-primary/30 p-5 shadow-xs space-y-4 animate-fade-in"
        >
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-900">Add Demo Funds</h3>
            <span className="text-xs text-text-muted">
              Cap remaining: ₹{(capRemainingPaise / 100).toFixed(2)}
            </span>
          </div>

          {/* Quick Amount Selectors */}
          <div className="grid grid-cols-4 gap-2">
            {[100, 500, 1000, 5000].map((amt) => (
              <button
                key={amt}
                type="button"
                onClick={() => setInputRupees(amt.toString())}
                className="py-1.5 px-2 bg-slate-50 hover:bg-primary/10 hover:text-primary border border-slate-200 rounded text-xs font-semibold text-slate-700 transition"
              >
                +₹{amt}
              </button>
            ))}
          </div>

          <div>
            <label className="block text-xs font-medium text-text-muted mb-1">
              Enter Amount (₹)
            </label>
            <div className="relative">
              <span className="absolute left-3 top-2.5 text-slate-400 font-semibold">₹</span>
              <input
                type="number"
                step="0.01"
                min="100"
                max={capRemainingPaise / 100}
                placeholder="500.00"
                value={inputRupees}
                onChange={(e) => setInputRupees(e.target.value)}
                required
                className="w-full pl-8 pr-4 py-2 border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary text-sm"
              />
            </div>
            <p className="text-[11px] text-text-muted mt-1">Min: ₹100.00, Max: ₹50,000.00</p>
          </div>

          <div className="flex items-center gap-2 pt-2">
            <button
              type="submit"
              disabled={isSubmitting || !inputRupees}
              className="flex-1 py-2 px-4 rounded-lg bg-primary hover:bg-primary-dark text-white text-sm font-semibold disabled:opacity-50 flex items-center justify-center gap-2 transition"
            >
              {isSubmitting && <RefreshCw className="w-4 h-4 animate-spin" />}
              <span>{isSubmitting ? 'Adding...' : 'Confirm Add Funds'}</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('overview')}
              className="py-2 px-4 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 text-sm font-medium"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Withdraw Money Form Panel */}
      {activeTab === 'withdraw' && (
        <form
          onSubmit={handleWithdrawFunds}
          className="bg-surface rounded-xl border border-slate-300 p-5 shadow-xs space-y-4 animate-fade-in"
        >
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-900">Withdraw Demo Funds</h3>
            <span className="text-xs text-text-muted">
              Available: ₹{toRupees(wallet?.availablePaise || 0).toFixed(2)}
            </span>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-medium text-text-muted">Amount to Withdraw (₹)</label>
              <button
                type="button"
                onClick={() => setInputRupees(toRupees(wallet?.availablePaise || 0).toString())}
                className="text-xs font-semibold text-primary hover:underline"
              >
                Max Available
              </button>
            </div>
            <div className="relative">
              <span className="absolute left-3 top-2.5 text-slate-400 font-semibold">₹</span>
              <input
                type="number"
                step="0.01"
                min="100"
                max={toRupees(wallet?.availablePaise || 0)}
                placeholder="200.00"
                value={inputRupees}
                onChange={(e) => setInputRupees(e.target.value)}
                required
                className="w-full pl-8 pr-4 py-2 border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary text-sm"
              />
            </div>
          </div>

          <div className="flex items-center gap-2 pt-2">
            <button
              type="submit"
              disabled={isSubmitting || !inputRupees}
              className="flex-1 py-2 px-4 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold disabled:opacity-50 flex items-center justify-center gap-2 transition"
            >
              {isSubmitting && <RefreshCw className="w-4 h-4 animate-spin" />}
              <span>{isSubmitting ? 'Withdrawing...' : 'Confirm Withdrawal'}</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('overview')}
              className="py-2 px-4 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 text-sm font-medium"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Transaction History Section */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-heading font-semibold text-sm text-slate-900">Transaction History</h3>
          <span className="text-xs text-text-muted">{transactions.length} record(s)</span>
        </div>

        {transactions.length === 0 ? (
          <div className="bg-surface rounded-xl border border-slate-200 p-8 text-center text-text-muted text-sm space-y-2">
            <Clock className="w-8 h-8 text-slate-300 mx-auto" />
            <p className="font-medium text-slate-600">No transactions yet</p>
            <p className="text-xs">Add demo money above to simulate borrowing and listing.</p>
          </div>
        ) : (
          <div className="bg-surface rounded-xl border border-slate-200 divide-y divide-slate-100 overflow-hidden shadow-xs">
            {transactions.map((tx) => {
              const isPositive = tx.amountPaise > 0;
              return (
                <div
                  key={tx.id}
                  className="p-3.5 flex items-center justify-between hover:bg-slate-50 transition"
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                        isPositive
                          ? 'bg-emerald-100 text-emerald-700'
                          : 'bg-slate-100 text-slate-700'
                      }`}
                    >
                      {isPositive ? (
                        <ArrowDownLeft className="w-4 h-4" />
                      ) : (
                        <ArrowUpRight className="w-4 h-4" />
                      )}
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-slate-800 capitalize">
                        {tx.type.replace(/_/g, ' ')}
                      </p>
                      <p className="text-[11px] text-text-muted">
                        {new Date(tx.createdAt).toLocaleString('en-IN', {
                          day: 'numeric',
                          month: 'short',
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </p>
                    </div>
                  </div>

                  <div className="text-right">
                    <p
                      className={`text-xs font-bold ${
                        isPositive ? 'text-emerald-600' : 'text-slate-800'
                      }`}
                    >
                      {isPositive ? '+' : ''}₹{toRupees(tx.amountPaise).toFixed(2)}
                    </p>
                    {tx.balanceAfterPaise !== null && (
                      <p className="text-[10px] text-slate-400">
                        Bal: ₹{toRupees(tx.balanceAfterPaise).toFixed(2)}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {nextCursor && (
          <button
            type="button"
            onClick={() => fetchTransactions(nextCursor)}
            className="w-full py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold transition"
          >
            Load Older Transactions
          </button>
        )}
      </div>
    </div>
  );
}

export default WalletScreen;
