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
    <div className="space-y-6 pb-20">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading font-black text-3xl sm:text-4xl tracking-tight text-black">
            Bookings
          </h1>
          <p className="text-sm text-neutral-500 mt-1">
            Track active reservations, upcoming handovers, and return deadlines.
          </p>
        </div>
        <span className="text-xs font-bold px-3 py-1 rounded-full bg-amber-400 text-black shadow-xs">
          Demo money
        </span>
      </div>

      {/* Tabs (Uber style segmented control) */}
      <div className="flex gap-2 p-1.5 bg-neutral-100 rounded-2xl w-fit">
        <button
          type="button"
          onClick={() => setActiveTab('borrower')}
          className={`px-5 py-2 text-xs font-bold rounded-xl transition-all ${
            activeTab === 'borrower'
              ? 'bg-black text-white shadow-xs'
              : 'text-neutral-600 hover:text-black'
          }`}
        >
          Borrowing
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('lender')}
          className={`px-5 py-2 text-xs font-bold rounded-xl transition-all ${
            activeTab === 'lender'
              ? 'bg-black text-white shadow-xs'
              : 'text-neutral-600 hover:text-black'
          }`}
        >
          Lending
        </button>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 text-neutral-400">
          <Loader2 className="w-8 h-8 animate-spin text-black mb-3" />
          <p className="text-sm font-semibold text-neutral-600">Loading bookings...</p>
        </div>
      ) : error ? (
        <div className="p-4 bg-red-50 border border-red-200 rounded-2xl text-red-700 text-xs font-medium">
          {error}
        </div>
      ) : bookings.length === 0 ? (
        <div className="text-center py-16 px-6 bg-white rounded-3xl border border-neutral-200 shadow-xs max-w-lg mx-auto">
          <div className="inline-flex p-4 rounded-full bg-neutral-100 text-neutral-400 mb-3">
            <Package className="w-8 h-8" />
          </div>
          <h3 className="font-bold text-black text-lg mb-1">
            {activeTab === 'borrower' ? 'No borrows yet' : 'No lending requests'}
          </h3>
          <p className="text-xs text-neutral-500 max-w-sm mx-auto mb-5 leading-relaxed">
            {activeTab === 'borrower'
              ? 'Browse catalog items in your campus or neighborhood to borrow tools, cameras, and gear.'
              : 'List items you own to start earning demo rental returns.'}
          </p>
          {activeTab === 'borrower' ? (
            <button
              type="button"
              onClick={() => onNavigate('items')}
              className="px-6 py-3 bg-black hover:bg-neutral-800 text-white text-xs font-bold rounded-full shadow-xs transition"
            >
              Browse items
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onNavigate('create-item')}
              className="px-6 py-3 bg-black hover:bg-neutral-800 text-white text-xs font-bold rounded-full shadow-xs transition"
            >
              List an item
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {bookings.map((booking) => {
            const badge = STATUS_BADGES[booking.status] || {
              label: booking.status,
              bg: 'bg-neutral-100',
              text: 'text-neutral-800',
            };

            return (
              <div
                key={booking._id}
                onClick={() => handleSelect(booking._id)}
                className="bg-white rounded-3xl border border-neutral-200 p-5 shadow-xs hover:border-black cursor-pointer transition-all flex flex-col justify-between group"
              >
                <div className="space-y-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex gap-3.5 min-w-0">
                      {booking.itemId?.photos?.[0] ? (
                        <img
                          src={booking.itemId.photos[0]}
                          alt=""
                          className="w-16 h-16 object-cover rounded-2xl bg-neutral-100 shrink-0 border border-neutral-100"
                        />
                      ) : (
                        <div className="w-16 h-16 rounded-2xl bg-neutral-100 flex items-center justify-center shrink-0">
                          <Package className="w-7 h-7 text-neutral-400" />
                        </div>
                      )}
                      <div className="min-w-0">
                        <h3 className="font-bold text-black text-base truncate group-hover:text-neutral-900 transition">
                          {booking.itemId?.title || 'Item'}
                        </h3>
                        <p className="text-xs text-neutral-500 mt-0.5">
                          {activeTab === 'borrower'
                            ? `Lender: ${booking.lenderId?.name || 'User'}`
                            : `Borrower: ${booking.borrowerId?.name || 'User'}`}
                        </p>
                        <div className="flex items-center gap-1.5 text-xs text-neutral-500 mt-1.5 font-medium">
                          <Clock className="w-3.5 h-3.5 text-neutral-400" />
                          <span>
                            {booking.startDate} &rarr; {booking.endDate} ({booking.days}d)
                          </span>
                        </div>
                      </div>
                    </div>

                    <span
                      className={`text-[11px] font-bold px-2.5 py-1 rounded-full shrink-0 ${badge.bg} ${badge.text}`}
                    >
                      {badge.label}
                    </span>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-4 mt-4 border-t border-neutral-100 text-xs">
                  <span className="text-neutral-600">
                    Total:{' '}
                    <strong className="text-black font-black">
                      {formatPaise(booking.rentPaise + booking.depositPaise)}
                    </strong>
                  </span>
                  <span className="flex items-center gap-1 font-bold text-black group-hover:translate-x-0.5 transition-transform">
                    <span>Manage</span>
                    <ArrowRight className="w-3.5 h-3.5" />
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
