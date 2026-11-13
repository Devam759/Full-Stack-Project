import React, { useState, useEffect, useCallback } from 'react';
import {
  ArrowLeft,
  MapPin,
  ShieldCheck,
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  AlertTriangle,
  Clock,
} from 'lucide-react';
import { formatPaise, BUSINESS_CONFIG } from '@borrowloop/shared';

export function ItemDetailScreen({ itemId, onBack, onRequestBooking }) {
  const [item, setItem] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Active Photo Carousel index
  const [activePhotoIdx, setActivePhotoIdx] = useState(0);

  // Calendar State
  const now = new Date();
  const currentMonthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const [selectedMonth, setSelectedMonth] = useState(currentMonthStr);
  const [calendarDays, setCalendarDays] = useState([]);
  const [calendarLoading, setCalendarLoading] = useState(false);

  // Fetch Item Details
  useEffect(() => {
    async function loadItem() {
      setLoading(true);
      setError(null);
      try {
        const token = localStorage.getItem('accessToken');
        const res = await fetch(`/v1/items/${itemId}`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error?.message || 'Failed to load item details');
        }

        const data = await res.json();
        setItem(data);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }

    if (itemId) {
      loadItem();
    }
  }, [itemId]);

  // Fetch Calendar Availability for selectedMonth
  const loadAvailability = useCallback(async () => {
    if (!itemId) return;
    setCalendarLoading(true);
    try {
      const token = localStorage.getItem('accessToken');
      const res = await fetch(`/v1/items/${itemId}/availability?month=${selectedMonth}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (res.ok) {
        const data = await res.json();
        setCalendarDays(data.days || []);
      }
    } catch {
      // Ignored
    } finally {
      setCalendarLoading(false);
    }
  }, [itemId, selectedMonth]);

  useEffect(() => {
    loadAvailability();
  }, [loadAvailability]);

  // Navigate Calendar Month
  const handleMonthChange = (offset) => {
    const [year, month] = selectedMonth.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1 + offset, 1));
    const newMonthStr = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;

    // Restrict within 0 to +6 months
    const minMonth = currentMonthStr;
    const maxDate = new Date();
    maxDate.setMonth(maxDate.getMonth() + BUSINESS_CONFIG.AVAILABILITY_MAX_MONTHS_AHEAD);
    const maxMonthStr = `${maxDate.getFullYear()}-${String(maxDate.getMonth() + 1).padStart(2, '0')}`;

    if (newMonthStr >= minMonth && newMonthStr <= maxMonthStr) {
      setSelectedMonth(newMonthStr);
    }
  };

  if (loading) {
    return (
      <div className="py-24 text-center text-text-muted text-xs">
        <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-2" />
        Loading item details...
      </div>
    );
  }

  if (error || !item) {
    return (
      <div className="p-4 space-y-4">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-slate-900"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to items</span>
        </button>
        <div className="p-4 bg-red-50 border border-red-200 text-red-700 rounded-xl text-xs">
          {error || 'Item not found or you do not have permission to view it.'}
        </div>
      </div>
    );
  }

  const isDataSensitive = BUSINESS_CONFIG.DATA_SENSITIVE_CATEGORIES.includes(item.category);
  const photos = item.photos || [];

  return (
    <div className="p-4 pb-28 space-y-5">
      {/* Back button */}
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900"
      >
        <ArrowLeft className="w-4 h-4" />
        <span>Back to items</span>
      </button>

      {/* Photo Carousel & Gallery */}
      <div className="space-y-2">
        <div className="relative aspect-4/3 bg-slate-100 rounded-2xl overflow-hidden border border-slate-200 shadow-xs">
          {photos.length > 0 ? (
            <img
              src={photos[activePhotoIdx]}
              alt={item.title}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-slate-400 text-xs">
              No photo available
            </div>
          )}

          {/* Condition tag */}
          <div className="absolute top-3 left-3">
            <span className="px-2.5 py-1 rounded-md text-xs font-semibold bg-black/70 text-white backdrop-blur-xs uppercase tracking-wider">
              {item.condition.replace('_', ' ')}
            </span>
          </div>

          {/* Distance Band (Rule 8) */}
          {item.distanceBand && (
            <div className="absolute bottom-3 left-3 bg-surface/90 backdrop-blur-xs px-2.5 py-1 rounded-md text-xs font-medium text-slate-700 flex items-center gap-1.5 shadow-xs">
              <MapPin className="w-3.5 h-3.5 text-primary" />
              <span>{item.distanceBand}</span>
            </div>
          )}
        </div>

        {/* Thumbnails */}
        {photos.length > 1 && (
          <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
            {photos.map((photoUrl, idx) => (
              <button
                key={photoUrl}
                type="button"
                onClick={() => setActivePhotoIdx(idx)}
                className={`relative w-14 h-14 rounded-lg overflow-hidden border-2 shrink-0 transition ${
                  activePhotoIdx === idx
                    ? 'border-primary ring-2 ring-primary/20'
                    : 'border-slate-200'
                }`}
              >
                <img src={photoUrl} alt="" className="w-full h-full object-cover" />
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Data Sensitive Category Warning (Rule 6) */}
      {isDataSensitive && (
        <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-2.5 text-amber-900 text-xs shadow-xs">
          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <div>
            <span className="font-semibold block">Data Privacy Advisory</span>
            <span>
              This electronic device may hold personal data. Please ensure any personal accounts and
              passwords are reset before borrowing and returning.
            </span>
          </div>
        </div>
      )}

      {/* Title & Description */}
      <div>
        <h1 className="text-xl font-heading font-bold text-slate-900">{item.title}</h1>
        <p className="text-xs text-text-muted mt-1 leading-relaxed whitespace-pre-line">
          {item.description}
        </p>
      </div>

      {/* Pricing & Deposit Card - Hard Rule 9 Demo Money */}
      <div className="p-4 bg-surface border border-slate-200 rounded-2xl shadow-xs space-y-3">
        <div className="flex items-center justify-between pb-2 border-b border-slate-100">
          <span className="text-xs font-semibold text-slate-700">Rental Terms</span>
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800 border border-amber-300">
            Demo money
          </span>
        </div>

        <div className="grid grid-cols-2 gap-3 text-xs">
          <div>
            <div className="text-text-muted">Rent per day</div>
            <div className="text-lg font-bold text-primary font-heading">
              {formatPaise(item.rentPerDayPaise)}
            </div>
          </div>
          <div>
            <div className="text-text-muted">Security Deposit</div>
            <div className="text-base font-semibold text-slate-800 font-heading">
              {formatPaise(item.depositPaise)}
            </div>
          </div>
        </div>

        {item.lateFeePerDayPaise > 0 && (
          <div className="text-[11px] text-text-muted flex items-center gap-1.5 pt-1">
            <Clock className="w-3.5 h-3.5 text-slate-400" />
            <span>Overdue late fee: {formatPaise(item.lateFeePerDayPaise)} / started day</span>
          </div>
        )}

        <div className="text-[11px] text-text-muted pt-1 border-t border-slate-100">
          Booking duration: {item.minDays} to {item.maxDays} days
        </div>
      </div>

      {/* Lender Profile Card */}
      {item.ownerId && (
        <div className="p-4 bg-surface border border-slate-200 rounded-2xl shadow-xs flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img
              src={item.ownerId.photoUrl || 'https://placehold.co/100x100?text=User'}
              alt={item.ownerId.name}
              className="w-10 h-10 rounded-full object-cover border border-slate-200"
            />
            <div>
              <div className="font-semibold text-sm text-slate-900">{item.ownerId.name}</div>
              <div className="text-xs text-text-muted">Lender</div>
            </div>
          </div>
          <div className="flex items-center gap-1 px-2.5 py-1 bg-emerald-50 border border-emerald-200 rounded-lg text-emerald-800 text-xs font-semibold">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
            <span>Trust score: {item.ownerId.trustScore ?? 50}</span>
          </div>
        </div>
      )}

      {/* Availability Calendar (Rule 11) */}
      <div className="p-4 bg-surface border border-slate-200 rounded-2xl shadow-xs space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-800">
            <CalendarIcon className="w-4 h-4 text-primary" />
            <span>Availability Calendar (IST)</span>
          </div>

          {/* Month selector */}
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => handleMonthChange(-1)}
              className="p-1 rounded hover:bg-slate-100 text-slate-600"
              aria-label="Previous Month"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-xs font-semibold text-slate-700 min-w-[70px] text-center">
              {selectedMonth}
            </span>
            <button
              type="button"
              onClick={() => handleMonthChange(1)}
              className="p-1 rounded hover:bg-slate-100 text-slate-600"
              aria-label="Next Month"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Calendar Grid */}
        {calendarLoading ? (
          <div className="py-6 text-center text-xs text-text-muted">Loading calendar...</div>
        ) : (
          <div className="grid grid-cols-7 gap-1.5 text-center text-[11px]">
            {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((dayName, idx) => (
              <span key={idx} className="font-semibold text-slate-400 py-1">
                {dayName}
              </span>
            ))}
            {calendarDays.map((d) => {
              const dayNum = parseInt(d.day.split('-')[2], 10);
              const isTaken = d.status === 'taken';

              return (
                <div
                  key={d.day}
                  className={`py-1.5 rounded-md font-medium ${
                    isTaken
                      ? 'bg-slate-100 text-slate-400 line-through'
                      : 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                  }`}
                  title={`${d.day}: ${d.status}`}
                >
                  {dayNum}
                </div>
              );
            })}
          </div>
        )}

        <div className="flex items-center justify-center gap-4 text-[10px] text-text-muted pt-1 border-t border-slate-100">
          <div className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-sm bg-emerald-100 border border-emerald-300" />
            <span>Available</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-sm bg-slate-200" />
            <span>Booked / Past</span>
          </div>
        </div>
      </div>

      {/* Floating Bottom Action Bar */}
      <div className="fixed bottom-14 left-0 right-0 max-w-lg mx-auto p-3 bg-surface/90 backdrop-blur-md border-t border-slate-200 z-40 flex items-center justify-between">
        <div>
          <div className="text-xs text-text-muted">Total rent + deposit</div>
          <div className="text-sm font-bold text-slate-900 font-heading">
            {formatPaise(item.rentPerDayPaise + item.depositPaise)} (1 day)
          </div>
        </div>

        <button
          type="button"
          onClick={() => {
            if (onRequestBooking) {
              onRequestBooking(item._id);
            }
          }}
          className="px-5 py-2.5 bg-primary text-white text-xs font-semibold rounded-xl hover:bg-primary-dark transition shadow-md"
        >
          Request to Borrow
        </button>
      </div>
    </div>
  );
}

export default ItemDetailScreen;
