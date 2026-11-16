import React, { useState } from 'react';
import { Flag, X, AlertTriangle, CheckCircle, Loader2 } from 'lucide-react';
import api from '../api/client.js';

const REASONS_BY_TYPE = {
  item: [
    { value: 'prohibited_item', label: 'Prohibited or Illegal Item' },
    { value: 'misleading', label: 'Misleading Description or Photos' },
    { value: 'unsafe', label: 'Unsafe or Damaged Beyond Use' },
    { value: 'spam', label: 'Spam or Duplicate Listing' },
    { value: 'other', label: 'Other Issue' },
  ],
  user: [
    { value: 'harassment', label: 'Harassment or Abusive Behavior' },
    { value: 'fraud', label: 'Suspected Fraud or Scam' },
    { value: 'fake_profile', label: 'Fake Profile or Impersonation' },
    { value: 'inappropriate', label: 'Inappropriate Content or Conduct' },
    { value: 'other', label: 'Other Safety Concern' },
  ],
  message: [
    { value: 'harassment', label: 'Harassment or Offensive Language' },
    { value: 'spam', label: 'Spam or Promotional Content' },
    { value: 'threat', label: 'Threats or Intimidation' },
    { value: 'inappropriate', label: 'Inappropriate Content' },
    { value: 'other', label: 'Other Safety Concern' },
  ],
};

export function ReportModal({ isOpen, onClose, targetType, targetId, targetTitle }) {
  const [reason, setReason] = useState(REASONS_BY_TYPE[targetType]?.[0]?.value || 'other');
  const [details, setDetails] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);

  if (!isOpen) return null;

  const reasons = REASONS_BY_TYPE[targetType] || REASONS_BY_TYPE.item;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      await api.post('/reports', {
        targetType,
        targetId,
        reason,
        details: details.trim(),
      });

      setSuccess(true);
      setTimeout(() => {
        setSuccess(false);
        onClose();
      }, 1500);
    } catch (err) {
      setError(err.message || 'Failed to submit report');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-white w-full max-w-md rounded-3xl border border-neutral-200 shadow-2xl overflow-hidden p-6 space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-neutral-100">
          <div className="flex items-center gap-2 text-neutral-900 font-black text-base">
            <Flag className="w-4 h-4 text-neutral-900" />
            <span>Report {targetType ? targetType.toUpperCase() : 'CONTENT'}</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-full text-neutral-400 hover:text-neutral-900 hover:bg-neutral-100 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {targetTitle && (
          <p className="text-xs text-neutral-500">
            Reporting: <span className="font-bold text-neutral-900">{targetTitle}</span>
          </p>
        )}

        {error && (
          <div className="p-3.5 bg-rose-50 border border-rose-200 text-rose-700 rounded-2xl text-xs flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {success ? (
          <div className="p-6 text-center space-y-2">
            <CheckCircle className="w-10 h-10 mx-auto text-neutral-900" />
            <p className="font-bold text-base text-neutral-900">Report Submitted</p>
            <p className="text-xs text-neutral-500">
              Thank you for keeping BorrowLoop safe. Our customer care team will review this case.
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4 text-xs">
            <div>
              <label className="block font-bold text-neutral-700 mb-1.5">Reason for Report:</label>
              <select
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="w-full border border-neutral-200 rounded-2xl px-3.5 py-3 bg-neutral-50 text-xs font-semibold text-neutral-900 outline-none focus:bg-white focus:border-black"
              >
                {reasons.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block font-bold text-neutral-700 mb-1.5">
                Details (optional, max 1000 characters):
              </label>
              <textarea
                rows={3}
                maxLength={1000}
                value={details}
                onChange={(e) => setDetails(e.target.value)}
                placeholder="Describe what occurred or why this content violates community guidelines..."
                className="w-full border border-neutral-200 rounded-2xl p-3.5 text-xs bg-neutral-50 text-neutral-900 outline-none focus:bg-white focus:border-black resize-none"
              />
              <span className="block text-right text-[10px] text-neutral-400 mt-1">
                {details.length} / 1000
              </span>
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-neutral-100">
              <button
                type="button"
                onClick={onClose}
                className="px-5 py-2.5 rounded-full text-xs font-bold text-neutral-600 hover:bg-neutral-100 transition"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading}
                className="px-6 py-2.5 bg-black hover:bg-neutral-800 text-white rounded-full text-xs font-bold transition disabled:opacity-50 flex items-center gap-1.5 cursor-pointer shadow-xs"
              >
                {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>Submit Report</span>
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

export default ReportModal;
