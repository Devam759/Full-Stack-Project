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
    <div className="max-w-xl mx-auto space-y-6 pb-20">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleBack}
          className="p-2 hover:bg-neutral-100 rounded-full transition-colors"
          aria-label="Back"
        >
          <ArrowLeft className="w-5 h-5 text-black" />
        </button>
        <div>
          <h1 className="font-heading font-black text-2xl sm:text-3xl tracking-tight text-black">
            Confirm reservation
          </h1>
          <p className="text-xs text-neutral-500 mt-0.5">Review booking details and escrow hold</p>
        </div>
      </div>

      {/* Item Summary Card */}
      <div className="bg-white rounded-3xl border border-neutral-200 p-5 shadow-xs flex items-center gap-4">
        {item.photos?.[0] && (
          <img
            src={item.photos[0]}
            alt={item.title}
            className="w-20 h-20 object-cover rounded-2xl bg-neutral-100 shrink-0 border border-neutral-200"
          />
        )}
        <div className="flex-1 min-w-0">
          <h2 className="font-bold text-black text-base truncate">{item.title}</h2>
          <p className="text-xs text-neutral-500 mt-0.5 capitalize">
            Condition: {item.condition.replace('_', ' ')}
          </p>
          <div className="flex items-baseline gap-2 mt-2">
            <span className="font-black text-black text-base font-heading">
              {formatPaise(item.rentPerDayPaise)}
            </span>
            <span className="text-xs text-neutral-500">/ day</span>
            <span className="text-xs font-semibold text-neutral-700 ml-auto">
              Deposit: {formatPaise(item.depositPaise)}
            </span>
          </div>
        </div>
      </div>

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 text-red-700 rounded-2xl text-xs flex items-start gap-2.5">
          <AlertCircle className="w-4 h-4 shrink-0 text-red-600 mt-0.5" />
          <span className="font-medium">{error}</span>
        </div>
      )}

      {/* Booking Form */}
      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="bg-white rounded-3xl border border-neutral-200 p-6 shadow-xs space-y-4">
          <h3 className="font-bold text-sm text-black flex items-center gap-2">
            <Calendar className="w-4 h-4 text-black" /> Select Reservation Dates
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label
                htmlFor="startDate"
                className="block text-xs font-bold text-neutral-700 uppercase tracking-wider mb-1.5"
              >
                Start date
              </label>
              <input
                id="startDate"
                type="date"
                required
                value={startDate}
                min={new Date().toISOString().slice(0, 10)}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full text-sm px-4 py-3 bg-neutral-100 hover:bg-neutral-100/80 focus:bg-white border border-transparent focus:border-black rounded-xl outline-none font-medium transition"
              />
            </div>
            <div>
              <label
                htmlFor="endDate"
                className="block text-xs font-bold text-neutral-700 uppercase tracking-wider mb-1.5"
              >
                End date
              </label>
              <input
                id="endDate"
                type="date"
                required
                value={endDate}
                min={startDate || new Date().toISOString().slice(0, 10)}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full text-sm px-4 py-3 bg-neutral-100 hover:bg-neutral-100/80 focus:bg-white border border-transparent focus:border-black rounded-xl outline-none font-medium transition"
              />
            </div>
          </div>

          <p className="text-xs text-neutral-500">
            Allowed duration for this item: {item.minDays || 1} to {item.maxDays || 30} days
          </p>
        </div>

        {/* Price & Hold Breakdown */}
        {numDays > 0 && (
          <div className="bg-white rounded-3xl border border-neutral-200 p-6 shadow-xs space-y-3">
            <h3 className="font-bold text-sm text-black">Payment &amp; Escrow Breakdown</h3>

            <div className="flex justify-between text-sm text-neutral-600">
              <span>
                Rental fee ({numDays} {numDays === 1 ? 'day' : 'days'})
              </span>
              <span className="font-bold text-black">{formatPaise(rentPaise)}</span>
            </div>

            <div className="flex justify-between text-sm text-neutral-600">
              <span>Security Deposit (refundable)</span>
              <span className="font-bold text-black">{formatPaise(depositPaise)}</span>
            </div>

            <div className="pt-3 border-t border-neutral-100 flex justify-between font-black text-black text-lg">
              <span>Total hold required</span>
              <span className="text-black">{formatPaise(totalHoldPaise)}</span>
            </div>

            {/* Demo Money Tag - Hard Rule 9 */}
            <div className="flex items-center gap-2 pt-2 text-xs text-amber-900 bg-amber-50 p-3 rounded-2xl border border-amber-200">
              <ShieldCheck className="w-4 h-4 text-amber-600 shrink-0" />
              <span>
                <strong>Demo money mode:</strong> Funds will only be frozen once the lender confirms
                your reservation.
              </span>
            </div>
          </div>
        )}

        {/* Wallet Status */}
        <div className="bg-neutral-50 rounded-3xl border border-neutral-200 p-5 flex items-center justify-between">
          <div>
            <p className="text-xs text-neutral-500">Available demo wallet balance</p>
            <p className="text-base font-black text-black">{formatPaise(availablePaise)}</p>
          </div>
          {!hasSufficientFunds && numDays > 0 && (
            <button
              type="button"
              onClick={() => onNavigate('wallet')}
              className="px-4 py-2 bg-black hover:bg-neutral-800 text-white text-xs font-bold rounded-full transition shadow-xs"
            >
              Add demo funds
            </button>
          )}
        </div>

        {/* Action Button */}
        <button
          type="submit"
          disabled={submitting || !numDays || !hasSufficientFunds || isDateReserved}
          className="w-full py-4 bg-black hover:bg-neutral-800 active:bg-neutral-900 text-white font-bold rounded-full disabled:opacity-50 disabled:cursor-not-allowed transition shadow-xs flex items-center justify-center gap-2 text-sm"
        >
          {submitting ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Sending request...</span>
            </>
          ) : (
            `Confirm reservation • ${numDays > 0 ? formatPaise(totalHoldPaise) : 'Select dates'}`
          )}
        </button>
      </form>
    </div>
  );
}
export default BookingRequestScreen;
