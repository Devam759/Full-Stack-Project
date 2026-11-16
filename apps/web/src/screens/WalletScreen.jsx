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
    <div className="space-y-6 pb-20">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading font-black text-3xl sm:text-4xl tracking-tight text-black">
            Wallet
          </h1>
          <p className="text-sm text-neutral-500 mt-1">
            Manage your escrow balances, top up demo credits, and track payouts.
          </p>
        </div>
        <span className="text-xs font-bold px-3 py-1 rounded-full bg-amber-400 text-black shadow-xs">
          Demo money
        </span>
      </div>

      {/* Demo Money Notice */}
      <div className="bg-neutral-50 border border-neutral-200 rounded-2xl p-4 flex items-start gap-3 text-xs text-neutral-700">
        <Shield className="w-5 h-5 text-black shrink-0 mt-0.5" />
        <div className="leading-relaxed">
          <span className="font-bold uppercase tracking-wider text-black bg-neutral-200 px-2 py-0.5 rounded-full mr-1.5 text-[10px]">
            Demo Money Mode
          </span>
          All funds on BorrowLoop are simulated demo credits for testing. No real money or bank
          accounts are debited.
        </div>
      </div>

      {/* Notifications */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-xs font-medium p-4 rounded-2xl flex items-center gap-2.5">
          <AlertCircle className="w-5 h-5 text-red-600 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {actionSuccess && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-semibold p-4 rounded-2xl flex items-center gap-2.5">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
          <span>{actionSuccess}</span>
        </div>
      )}

      {/* Uber Sleek Pitch-Black Balance Card */}
      <div className="bg-black text-white rounded-3xl p-8 shadow-lg space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-neutral-800 flex items-center justify-center text-white">
              <WalletIcon className="w-5 h-5" />
            </div>
            <div>
              <span className="text-xs font-bold uppercase tracking-wider text-neutral-400">
                Available balance
              </span>
              <div className="text-4xl font-heading font-black text-white tracking-tight mt-0.5">
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
            className="p-2.5 text-neutral-400 hover:text-white rounded-full hover:bg-neutral-800 transition"
            title="Refresh balance"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-4 pt-4 border-t border-neutral-800 text-xs">
          <div>
            <span className="text-neutral-400 block mb-0.5">Held in active escrows</span>
            <span className="font-bold text-white text-sm">
              {formatPaise(wallet?.frozenPaise || 0, { showDemoTag: false })}
            </span>
          </div>
          <div>
            <span className="text-neutral-400 block mb-0.5">Wallet limit</span>
            <span className="font-bold text-white text-sm">₹50,000.00</span>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row gap-3 pt-2">
          <button
            type="button"
            onClick={() => {
              setActiveTab(activeTab === 'add' ? 'overview' : 'add');
              setInputRupees('');
              setError(null);
            }}
            disabled={!wallet?.canAddFunds}
            className={`flex-1 flex items-center justify-center gap-2 py-3.5 px-6 rounded-full font-bold text-xs transition ${
              activeTab === 'add'
                ? 'bg-neutral-200 text-black'
                : 'bg-white text-black hover:bg-neutral-200 shadow-xs'
            } ${!wallet?.canAddFunds ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            <PlusCircle className="w-4 h-4" />
            <span>Add demo money</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveTab(activeTab === 'withdraw' ? 'overview' : 'withdraw');
              setInputRupees('');
              setError(null);
            }}
            disabled={!wallet || wallet.availablePaise <= 0}
            className={`flex-1 flex items-center justify-center gap-2 py-3.5 px-6 rounded-full font-bold text-xs transition border border-neutral-700 ${
              activeTab === 'withdraw'
                ? 'bg-neutral-800 text-white'
                : 'bg-neutral-900 text-white hover:bg-neutral-800'
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
          className="bg-white rounded-3xl border border-neutral-200 p-6 sm:p-8 shadow-sm space-y-5 animate-fade-in"
        >
          <div className="flex items-center justify-between">
            <h3 className="text-base font-bold text-black">Top up demo wallet</h3>
            <span className="text-xs text-neutral-500 font-semibold">
              Limit remaining: ₹{(capRemainingPaise / 100).toFixed(2)}
            </span>
          </div>

          {/* Quick Amount Selectors */}
          <div className="grid grid-cols-4 gap-2.5">
            {[100, 500, 1000, 5000].map((amt) => (
              <button
                key={amt}
                type="button"
                onClick={() => setInputRupees(amt.toString())}
                className="py-2.5 px-2 bg-neutral-100 hover:bg-black hover:text-white rounded-xl text-xs font-bold text-black transition"
              >
                +₹{amt}
              </button>
            ))}
          </div>

          <div>
            <label className="block text-xs font-bold text-neutral-800 uppercase tracking-wider mb-1.5">
              Enter amount (₹)
            </label>
            <div className="relative">
              <span className="absolute left-4 top-3.5 text-neutral-400 font-bold">₹</span>
              <input
                type="number"
                step="0.01"
                min="100"
                max={capRemainingPaise / 100}
                placeholder="500.00"
                value={inputRupees}
                onChange={(e) => setInputRupees(e.target.value)}
                required
                className="w-full pl-9 pr-4 py-3 bg-neutral-100 hover:bg-neutral-100/80 focus:bg-white border border-transparent focus:border-black rounded-xl text-black font-bold outline-none text-sm transition"
              />
            </div>
            <p className="text-xs text-neutral-500 mt-1">Min: ₹100.00 • Max: ₹50,000.00</p>
          </div>

          <div className="flex items-center gap-3 pt-2">
            <button
              type="submit"
              disabled={isSubmitting || !inputRupees}
              className="flex-1 py-3.5 px-6 rounded-full bg-black hover:bg-neutral-800 text-white text-xs font-bold disabled:opacity-50 flex items-center justify-center gap-2 transition shadow-xs"
            >
              {isSubmitting && <RefreshCw className="w-4 h-4 animate-spin" />}
              <span>{isSubmitting ? 'Adding...' : 'Confirm top up'}</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('overview')}
              className="py-3.5 px-6 rounded-full bg-neutral-100 hover:bg-neutral-200 text-black text-xs font-bold transition"
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
          className="bg-white rounded-3xl border border-neutral-200 p-6 sm:p-8 shadow-sm space-y-5 animate-fade-in"
        >
          <div className="flex items-center justify-between">
            <h3 className="text-base font-bold text-black">Withdraw to bank account (demo)</h3>
            <span className="text-xs text-neutral-500 font-semibold">
              Available: ₹{toRupees(wallet?.availablePaise || 0).toFixed(2)}
            </span>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-bold text-neutral-800 uppercase tracking-wider">
                Amount to withdraw (₹)
              </label>
              <button
                type="button"
                onClick={() => setInputRupees(toRupees(wallet?.availablePaise || 0).toString())}
                className="text-xs font-bold text-black hover:underline"
              >
                Max Available
              </button>
            </div>
            <div className="relative">
              <span className="absolute left-4 top-3.5 text-neutral-400 font-bold">₹</span>
              <input
                type="number"
                step="0.01"
                min="100"
                max={toRupees(wallet?.availablePaise || 0)}
                placeholder="200.00"
                value={inputRupees}
                onChange={(e) => setInputRupees(e.target.value)}
                required
                className="w-full pl-9 pr-4 py-3 bg-neutral-100 hover:bg-neutral-100/80 focus:bg-white border border-transparent focus:border-black rounded-xl text-black font-bold outline-none text-sm transition"
              />
            </div>
          </div>

          <div className="flex items-center gap-3 pt-2">
            <button
              type="submit"
              disabled={isSubmitting || !inputRupees}
              className="flex-1 py-3.5 px-6 rounded-full bg-black hover:bg-neutral-800 text-white text-xs font-bold disabled:opacity-50 flex items-center justify-center gap-2 transition shadow-xs"
            >
              {isSubmitting && <RefreshCw className="w-4 h-4 animate-spin" />}
              <span>{isSubmitting ? 'Withdrawing...' : 'Confirm withdrawal'}</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('overview')}
              className="py-3.5 px-6 rounded-full bg-neutral-100 hover:bg-neutral-200 text-black text-xs font-bold transition"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Transaction History Section */}
      <div className="bg-white rounded-3xl border border-neutral-200 p-6 sm:p-8 shadow-xs space-y-4">
        <div className="flex items-center justify-between border-b border-neutral-100 pb-3">
          <h3 className="text-base font-bold text-black flex items-center gap-2">
            <Clock className="w-4 h-4 text-neutral-400" />
            <span>Activity Ledger</span>
          </h3>
          <span className="text-xs text-neutral-400 font-semibold">
            {transactions.length} record(s)
          </span>
        </div>

        {transactions.length === 0 ? (
          <div className="py-12 text-center text-xs text-neutral-400 space-y-2">
            <Clock className="w-8 h-8 text-neutral-300 mx-auto" />
            <p className="font-bold text-black">No transactions yet</p>
            <p className="text-xs text-neutral-500">
              Top up demo money above to start borrowing and lending.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-neutral-100">
            {transactions.map((tx) => {
              const isPositive = tx.amountPaise > 0;
              return (
                <div
                  key={tx.id || tx._id}
                  className="py-3.5 flex items-center justify-between text-xs"
                >
                  <div className="flex items-center gap-3.5">
                    <div
                      className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${
                        isPositive ? 'bg-neutral-100 text-black' : 'bg-neutral-100 text-neutral-600'
                      }`}
                    >
                      {isPositive ? (
                        <ArrowDownLeft className="w-4 h-4 text-black" />
                      ) : (
                        <ArrowUpRight className="w-4 h-4 text-neutral-600" />
                      )}
                    </div>
                    <div>
                      <p className="text-xs font-bold text-black capitalize">
                        {tx.type.replace(/_/g, ' ')}
                      </p>
                      <p className="text-[11px] text-neutral-500">
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
                      className={`text-xs font-black ${
                        isPositive ? 'text-black' : 'text-neutral-700'
                      }`}
                    >
                      {isPositive ? '+' : ''}₹{toRupees(tx.amountPaise).toFixed(2)}
                    </p>
                    {tx.balanceAfterPaise !== null && tx.balanceAfterPaise !== undefined && (
                      <p className="text-[10px] text-neutral-400">
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
            className="w-full py-3 bg-neutral-100 hover:bg-neutral-200 text-black rounded-full text-xs font-bold transition mt-2"
          >
            Load older activity
          </button>
        )}
      </div>
    </div>
  );
}

export default WalletScreen;
