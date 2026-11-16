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
  QrCode,
  Star,
  Camera,
} from 'lucide-react';
import { formatPaise } from '@borrowloop/shared';
import { useAuth } from '../context/AuthContext.jsx';
import { useSocket } from '../context/SocketContext.jsx';
import { ChatPanel } from '../components/ChatPanel.jsx';
import QRModal from '../components/QRModal.jsx';
import QRScannerModal from '../components/QRScannerModal.jsx';
import ConditionPhotosUploader from '../components/ConditionPhotosUploader.jsx';
import RatingModal from '../components/RatingModal.jsx';
import OpenDisputeModal from '../components/OpenDisputeModal.jsx';
import ReportModal from '../components/ReportModal.jsx';

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

  // Phase 7 Handover, Return & Ratings state
  const [showQrModal, setShowQrModal] = useState(false);
  const [qrType, setQrType] = useState('pickup');
  const [showScannerModal, setShowScannerModal] = useState(false);
  const [scannerType, setScannerType] = useState('pickup');
  const [showConfirmReturnModal, setShowConfirmReturnModal] = useState(false);
  const [returnProblemNote, setReturnProblemNote] = useState('');
  const [showRatingModal, setShowRatingModal] = useState(false);

  // Phase 8 Disputes & Reports state
  const [showDisputeModal, setShowDisputeModal] = useState(false);
  const [disputeModalReason, setDisputeModalReason] = useState('condition_mismatch');
  const [showReportUserModal, setShowReportUserModal] = useState(false);

  // Live Socket.IO Updates (booking:updated)
  const { socket } = useSocket();

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

  // Live real-time socket updates
  useEffect(() => {
    if (!socket || !bookingId) return;
    const handleBookingUpdated = (data) => {
      if (data?.bookingId === bookingId) {
        loadBooking();
      }
    };
    socket.on('booking:updated', handleBookingUpdated);
    return () => {
      socket.off('booking:updated', handleBookingUpdated);
    };
  }, [socket, bookingId, loadBooking]);

  // Return review confirmation handler
  async function handleConfirmReturn(outcome) {
    if (outcome === 'problem' && !returnProblemNote.trim()) {
      setError('Note is required when reporting a problem');
      return;
    }
    try {
      setActionLoading(true);
      setError(null);
      const idempotencyKey = crypto.randomUUID();
      await apiFetch(`/bookings/${bookingId}/return/confirm`, {
        method: 'POST',
        headers: { 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify({ outcome, note: returnProblemNote.trim() }),
      });
      setShowConfirmReturnModal(false);
      setActionNotice(
        outcome === 'ok'
          ? 'Return confirmed! Settlement completed successfully.'
          : 'Problem reported. Care moderation team will review.',
      );
      await loadBooking();
    } catch (err) {
      setError(err.message || 'Failed to confirm return');
    } finally {
      setActionLoading(false);
    }
  }

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

  // Phase 8: Dispute opening guards
  const now = Date.now();
  const pickupDeadlineMs = booking.pickupDeadline ? new Date(booking.pickupDeadline).getTime() : 0;
  const dueAtMs = booking.dueAt ? new Date(booking.dueAt).getTime() : 0;

  const canOpenNoShowDispute =
    (isBorrower || isLender) &&
    booking.status === 'accepted' &&
    now >= startDayZeroIST &&
    (pickupDeadlineMs ? now <= pickupDeadlineMs : true);

  const canOpenConditionDispute =
    isBorrower && booking.status === 'picked_up' && (dueAtMs ? now <= dueAtMs : true);

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
    <div className="max-w-4xl mx-auto space-y-6 pb-24">
      {/* Top Bar */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={handleBack}
          className="inline-flex items-center gap-2 text-xs font-bold text-neutral-600 hover:text-black transition"
          aria-label="Back"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to bookings</span>
        </button>
        <div className="flex items-center gap-2.5">
          <span className="text-xs font-bold px-3 py-1 rounded-full bg-amber-400 text-black shadow-xs">
            Demo money
          </span>
          <span className="text-xs font-bold px-3 py-1 rounded-full uppercase tracking-wider bg-black text-white">
            {booking.status}
          </span>
        </div>
      </div>

      {actionNotice && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl flex items-center gap-2.5 text-emerald-800 text-xs font-semibold">
          <CheckCircle2 className="w-5 h-5 shrink-0 text-emerald-600" />
          <span>{actionNotice}</span>
        </div>
      )}

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-2xl flex items-start gap-2.5 text-red-700 text-xs font-medium">
          <AlertCircle className="w-5 h-5 shrink-0 text-red-600 mt-0.5" />
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
        <div className="flex items-center justify-between pb-1 border-b border-slate-100">
          <h3 className="font-semibold text-sm text-slate-900">Financial Summary</h3>
          <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-amber-100 text-amber-800 border border-amber-300">
            Demo money
          </span>
        </div>
        <div className="flex justify-between text-xs text-slate-600">
          <span>Rent ({booking.days} days)</span>
          <span>{formatPaise(booking.rentPaise)}</span>
        </div>
        <div className="flex justify-between text-xs text-slate-600">
          <span>Security Deposit (Refundable)</span>
          <span>{formatPaise(booking.depositPaise)}</span>
        </div>
        {booking.lateChargePaise > 0 && (
          <div className="flex justify-between text-xs text-rose-600 font-semibold">
            <span>Late Fee (Overdue)</span>
            <span>+{formatPaise(booking.lateChargePaise)}</span>
          </div>
        )}
        <div className="pt-2 border-t border-slate-100 flex justify-between font-bold text-sm text-slate-900">
          <span>Total Booking Value</span>
          <span className="text-primary">
            {formatPaise(booking.rentPaise + booking.depositPaise + (booking.lateChargePaise || 0))}
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

        {/* Phase 7: Handover Pickup Section */}
        {booking.status === 'accepted' && (
          <div className="bg-surface rounded-2xl border border-slate-200 p-4 shadow-xs space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-sm text-slate-900 flex items-center gap-1.5">
                <QrCode className="w-4 h-4 text-primary" /> Handover Pickup
              </h3>
              <span className="text-[11px] text-text-muted">Proximity verified</span>
            </div>

            {isLender ? (
              <button
                type="button"
                onClick={() => {
                  setQrType('pickup');
                  setShowQrModal(true);
                }}
                className="w-full py-3 bg-primary text-white font-semibold rounded-xl hover:bg-primary-dark transition-colors flex items-center justify-center gap-2 text-sm shadow-xs"
              >
                <QrCode className="w-4 h-4" />
                <span>Show Pickup QR & Fallback Code</span>
              </button>
            ) : isBorrower ? (
              <button
                type="button"
                onClick={() => {
                  setScannerType('pickup');
                  setShowScannerModal(true);
                }}
                className="w-full py-3 bg-primary text-white font-semibold rounded-xl hover:bg-primary-dark transition-colors flex items-center justify-center gap-2 text-sm shadow-xs"
              >
                <Camera className="w-4 h-4" />
                <span>Scan Lender&apos;s QR Code</span>
              </button>
            ) : null}

            <ConditionPhotosUploader
              bookingId={booking._id}
              stage="pickup"
              onUploadComplete={loadBooking}
            />

            {canOpenNoShowDispute && (
              <button
                type="button"
                onClick={() => {
                  setDisputeModalReason('no_show');
                  setShowDisputeModal(true);
                }}
                className="w-full py-2.5 bg-rose-50 text-rose-700 font-semibold rounded-xl hover:bg-rose-100 border border-rose-200 transition text-xs flex items-center justify-center gap-1.5 shadow-xs"
              >
                <AlertTriangle className="w-3.5 h-3.5" />
                <span>Report Counterparty No-Show</span>
              </button>
            )}
          </div>
        )}

        {/* Phase 7: Handover Return Section */}
        {booking.status === 'picked_up' && (
          <div className="bg-surface rounded-2xl border border-slate-200 p-4 shadow-xs space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-sm text-slate-900 flex items-center gap-1.5">
                <QrCode className="w-4 h-4 text-primary" /> Item Return
              </h3>
              <span className="text-[11px] text-text-muted">Due: {booking.endDate}</span>
            </div>

            {isBorrower ? (
              <button
                type="button"
                onClick={() => {
                  setQrType('return');
                  setShowQrModal(true);
                }}
                className="w-full py-3 bg-primary text-white font-semibold rounded-xl hover:bg-primary-dark transition-colors flex items-center justify-center gap-2 text-sm shadow-xs"
              >
                <QrCode className="w-4 h-4" />
                <span>Show Return QR & Fallback Code</span>
              </button>
            ) : isLender ? (
              <button
                type="button"
                onClick={() => {
                  setScannerType('return');
                  setShowScannerModal(true);
                }}
                className="w-full py-3 bg-primary text-white font-semibold rounded-xl hover:bg-primary-dark transition-colors flex items-center justify-center gap-2 text-sm shadow-xs"
              >
                <Camera className="w-4 h-4" />
                <span>Scan Borrower&apos;s Return QR</span>
              </button>
            ) : null}

            <ConditionPhotosUploader
              bookingId={booking._id}
              stage="return"
              onUploadComplete={loadBooking}
            />

            {canOpenConditionDispute && (
              <button
                type="button"
                onClick={() => {
                  setDisputeModalReason('condition_mismatch');
                  setShowDisputeModal(true);
                }}
                className="w-full py-2.5 bg-amber-50 text-amber-900 font-semibold rounded-xl hover:bg-amber-100 border border-amber-200 transition text-xs flex items-center justify-center gap-1.5 shadow-xs"
              >
                <AlertTriangle className="w-3.5 h-3.5" />
                <span>Report Condition Mismatch Dispute</span>
              </button>
            )}
          </div>
        )}

        {/* Phase 7: Return Confirmation & Inspection */}
        {booking.status === 'returned' && (
          <div className="bg-surface rounded-2xl border border-amber-200 p-4 shadow-xs space-y-3 bg-amber-50/50">
            <h3 className="font-semibold text-sm text-amber-900 flex items-center gap-1.5">
              <Clock className="w-4 h-4 text-amber-600" /> Return Review Window
            </h3>

            {isLender ? (
              <div className="space-y-3">
                <p className="text-xs text-amber-800">
                  The borrower has returned your item. Please inspect its condition and confirm
                  settlement within 24 hours.
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    disabled={actionLoading}
                    onClick={() => handleConfirmReturn('ok')}
                    className="py-2.5 bg-emerald-600 text-white font-semibold rounded-xl hover:bg-emerald-700 disabled:opacity-50 text-xs transition"
                  >
                    All Good (Settle)
                  </button>
                  <button
                    type="button"
                    disabled={actionLoading}
                    onClick={() => setShowConfirmReturnModal(true)}
                    className="py-2.5 bg-rose-50 text-rose-700 border border-rose-200 font-semibold rounded-xl hover:bg-rose-100 disabled:opacity-50 text-xs transition"
                  >
                    Report a Problem
                  </button>
                </div>
              </div>
            ) : (
              <div className="text-xs text-amber-800">
                <span className="font-semibold block">Waiting for lender review</span>
                <span>
                  The lender has 24 hours to confirm condition. If no problem is reported, funds
                  will automatically settle to both wallets.
                </span>
              </div>
            )}
          </div>
        )}

        {/* Phase 8: Disputed status banner */}
        {booking.status === 'disputed' && (
          <div className="bg-surface rounded-2xl border border-rose-200 p-4 shadow-xs space-y-3 bg-rose-50/60">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-sm text-rose-900 flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4 text-rose-600" /> Booking Under Dispute
              </h3>
              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-800 border border-rose-300">
                DISPUTED
              </span>
            </div>
            <p className="text-xs text-rose-800">
              Reason:{' '}
              <span className="font-semibold uppercase">
                {booking.disputeReason?.replace('_', ' ')}
              </span>
              . Escrow funds remain frozen until customer care resolves the case.
            </p>
            <button
              type="button"
              onClick={() => {
                if (onNavigate) {
                  onNavigate('dispute-detail', { bookingId: booking._id });
                }
              }}
              className="w-full py-2.5 bg-rose-600 hover:bg-rose-700 text-white font-semibold rounded-xl text-xs transition shadow-xs flex items-center justify-center gap-1.5"
            >
              <span>View Dispute Case File & Evidence</span>
            </button>
          </div>
        )}

        {/* Phase 7: Completed & Ratings */}
        {booking.status === 'completed' && (
          <div className="bg-surface rounded-2xl border border-emerald-200 p-4 shadow-xs space-y-3 bg-emerald-50/40">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-sm text-emerald-900 flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" /> Booking Completed & Settled
              </h3>
              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
                Demo money
              </span>
            </div>
            <p className="text-xs text-emerald-800">
              Rental funds and deposit have been settled according to platform rules.
            </p>
            <button
              type="button"
              onClick={() => setShowRatingModal(true)}
              className="w-full py-2.5 bg-primary text-white font-semibold rounded-xl hover:bg-primary-dark transition-colors flex items-center justify-center gap-2 text-xs shadow-xs"
            >
              <Star className="w-3.5 h-3.5 fill-amber-300 text-amber-300" />
              <span>Leave a Review (Blind Rating)</span>
            </button>
          </div>
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

      {/* Handover / Return QR Modal */}
      <QRModal
        isOpen={showQrModal}
        onClose={() => setShowQrModal(false)}
        bookingId={booking._id}
        type={qrType}
      />

      {/* Handover / Return Scanner Modal */}
      <QRScannerModal
        isOpen={showScannerModal}
        onClose={() => setShowScannerModal(false)}
        bookingId={booking._id}
        type={scannerType}
        onSuccess={() => {
          loadBooking();
          setActionNotice(
            scannerType === 'pickup'
              ? 'Item successfully picked up!'
              : 'Item successfully returned!',
          );
        }}
      />

      {/* Blind Rating Modal */}
      <RatingModal
        isOpen={showRatingModal}
        onClose={() => setShowRatingModal(false)}
        bookingId={booking._id}
        targetRole={isBorrower ? 'lender' : 'borrower'}
        onSuccess={() => {
          loadBooking();
          setActionNotice(
            'Rating submitted! It will be revealed once both parties submit or after 7 days.',
          );
        }}
      />

      {/* Problem Report Modal */}
      {showConfirmReturnModal && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-surface rounded-2xl max-w-sm w-full p-5 shadow-lg space-y-4">
            <h3 className="font-bold text-slate-900 text-base">Report Return Problem</h3>
            <p className="text-xs text-text-muted">
              Reporting a problem will open a dispute with customer care. Security deposit and
              rental funds will remain frozen until review.
            </p>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Describe the problem (Required)
              </label>
              <textarea
                rows={3}
                value={returnProblemNote}
                onChange={(e) => setReturnProblemNote(e.target.value)}
                placeholder="e.g. Scratched lens, missing cables, deep dent..."
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-rose-500"
              />
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setShowConfirmReturnModal(false)}
                className="flex-1 py-2 text-xs font-semibold bg-slate-100 text-slate-700 rounded-lg"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={actionLoading || !returnProblemNote.trim()}
                onClick={() => handleConfirmReturn('problem')}
                className="flex-1 py-2 text-xs font-semibold bg-rose-600 text-white rounded-lg hover:bg-rose-700 disabled:opacity-50"
              >
                Submit Report
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Phase 8: Open Dispute Modal */}
      <OpenDisputeModal
        isOpen={showDisputeModal}
        onClose={() => setShowDisputeModal(false)}
        bookingId={booking._id}
        defaultReason={disputeModalReason}
        onSuccess={() => {
          loadBooking();
          if (onNavigate) {
            onNavigate('dispute-detail', { bookingId: booking._id });
          }
        }}
      />

      {/* Phase 8: Report User Modal */}
      <ReportModal
        isOpen={showReportUserModal}
        onClose={() => setShowReportUserModal(false)}
        targetType="user"
        targetId={
          isBorrower
            ? booking.lenderId?._id || booking.lenderId
            : booking.borrowerId?._id || booking.borrowerId
        }
        targetTitle={
          isBorrower ? booking.lenderId?.name || 'Lender' : booking.borrowerId?.name || 'Borrower'
        }
      />
    </div>
  );
}
export default BookingDetailScreen;
