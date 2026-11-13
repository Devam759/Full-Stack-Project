/**
 * @file apps/web/src/screens/MyBookingsScreen.jsx
 * List of user's bookings with tabs for borrowing and lending.
 */

import React, { useState, useEffect } from 'react';
import { ArrowRight, Loader2, Package, Clock } from 'lucide-react';
import { formatPaise } from '@borrowloop/shared';
import { useAuth } from '../context/AuthContext.jsx';

const STATUS_BADGES = {
  requested: { label: 'Requested', bg: 'bg-amber-100', text: 'text-amber-800' },
  accepted: { label: 'Accepted', bg: 'bg-indigo-100', text: 'text-indigo-800' },
  picked_up: { label: 'In Use', bg: 'bg-emerald-100', text: 'text-emerald-800' },
  returned: { label: 'Returned', bg: 'bg-blue-100', text: 'text-blue-800' },
  disputed: { label: 'Disputed', bg: 'bg-rose-100', text: 'text-rose-800' },
  completed: { label: 'Completed', bg: 'bg-emerald-100', text: 'text-emerald-800' },
  cancelled: { label: 'Cancelled', bg: 'bg-slate-100', text: 'text-slate-700' },
  expired: { label: 'Expired', bg: 'bg-slate-100', text: 'text-slate-600' },
};

export function MyBookingsScreen({ onSelectBooking, onNavigate }) {
  const { apiFetch } = useAuth();
  const [activeTab, setActiveTab] = useState('borrower');
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const handleSelect = (id) => {
    if (onSelectBooking) onSelectBooking(id);
    else if (onNavigate) onNavigate('booking-detail', { bookingId: id });
  };

  useEffect(() => {
    let mounted = true;
    async function fetchBookings() {
      try {
        setLoading(true);
        setError(null);
        const res = await apiFetch(`/bookings?role=${activeTab}`);
        if (mounted) {
          setBookings(res.items || []);
        }
      } catch (err) {
        if (mounted) {
          setError(err.message || 'Failed to load bookings');
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    fetchBookings();
    return () => {
      mounted = false;
    };
  }, [activeTab, apiFetch]);

  return (
    <div className="p-4 pb-24 max-w-lg mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h1 className="font-heading font-bold text-xl text-slate-900">My Bookings</h1>
        <span className="text-xs font-semibold px-2 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-300">
          Demo money
        </span>
      </div>

      {/* Tabs */}
      <div className="flex bg-slate-100 p-1 rounded-xl mb-4">
        <button
          type="button"
          onClick={() => setActiveTab('borrower')}
          className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-colors ${
            activeTab === 'borrower'
              ? 'bg-surface text-slate-900 shadow-xs'
              : 'text-text-muted hover:text-slate-900'
          }`}
        >
          Borrowing
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('lender')}
          className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-colors ${
            activeTab === 'lender'
              ? 'bg-surface text-slate-900 shadow-xs'
              : 'text-text-muted hover:text-slate-900'
          }`}
        >
          Lending
        </button>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex flex-col items-center justify-center p-12 text-text-muted">
          <Loader2 className="w-8 h-8 animate-spin text-primary mb-3" />
          <p className="text-sm font-medium">Loading bookings...</p>
        </div>
      ) : error ? (
        <div className="p-4 bg-rose-50 border border-rose-200 rounded-lg text-rose-700 text-sm">
          {error}
        </div>
      ) : bookings.length === 0 ? (
        <div className="text-center py-12 px-4 bg-surface rounded-xl border border-slate-200 shadow-xs">
          <Package className="w-12 h-12 text-slate-300 mx-auto mb-3" />
          <h3 className="font-semibold text-slate-900 text-base mb-1">
            {activeTab === 'borrower' ? 'No borrows yet' : 'No lending requests'}
          </h3>
          <p className="text-xs text-text-muted max-w-xs mx-auto mb-4">
            {activeTab === 'borrower'
              ? 'Browse items in your communities to borrow tools, gear, and games.'
              : 'List items you own to start lending them to your neighbours.'}
          </p>
          {activeTab === 'borrower' ? (
            <button
              type="button"
              onClick={() => onNavigate('items')}
              className="px-4 py-2 bg-primary text-white text-xs font-semibold rounded-lg shadow-xs hover:bg-primary-dark transition-colors"
            >
              Browse Items
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onNavigate('create-item')}
              className="px-4 py-2 bg-primary text-white text-xs font-semibold rounded-lg shadow-xs hover:bg-primary-dark transition-colors"
            >
              List an Item
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {bookings.map((booking) => {
            const badge = STATUS_BADGES[booking.status] || {
              label: booking.status,
              bg: 'bg-slate-100',
              text: 'text-slate-700',
            };

            return (
              <div
                key={booking._id}
                onClick={() => handleSelect(booking._id)}
                className="bg-surface rounded-xl border border-slate-200 p-4 shadow-xs hover:border-primary/40 cursor-pointer transition-all flex flex-col gap-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex gap-3 min-w-0">
                    {booking.itemId?.photos?.[0] ? (
                      <img
                        src={booking.itemId.photos[0]}
                        alt=""
                        className="w-14 h-14 object-cover rounded-lg bg-slate-100 shrink-0"
                      />
                    ) : (
                      <div className="w-14 h-14 rounded-lg bg-slate-100 flex items-center justify-center shrink-0">
                        <Package className="w-6 h-6 text-slate-400" />
                      </div>
                    )}
                    <div className="min-w-0">
                      <h3 className="font-semibold text-slate-900 text-sm truncate">
                        {booking.itemId?.title || 'Item'}
                      </h3>
                      <p className="text-xs text-text-muted mt-0.5">
                        {activeTab === 'borrower'
                          ? `Lender: ${booking.lenderId?.name || 'User'}`
                          : `Borrower: ${booking.borrowerId?.name || 'User'}`}
                      </p>
                      <div className="flex items-center gap-1.5 text-xs text-slate-500 mt-1">
                        <Clock className="w-3.5 h-3.5 text-slate-400" />
                        <span>
                          {booking.startDate} &rarr; {booking.endDate} ({booking.days}d)
                        </span>
                      </div>
                    </div>
                  </div>

                  <span
                    className={`text-[11px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${badge.bg} ${badge.text}`}
                  >
                    {badge.label}
                  </span>
                </div>

                <div className="flex items-center justify-between pt-2 border-t border-slate-100 text-xs text-slate-600">
                  <span>
                    Total: <strong>{formatPaise(booking.rentPaise + booking.depositPaise)}</strong>
                  </span>
                  <span className="flex items-center gap-1 font-semibold text-primary hover:text-primary-dark">
                    View Details <ArrowRight className="w-3.5 h-3.5" />
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
export default MyBookingsScreen;
