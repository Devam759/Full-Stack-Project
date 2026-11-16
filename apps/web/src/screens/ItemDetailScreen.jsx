import React, { useState, useEffect, useCallback } from 'react';
import {
  ArrowLeft,
  MapPin,
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  AlertTriangle,
  Clock,
  Star,
  Flag,
} from 'lucide-react';
import { formatPaise, BUSINESS_CONFIG } from '@borrowloop/shared';
import TrustBadge from '../components/TrustBadge.jsx';
import ReportModal from '../components/ReportModal.jsx';
import AdSlot from '../components/AdSlot.jsx';

export function ItemDetailScreen({ itemId, onBack, onRequestBooking }) {
  const [item, setItem] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showReportModal, setShowReportModal] = useState(false);

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
    <div className="space-y-8 pb-20">
      {/* Schema.org Product JSON-LD for rich product search snippets */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'Product',
            name: item.title,
            description: item.description,
            image: photos,
            category: item.category,
            offers: {
              '@type': 'Offer',
              price: (item.rentPerDayPaise / 100).toFixed(2),
              priceCurrency: 'INR',
              availability: item.isAvailable
                ? 'https://schema.org/InStock'
                : 'https://schema.org/OutOfStock',
            },
          }),
        }}
      />

      {/* Top Navigation & Report */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-2 text-xs font-bold text-neutral-600 hover:text-black transition"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to items</span>
        </button>
        <button
          type="button"
          onClick={() => setShowReportModal(true)}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-neutral-400 hover:text-black transition"
        >
          <Flag className="w-3.5 h-3.5" />
          <span>Report item</span>
        </button>
      </div>

      {/* Main 2-Column Product Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left Column: Photos & Details (7 cols) */}
        <div className="lg:col-span-7 space-y-6">
          {/* Photo Carousel & Gallery */}
          <div className="space-y-3">
            <div className="relative aspect-4/3 bg-neutral-100 rounded-3xl overflow-hidden border border-neutral-200 shadow-xs">
              {photos.length > 0 ? (
                <img
                  src={photos[activePhotoIdx]}
                  alt={item.title}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-neutral-400 text-sm font-medium">
                  No photo available
                </div>
              )}

              {/* Condition tag */}
              <div className="absolute top-4 left-4">
                <span className="px-3 py-1 rounded-full text-xs font-bold bg-black text-white uppercase tracking-wider shadow-sm">
                  {item.condition.replace('_', ' ')}
                </span>
              </div>

              {/* Distance Band (Rule 8) */}
              {item.distanceBand && (
                <div className="absolute bottom-4 left-4 bg-white/95 backdrop-blur-xs px-3.5 py-1.5 rounded-full text-xs font-bold text-black flex items-center gap-1.5 shadow-sm border border-neutral-200">
                  <MapPin className="w-3.5 h-3.5 text-black" />
                  <span>{item.distanceBand}</span>
                </div>
              )}
            </div>

            {/* Thumbnails */}
            {photos.length > 1 && (
              <div className="flex gap-2.5 overflow-x-auto pb-1 scrollbar-none">
                {photos.map((photoUrl, idx) => (
                  <button
                    key={photoUrl}
                    type="button"
                    onClick={() => setActivePhotoIdx(idx)}
                    className={`relative w-16 h-16 rounded-xl overflow-hidden border-2 shrink-0 transition ${
                      activePhotoIdx === idx
                        ? 'border-black ring-2 ring-black/20'
                        : 'border-neutral-200 hover:border-neutral-300'
                    }`}
                  >
                    <img src={photoUrl} alt="" className="w-full h-full object-cover" />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Title & Rating */}
          <div className="space-y-2">
            <div className="flex items-start justify-between gap-4">
              <h1 className="text-2xl sm:text-3xl font-heading font-black text-black tracking-tight leading-snug">
                {item.title}
              </h1>
              {item.ratingCount > 0 && (
                <div className="flex items-center gap-1.5 text-xs font-bold text-black bg-neutral-100 px-3 py-1 rounded-full shrink-0">
                  <Star className="w-3.5 h-3.5 fill-black text-black" />
                  <span>{item.ratingAvg?.toFixed(1)}</span>
                  <span className="text-neutral-400 font-normal">({item.ratingCount})</span>
                </div>
              )}
            </div>
            <p className="text-sm text-neutral-600 leading-relaxed whitespace-pre-line">
              {item.description}
            </p>
          </div>

          {/* Data Sensitive Category Warning (Rule 6) */}
          {isDataSensitive && (
            <div className="p-4 bg-neutral-50 border border-neutral-200 rounded-2xl flex items-start gap-3 text-neutral-900 text-xs">
              <AlertTriangle className="w-4 h-4 text-neutral-800 shrink-0 mt-0.5" />
              <div>
                <span className="font-bold block text-black">Data Privacy Advisory</span>
                <span className="text-neutral-600 mt-0.5 block">
                  This electronic device may hold personal data. Please ensure any personal accounts
                  and passwords are reset before borrowing and returning.
                </span>
              </div>
            </div>
          )}

          {/* Lender Profile Card */}
          {item.ownerId && (
            <div className="p-5 bg-white border border-neutral-200 rounded-3xl shadow-xs flex items-center justify-between">
              <div className="flex items-center gap-3.5">
                <img
                  src={item.ownerId.photoUrl || 'https://placehold.co/100x100?text=User'}
                  alt={item.ownerId.name}
                  className="w-12 h-12 rounded-full object-cover border border-neutral-200"
                />
                <div>
                  <div className="font-bold text-sm text-black">{item.ownerId.name}</div>
                  <div className="text-xs text-neutral-500">Verified Lender</div>
                </div>
              </div>
              <TrustBadge
                trustScore={item.ownerId.trustScore ?? 50}
                ratingAvg={item.ownerId.ratingAvg ?? 0}
                ratingCount={item.ownerId.ratingCount ?? 0}
                size="sm"
              />
            </div>
          )}

          {/* Availability Calendar (Rule 11) */}
          <div className="p-6 bg-white border border-neutral-200 rounded-3xl shadow-xs space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-bold text-black">
                <CalendarIcon className="w-4 h-4 text-black" />
                <span>Availability Calendar (IST)</span>
              </div>

              {/* Month selector */}
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => handleMonthChange(-1)}
                  className="p-1.5 rounded-full hover:bg-neutral-100 text-neutral-700 transition"
                  aria-label="Previous Month"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="text-xs font-bold text-black min-w-[70px] text-center">
                  {selectedMonth}
                </span>
                <button
                  type="button"
                  onClick={() => handleMonthChange(1)}
                  className="p-1.5 rounded-full hover:bg-neutral-100 text-neutral-700 transition"
                  aria-label="Next Month"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Calendar Grid */}
            {calendarLoading ? (
              <div className="py-8 text-center text-xs text-neutral-400">
                Loading availability...
              </div>
            ) : (
              <div className="grid grid-cols-7 gap-2 text-center text-xs">
                {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((dayName, idx) => (
                  <span key={idx} className="font-bold text-neutral-400 py-1">
                    {dayName}
                  </span>
                ))}
                {calendarDays.map((d) => {
                  const dayNum = parseInt(d.day.split('-')[2], 10);
                  const isTaken = d.status === 'taken';

                  return (
                    <div
                      key={d.day}
                      className={`py-2 rounded-xl font-bold text-xs ${
                        isTaken
                          ? 'bg-neutral-100 text-neutral-400 line-through'
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

            <div className="flex items-center justify-center gap-5 text-xs text-neutral-500 pt-2 border-t border-neutral-100">
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-md bg-emerald-100 border border-emerald-300" />
                <span>Available</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-md bg-neutral-200" />
                <span>Booked / Past</span>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Floating Reservation Card (5 cols) */}
        <div className="lg:col-span-5 space-y-6">
          <div className="sticky top-24 bg-white border border-neutral-200 rounded-3xl p-6 sm:p-8 shadow-sm space-y-6">
            <div className="flex items-center justify-between pb-4 border-b border-neutral-100">
              <div>
                <span className="text-xs uppercase tracking-wider text-neutral-500 font-bold">
                  Daily rate
                </span>
                <div className="text-3xl font-heading font-black text-black">
                  {formatPaise(item.rentPerDayPaise)}
                  <span className="text-sm font-normal text-neutral-500"> / day</span>
                </div>
              </div>
              <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold bg-amber-400 text-black shadow-xs">
                Demo money
              </span>
            </div>

            <div className="space-y-3 text-sm">
              <div className="flex items-center justify-between text-neutral-600">
                <span>Refundable security deposit</span>
                <span className="font-bold text-black">{formatPaise(item.depositPaise)}</span>
              </div>

              {item.lateFeePerDayPaise > 0 && (
                <div className="flex items-center justify-between text-neutral-600 text-xs">
                  <span className="flex items-center gap-1">
                    <Clock className="w-3.5 h-3.5 text-neutral-400" />
                    <span>Overdue late fee</span>
                  </span>
                  <span className="font-medium text-black">
                    {formatPaise(item.lateFeePerDayPaise)} / day
                  </span>
                </div>
              )}

              <div className="flex items-center justify-between text-neutral-600 text-xs">
                <span>Allowed duration</span>
                <span className="font-medium text-black">
                  {item.minDays} to {item.maxDays} days
                </span>
              </div>
            </div>

            <button
              type="button"
              onClick={() => {
                if (onRequestBooking) {
                  onRequestBooking(item._id);
                }
              }}
              className="w-full py-4 bg-black hover:bg-neutral-800 active:bg-neutral-900 text-white text-sm font-bold rounded-full transition shadow-xs flex items-center justify-center gap-2"
            >
              Request to borrow
            </button>

            <div className="p-4 bg-neutral-50 rounded-2xl border border-neutral-100 space-y-2 text-xs text-neutral-600">
              <div className="font-bold text-black">BorrowLoop Guarantee</div>
              <p className="leading-relaxed">
                Security deposit is locked in escrow and automatically refunded upon verified
                return. Free cancellation up to 6 hours before handover.
              </p>
            </div>

            {/* Item Sidebar Ad */}
            <AdSlot placement="item_sidebar" currentScreen="item-detail" />
          </div>
        </div>
      </div>

      {/* Report Item Modal */}
      <ReportModal
        isOpen={showReportModal}
        onClose={() => setShowReportModal(false)}
        targetType="item"
        targetId={item._id}
        targetTitle={item.title}
      />
    </div>
  );
}

export default ItemDetailScreen;
