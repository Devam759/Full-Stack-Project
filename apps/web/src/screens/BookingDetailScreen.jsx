/**
 * @file apps/web/src/screens/BookingDetailScreen.jsx
 * Screen displaying complete booking details, status history timeline,
 * and state-dependent lifecycle actions with idempotency and penalty warnings.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  ArrowLeft,
  Calendar,
  Clock,
  AlertTriangle,
  AlertCircle,
  Loader2,
  CheckCircle2,
  User,
} from 'lucide-react';
import { formatPaise } from '@borrowloop/shared';
import { useAuth } from '../context/AuthContext.jsx';
import { ChatPanel } from '../components/ChatPanel.jsx';

export function BookingDetailScreen({ bookingId, onBack, onNavigate }) {
  const { user, apiFetch } = useAuth();
  const [booking, setBooking] = useState(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState(null);
  const [actionNotice, setActionNotice] = useState(null);

  const handleBack = () => {
    if (onBack) onBack();
    else if (onNavigate) onNavigate('my-bookings');
  };

  // Modals state
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [showExtensionModal, setShowExtensionModal] = useState(false);
  const [newEndDate, setNewEndDate] = useState('');

  // Fetch booking details
  const loadBooking = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await apiFetch(`/bookings/${bookingId}`);
      setBooking(res.booking);
    } catch (err) {
      setError(err.message || 'Failed to load booking details');
    } finally {
      setLoading(false);
    }
  }, [apiFetch, bookingId]);

  useEffect(() => {
    if (bookingId) {
      loadBooking();
    }
  }, [bookingId, loadBooking]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-text-muted">
        <Loader2 className="w-8 h-8 animate-spin text-primary mb-3" />
        <p className="text-sm font-medium">Loading booking...</p>
      </div>
    );
  }

  if (!booking) {
    return (
      <div className="p-4 text-center">
        <p className="text-rose-600 font-medium">Booking not found.</p>
        <button
          type="button"
          onClick={handleBack}
          className="mt-4 px-4 py-2 bg-slate-100 rounded-lg text-sm"
        >
          Back to Bookings
        </button>
      </div>
    );
  }

  const isBorrower = booking.borrowerId?._id === user?.id || booking.borrowerId === user?.id;
  const isLender = booking.lenderId?._id === user?.id || booking.lenderId === user?.id;

  // Check late cancel threshold (6h before start date 00:00:00 IST)
  const startDayZeroIST = new Date(`${booking.startDate}T00:00:00.000+05:30`).getTime();
  const isLateCancel = Date.now() >= startDayZeroIST - 6 * 60 * 60 * 1000;

  // Action Handlers
  async function handleAcceptBooking() {
    try {
      setActionLoading(true);
      setError(null);
      const idempotencyKey = crypto.randomUUID();
      await apiFetch(`/bookings/${bookingId}/accept`, {
        method: 'POST',
        headers: { 'Idempotency-Key': idempotencyKey },
      });
      setActionNotice('Booking accepted successfully! Day locks and wallet funds are secured.');
      await loadBooking();
    } catch (err) {
      setError(err.message || 'Failed to accept booking');
    } finally {
      setActionLoading(false);
    }
  }

  async function handleRejectBooking() {
    try {
      setActionLoading(true);
      setError(null);
      const idempotencyKey = crypto.randomUUID();
      await apiFetch(`/bookings/${bookingId}/reject`, {
        method: 'POST',
        headers: { 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify({ reason: rejectReason }),
      });
      setShowRejectModal(false);
      setActionNotice('Booking request was rejected.');
      await loadBooking();
    } catch (err) {
      setError(err.message || 'Failed to reject booking');
    } finally {
      setActionLoading(false);
    }
  }

  async function handleCancelBooking() {
    try {
      setActionLoading(true);
      setError(null);
      const idempotencyKey = crypto.randomUUID();
      await apiFetch(`/bookings/${bookingId}/cancel`, {
        method: 'POST',
        headers: { 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify({ reason: cancelReason }),
      });
      setShowCancelModal(false);
      setActionNotice(
        isLateCancel && booking.status === 'accepted'
          ? 'Booking cancelled. Note: A late cancellation penalty of 3 trust score points was applied.'
          : 'Booking cancelled successfully. Any frozen funds have been refunded to the wallet.',
      );
      await loadBooking();
    } catch (err) {
      setError(err.message || 'Failed to cancel booking');
    } finally {
      setActionLoading(false);
    }
  }

  async function handleRequestExtension() {
    try {
      setActionLoading(true);
      setError(null);
      const idempotencyKey = crypto.randomUUID();
      await apiFetch(`/bookings/${bookingId}/extensions`, {
        method: 'POST',
        headers: { 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify({ newEndDate }),
      });
      setShowExtensionModal(false);
      setActionNotice('Extension request sent to lender.');
      await loadBooking();
    } catch (err) {
      setError(err.message || 'Failed to request extension');
    } finally {
      setActionLoading(false);
    }
  }

  async function handleAcceptExtension() {
    try {
      setActionLoading(true);
      setError(null);
      const idempotencyKey = crypto.randomUUID();
      await apiFetch(`/bookings/${bookingId}/extensions/accept`, {
        method: 'POST',
        headers: { 'Idempotency-Key': idempotencyKey },
      });
      setActionNotice('Extension approved! New dates and extra rent have been updated.');
      await loadBooking();
    } catch (err) {
      setError(err.message || 'Failed to approve extension');
    } finally {
      setActionLoading(false);
    }
  }

  async function handleRejectExtension() {
    try {
      setActionLoading(true);
      setError(null);
      const idempotencyKey = crypto.randomUUID();
      await apiFetch(`/bookings/${bookingId}/extensions/reject`, {
        method: 'POST',
        headers: { 'Idempotency-Key': idempotencyKey },
      });
      setActionNotice('Extension request rejected.');
      await loadBooking();
    } catch (err) {
      setError(err.message || 'Failed to reject extension');
    } finally {
      setActionLoading(false);
    }
  }

  return (
    <div className="p-4 pb-28 max-w-lg mx-auto">
      {/* Top Bar */}
      <div className="flex items-center justify-between mb-4">
        <button
          type="button"
          onClick={handleBack}
          className="p-2 hover:bg-slate-100 rounded-full transition-colors"
          aria-label="Back"
        >
          <ArrowLeft className="w-5 h-5 text-slate-700" />
        </button>
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold px-2 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-300">
            Demo money
          </span>
          <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full uppercase tracking-wider bg-slate-100 text-slate-800">
            {booking.status}
          </span>
        </div>
      </div>

      {actionNotice && (
        <div className="mb-4 p-3 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center gap-2 text-emerald-800 text-sm">
          <CheckCircle2 className="w-5 h-5 shrink-0" />
          <span>{actionNotice}</span>
        </div>
      )}

      {error && (
        <div className="mb-4 p-3 bg-rose-50 border border-rose-200 rounded-xl flex items-start gap-2 text-rose-800 text-sm">
          <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {/* Item Summary Card */}
      <div className="bg-surface rounded-2xl border border-slate-200 p-4 mb-4 shadow-xs">
        <div className="flex gap-3">
          {booking.itemId?.photos?.[0] && (
            <img
              src={booking.itemId.photos[0]}
              alt=""
              className="w-16 h-16 object-cover rounded-xl bg-slate-100 shrink-0"
            />
          )}
          <div className="min-w-0 flex-1">
            <h2 className="font-heading font-bold text-slate-900 text-base truncate">
              {booking.itemId?.title}
            </h2>
            <div className="flex items-center gap-2 text-xs text-text-muted mt-1">
              <Calendar className="w-3.5 h-3.5" />
              <span>
                {booking.startDate} &rarr; {booking.endDate} ({booking.days} days)
              </span>
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-500 mt-1">
              <User className="w-3.5 h-3.5" />
              <span>
                {isBorrower
                  ? `Lender: ${booking.lenderId?.name}`
                  : `Borrower: ${booking.borrowerId?.name}`}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Payment Details */}
      <div className="bg-surface rounded-2xl border border-slate-200 p-4 mb-4 shadow-xs space-y-2">
        <h3 className="font-semibold text-sm text-slate-900">Financial Summary</h3>
        <div className="flex justify-between text-xs text-slate-600">
          <span>Rent ({booking.days} days)</span>
          <span>{formatPaise(booking.rentPaise)}</span>
        </div>
        <div className="flex justify-between text-xs text-slate-600">
          <span>Security Deposit (Refundable)</span>
          <span>{formatPaise(booking.depositPaise)}</span>
        </div>
        <div className="pt-2 border-t border-slate-100 flex justify-between font-bold text-sm text-slate-900">
          <span>Total Booking Value</span>
          <span className="text-primary">
            {formatPaise(booking.rentPaise + booking.depositPaise)}
          </span>
        </div>
      </div>

      {/* Extension Section if active or pending */}
      {booking.extension && booking.extension.status && (
        <div className="bg-surface rounded-2xl border border-slate-200 p-4 mb-4 shadow-xs space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-sm text-slate-900">Booking Extension</h3>
            <span
              className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                booking.extension.status === 'accepted'
                  ? 'bg-emerald-100 text-emerald-800'
                  : booking.extension.status === 'rejected'
                    ? 'bg-rose-100 text-rose-800'
                    : 'bg-amber-100 text-amber-800'
              }`}
            >
              {booking.extension.status}
            </span>
          </div>

          <p className="text-xs text-slate-600">
            Requested new end date: <strong>{booking.extension.requestedEndDate}</strong> (+
            {booking.extension.extraDays} days, extra rent:{' '}
            {formatPaise(booking.extension.extraRentPaise)})
          </p>

          {isLender && booking.extension.status === 'requested' && (
            <div className="flex gap-2 pt-2">
              <button
                type="button"
                disabled={actionLoading}
                onClick={handleAcceptExtension}
                className="flex-1 py-1.5 bg-emerald-600 text-white text-xs font-semibold rounded-lg hover:bg-emerald-700 disabled:opacity-50"
              >
                Approve Extension
              </button>
              <button
                type="button"
                disabled={actionLoading}
                onClick={handleRejectExtension}
                className="flex-1 py-1.5 bg-slate-100 text-slate-700 text-xs font-semibold rounded-lg hover:bg-slate-200 disabled:opacity-50"
              >
                Decline
              </button>
            </div>
          )}
        </div>
      )}

      {/* Status History Timeline */}
      <div className="bg-surface rounded-2xl border border-slate-200 p-4 mb-5 shadow-xs">
        <h3 className="font-semibold text-sm text-slate-900 mb-3 flex items-center gap-1.5">
          <Clock className="w-4 h-4 text-primary" /> Lifecycle Timeline
        </h3>
        <div className="space-y-3 relative before:absolute before:left-3 before:top-2 before:bottom-2 before:w-0.5 before:bg-slate-200">
          {booking.statusHistory?.map((h, idx) => (
            <div key={idx} className="relative pl-7 text-xs">
              <div className="absolute left-2 top-1.5 w-2.5 h-2.5 -translate-x-1/2 rounded-full bg-primary ring-4 ring-white" />
              <div className="flex items-center gap-2">
                <span className="font-semibold text-slate-900 uppercase tracking-wider text-[11px]">
                  {h.toStatus}
                </span>
                <span className="text-[10px] text-text-muted">
                  {new Date(h.timestamp).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
              </div>
              <p className="text-text-muted mt-0.5">
                By <span className="capitalize font-medium text-slate-700">{h.actorRole}</span>
                {h.reason && ` • ${h.reason}`}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Lifecycle Action Buttons */}
      <div className="space-y-2">
        {/* Lender: Accept / Reject when 'requested' */}
        {isLender && booking.status === 'requested' && (
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              disabled={actionLoading}
              onClick={handleAcceptBooking}
              className="py-3 bg-primary text-white font-semibold rounded-xl hover:bg-primary-dark disabled:opacity-50 transition-colors shadow-xs flex items-center justify-center gap-1.5 text-sm"
            >
              {actionLoading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <CheckCircle2 className="w-4 h-4" />
              )}
              Accept Request
            </button>
            <button
              type="button"
              disabled={actionLoading}
              onClick={() => setShowRejectModal(true)}
              className="py-3 bg-slate-100 text-slate-700 font-semibold rounded-xl hover:bg-slate-200 disabled:opacity-50 transition-colors text-sm"
            >
              Reject Request
            </button>
          </div>
        )}

        {/* Borrower / Lender: Cancel before pickup */}
        {(booking.status === 'requested' || booking.status === 'accepted') && (
          <button
            type="button"
            disabled={actionLoading}
            onClick={() => setShowCancelModal(true)}
            className="w-full py-2.5 border border-rose-200 text-rose-700 font-medium rounded-xl hover:bg-rose-50 disabled:opacity-50 transition-colors text-xs"
          >
            Cancel Booking
          </button>
        )}

        {/* Borrower: Request Extension */}
        {isBorrower &&
          (booking.status === 'accepted' || booking.status === 'picked_up') &&
          (!booking.extension || booking.extension.status !== 'requested') && (
            <button
              type="button"
              disabled={actionLoading}
              onClick={() => setShowExtensionModal(true)}
              className="w-full py-2.5 bg-slate-100 text-slate-800 font-medium rounded-xl hover:bg-slate-200 disabled:opacity-50 transition-colors text-xs"
            >
              Request Extension
            </button>
          )}

        {/* Phase 6: Booking Chat & Handover Map Pin */}
        <div className="pt-4">
          <ChatPanel
            bookingId={booking._id}
            currentUserId={user?._id || user?.id}
            bookingStatus={booking.status}
          />
        </div>
      </div>

      {/* Cancel Confirmation Modal */}
      {showCancelModal && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-surface rounded-2xl max-w-sm w-full p-5 shadow-lg space-y-4">
            <h3 className="font-bold text-slate-900 text-base">Cancel Booking?</h3>
            {isLateCancel && booking.status === 'accepted' ? (
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800 flex items-start gap-2">
                <AlertTriangle className="w-5 h-5 shrink-0 text-amber-600" />
                <span>
                  <strong>Late Cancellation Warning:</strong> Cancelling within 6 hours of pickup
                  deducts 3 trust score points. All frozen money will be refunded to your available
                  balance.
                </span>
              </div>
            ) : (
              <p className="text-xs text-text-muted">
                Are you sure you want to cancel this booking? Any frozen funds will be returned to
                the wallet.
              </p>
            )}

            <div>
              <label
                htmlFor="cancelReasonInput"
                className="block text-xs font-medium text-slate-700 mb-1"
              >
                Reason (optional)
              </label>
              <input
                id="cancelReasonInput"
                type="text"
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                placeholder="e.g. Schedule change"
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setShowCancelModal(false)}
                className="flex-1 py-2 text-xs font-semibold bg-slate-100 text-slate-700 rounded-lg"
              >
                Go Back
              </button>
              <button
                type="button"
                disabled={actionLoading}
                onClick={handleCancelBooking}
                className="flex-1 py-2 text-xs font-semibold bg-rose-600 text-white rounded-lg hover:bg-rose-700 disabled:opacity-50"
              >
                {actionLoading ? 'Cancelling...' : 'Confirm Cancel'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reject Modal */}
      {showRejectModal && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-surface rounded-2xl max-w-sm w-full p-5 shadow-lg space-y-4">
            <h3 className="font-bold text-slate-900 text-base">Decline Booking Request</h3>
            <p className="text-xs text-text-muted">
              You can provide an optional note to the borrower explaining why.
            </p>
            <input
              type="text"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="e.g. Item currently undergoing maintenance"
              className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setShowRejectModal(false)}
                className="flex-1 py-2 text-xs font-semibold bg-slate-100 text-slate-700 rounded-lg"
              >
                Back
              </button>
              <button
                type="button"
                disabled={actionLoading}
                onClick={handleRejectBooking}
                className="flex-1 py-2 text-xs font-semibold bg-rose-600 text-white rounded-lg hover:bg-rose-700 disabled:opacity-50"
              >
                Decline Request
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Extension Modal */}
      {showExtensionModal && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-surface rounded-2xl max-w-sm w-full p-5 shadow-lg space-y-4">
            <h3 className="font-bold text-slate-900 text-base">Request Extension</h3>
            <p className="text-xs text-text-muted">
              Current end date: <strong>{booking.endDate}</strong>
            </p>
            <div>
              <label
                htmlFor="newEndDateInput"
                className="block text-xs font-medium text-slate-700 mb-1"
              >
                New End Date
              </label>
              <input
                id="newEndDateInput"
                type="date"
                min={booking.endDate}
                value={newEndDate}
                onChange={(e) => setNewEndDate(e.target.value)}
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setShowExtensionModal(false)}
                className="flex-1 py-2 text-xs font-semibold bg-slate-100 text-slate-700 rounded-lg"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={actionLoading || !newEndDate || newEndDate <= booking.endDate}
                onClick={handleRequestExtension}
                className="flex-1 py-2 text-xs font-semibold bg-primary text-white rounded-lg hover:bg-primary-dark disabled:opacity-50"
              >
                Submit Request
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
export default BookingDetailScreen;
