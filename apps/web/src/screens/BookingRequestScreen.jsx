/**
 * @file apps/web/src/screens/BookingRequestScreen.jsx
 * Screen for creating a new booking request with interactive date selection,
 * real-time price calculation, wallet sufficiency verification, and idempotency protection.
 */

import React, { useState, useEffect } from 'react';
import { ArrowLeft, Calendar, ShieldCheck, AlertCircle, Loader2 } from 'lucide-react';
import { formatPaise } from '@borrowloop/shared';
import { useAuth } from '../context/AuthContext.jsx';

export function BookingRequestScreen({ itemId, onBack, onSuccess, onNavigate }) {
  const { apiFetch } = useAuth();
  const [item, setItem] = useState(null);
  const [wallet, setWallet] = useState(null);
  const [availability, setAvailability] = useState([]);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [idempotencyKey, setIdempotencyKey] = useState(null);

  const handleBack = () => {
    if (onBack) onBack();
    else if (onNavigate) onNavigate('item-detail', { itemId });
  };

  // Load item, availability and wallet data
  useEffect(() => {
    let mounted = true;
    async function loadData() {
      try {
        setLoading(true);
        const [itemRes, walletRes, availRes] = await Promise.all([
          apiFetch(`/items/${itemId}`),
          apiFetch('/wallet'),
          apiFetch(`/items/${itemId}/availability`),
        ]);

        if (mounted) {
          setItem(itemRes.item);
          setWallet(walletRes.wallet);
          setAvailability(availRes.days || []);
          setIdempotencyKey(crypto.randomUUID());
        }
      } catch (err) {
        if (mounted) {
          setError(err.message || 'Failed to load booking details');
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    if (itemId) {
      loadData();
    }
    return () => {
      mounted = false;
    };
  }, [itemId, apiFetch]);

  // Calculate days & costs
  const numDays =
    startDate && endDate && endDate >= startDate
      ? Math.round(
          (new Date(endDate + 'T00:00:00Z') - new Date(startDate + 'T00:00:00Z')) /
            (1000 * 60 * 60 * 24),
        ) + 1
      : 0;

  const rentPaise = item ? numDays * item.rentPerDayPaise : 0;
  const depositPaise = item ? item.depositPaise : 0;
  const totalHoldPaise = rentPaise + depositPaise;

  const availablePaise = wallet ? wallet.availablePaise : 0;
  const hasSufficientFunds = availablePaise >= totalHoldPaise;

  const isDateReserved = availability.some(
    (lock) => startDate && endDate && lock.day >= startDate && lock.day <= endDate,
  );

  async function handleSubmit(e) {
    e.preventDefault();
    if (!startDate || !endDate || numDays <= 0) {
      setError('Please select valid start and end dates');
      return;
    }
    if (isDateReserved) {
      setError('Some selected dates are already booked. Please choose available dates.');
      return;
    }
    if (!hasSufficientFunds) {
      setError('Insufficient wallet balance to request this booking. Please add demo funds.');
      return;
    }

    try {
      setSubmitting(true);
      setError(null);

      const res = await apiFetch('/bookings', {
        method: 'POST',
        headers: {
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify({
          itemId,
          startDate,
          endDate,
        }),
      });

      if (res.booking) {
        if (onSuccess) {
          onSuccess(res.booking);
        } else if (onNavigate) {
          onNavigate('booking-detail', { bookingId: res.booking._id });
        }
      }
    } catch (err) {
      setError(err.message || 'Failed to submit booking request');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-text-muted">
        <Loader2 className="w-8 h-8 animate-spin text-primary mb-3" />
        <p className="text-sm font-medium">Loading item and availability...</p>
      </div>
    );
  }

  if (!item) {
    return (
      <div className="p-4 text-center">
        <p className="text-rose-600 font-medium">Item not found.</p>
        <button
          type="button"
          onClick={handleBack}
          className="mt-4 px-4 py-2 bg-slate-100 rounded-lg text-sm"
        >
          Back to items
        </button>
      </div>
    );
  }

  return (
    <div className="p-4 pb-24 max-w-lg mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <button
          type="button"
          onClick={handleBack}
          className="p-2 hover:bg-slate-100 rounded-full transition-colors"
          aria-label="Back"
        >
          <ArrowLeft className="w-5 h-5 text-slate-700" />
        </button>
        <h1 className="font-heading font-bold text-xl text-slate-900">Request to Borrow</h1>
      </div>

      {/* Item Summary Card */}
      <div className="bg-surface rounded-xl border border-slate-200 p-4 mb-5 shadow-xs flex gap-3">
        {item.photos?.[0] && (
          <img
            src={item.photos[0]}
            alt={item.title}
            className="w-20 h-20 object-cover rounded-lg bg-slate-100 shrink-0"
          />
        )}
        <div className="flex-1 min-w-0">
          <h2 className="font-semibold text-slate-900 truncate">{item.title}</h2>
          <p className="text-xs text-text-muted mt-0.5">Condition: {item.condition}</p>
          <div className="flex items-baseline gap-2 mt-2">
            <span className="font-bold text-primary text-sm">
              {formatPaise(item.rentPerDayPaise)}
            </span>
            <span className="text-xs text-text-muted">/ day</span>
            <span className="text-xs text-slate-500 ml-auto">
              Deposit: {formatPaise(item.depositPaise)}
            </span>
          </div>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-rose-50 border border-rose-200 rounded-lg flex items-start gap-2 text-rose-700 text-sm">
          <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {/* Booking Form */}
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="bg-surface rounded-xl border border-slate-200 p-4 shadow-xs space-y-3">
          <h3 className="font-semibold text-sm text-slate-900 flex items-center gap-2">
            <Calendar className="w-4 h-4 text-primary" /> Select Dates
          </h3>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="startDate" className="block text-xs font-medium text-text-muted mb-1">
                Start Date
              </label>
              <input
                id="startDate"
                type="date"
                required
                value={startDate}
                min={new Date().toISOString().slice(0, 10)}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full text-sm px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary focus:outline-none"
              />
            </div>
            <div>
              <label htmlFor="endDate" className="block text-xs font-medium text-text-muted mb-1">
                End Date
              </label>
              <input
                id="endDate"
                type="date"
                required
                value={endDate}
                min={startDate || new Date().toISOString().slice(0, 10)}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full text-sm px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary focus:outline-none"
              />
            </div>
          </div>

          <p className="text-xs text-text-muted">
            Duration limit: {item.minDays || 1} to {item.maxDays || 30} days
          </p>
        </div>

        {/* Price & Hold Breakdown */}
        {numDays > 0 && (
          <div className="bg-surface rounded-xl border border-slate-200 p-4 shadow-xs space-y-2.5">
            <h3 className="font-semibold text-sm text-slate-900">Payment Breakdown</h3>

            <div className="flex justify-between text-sm text-slate-600">
              <span>
                Rental ({numDays} {numDays === 1 ? 'day' : 'days'})
              </span>
              <span>{formatPaise(rentPaise)}</span>
            </div>

            <div className="flex justify-between text-sm text-slate-600">
              <span>Security Deposit (refundable)</span>
              <span>{formatPaise(depositPaise)}</span>
            </div>

            <div className="pt-2 border-t border-slate-200 flex justify-between font-bold text-slate-900 text-base">
              <span>Total Hold Required</span>
              <span className="text-primary">{formatPaise(totalHoldPaise)}</span>
            </div>

            {/* Demo Money Tag - Hard Rule 9 */}
            <div className="flex items-center gap-1.5 pt-1 text-xs text-amber-700 bg-amber-50 p-2 rounded-lg border border-amber-200">
              <ShieldCheck className="w-4 h-4 text-amber-600 shrink-0" />
              <span>
                <strong>Demo money:</strong> Funds will only be frozen once the lender accepts your
                request.
              </span>
            </div>
          </div>
        )}

        {/* Wallet Status */}
        <div className="bg-slate-50 rounded-xl border border-slate-200 p-3.5 flex items-center justify-between">
          <div>
            <p className="text-xs text-text-muted">Your Available Balance</p>
            <p className="text-sm font-bold text-slate-800">{formatPaise(availablePaise)}</p>
          </div>
          {!hasSufficientFunds && numDays > 0 && (
            <button
              type="button"
              onClick={() => onNavigate('wallet')}
              className="px-3 py-1.5 bg-primary text-white text-xs font-semibold rounded-lg hover:bg-primary-dark transition-colors shadow-xs"
            >
              Add Demo Funds
            </button>
          )}
        </div>

        {/* Action Button */}
        <button
          type="submit"
          disabled={submitting || !numDays || !hasSufficientFunds || isDateReserved}
          className="w-full py-3 bg-primary text-white font-semibold rounded-xl hover:bg-primary-dark disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm flex items-center justify-center gap-2"
        >
          {submitting ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Sending Request...
            </>
          ) : (
            `Send Request • ${numDays > 0 ? formatPaise(totalHoldPaise) : 'Select Dates'}`
          )}
        </button>
      </form>
    </div>
  );
}
export default BookingRequestScreen;
