/**
 * @file apps/web/src/components/RatingModal.jsx
 * Modal for submitting blind ratings with star selector, comment, and explanation.
 */

import React, { useState } from 'react';
import { X, Star, Lock, AlertCircle, Loader2 } from 'lucide-react';
import api from '../api/client.js';

export default function RatingModal({
  isOpen,
  onClose,
  bookingId,
  targetRole = 'lender',
  onSuccess,
}) {
  const [stars, setStars] = useState(5);
  const [hoverStars, setHoverStars] = useState(0);
  const [comment, setComment] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  if (!isOpen) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      setLoading(true);
      setError(null);

      const rand = Math.random().toString(36).slice(2);
      const res = await api.post(
        `/bookings/${bookingId}/rating`,
        {
          stars,
          comment: comment.trim(),
        },
        {
          headers: {
            'Idempotency-Key': `ik_rate_${Date.now()}_${rand}`,
          },
        },
      );

      onSuccess?.(res);
      onClose();
    } catch (err) {
      setError(err.message || 'Failed to submit rating');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
      <div className="bg-white rounded-3xl max-w-sm w-full p-6 shadow-2xl relative border border-neutral-200">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-2 text-neutral-400 hover:text-neutral-900 rounded-full hover:bg-neutral-100 transition"
        >
          <X className="w-5 h-5" />
        </button>

        <h3 className="text-xl font-black tracking-tight text-neutral-900 mb-1">
          Rate Your Experience
        </h3>
        <p className="text-xs text-neutral-500 mb-4">
          How was your borrow experience with the {targetRole}?
        </p>

        {error && (
          <div className="p-3 bg-rose-50 text-rose-700 rounded-2xl text-xs flex items-center gap-2 mb-3 border border-rose-200">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Star Rating Selector */}
          <div className="flex items-center justify-center gap-2 py-2">
            {[1, 2, 3, 4, 5].map((s) => {
              const isFilled = (hoverStars || stars) >= s;
              return (
                <button
                  type="button"
                  key={s}
                  onClick={() => setStars(s)}
                  onMouseEnter={() => setHoverStars(s)}
                  onMouseLeave={() => setHoverStars(0)}
                  className="p-1 transition-transform hover:scale-110 focus:outline-none"
                >
                  <Star
                    className={`w-8 h-8 ${
                      isFilled
                        ? 'text-amber-400 fill-amber-400'
                        : 'text-neutral-200 fill-neutral-100 hover:text-amber-200'
                    }`}
                  />
                </button>
              );
            })}
          </div>

          {/* Comment Box */}
          <div>
            <label className="block text-xs font-bold text-neutral-700 mb-1.5">
              Public Review (Optional, max 500 characters)
            </label>
            <textarea
              rows={3}
              maxLength={500}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder={`Share details about item condition, communication, or punctuality...`}
              className="w-full px-3 py-2 text-sm border border-neutral-200 rounded-2xl bg-neutral-50 focus:bg-white focus:outline-none focus:border-black resize-none"
            />
            <div className="text-[10px] text-neutral-400 text-right mt-0.5">
              {comment.length}/500
            </div>
          </div>

          {/* Blind Rating Notice */}
          <div className="p-3 bg-neutral-50 rounded-2xl border border-neutral-200 flex items-start gap-2.5 text-xs text-neutral-500">
            <Lock className="w-4 h-4 text-neutral-400 shrink-0 mt-0.5" />
            <div>
              <span className="font-bold text-neutral-900">Blind Review:</span> Your rating is kept
              secret until both parties submit, or after 7 days, to ensure honest feedback.
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3.5 px-4 bg-black hover:bg-neutral-800 text-white rounded-full font-bold text-sm transition disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer"
          >
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
            <span>Submit Rating</span>
          </button>
        </form>
      </div>
    </div>
  );
}
