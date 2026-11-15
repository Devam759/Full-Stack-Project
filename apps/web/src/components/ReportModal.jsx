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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs">
      <div className="bg-surface w-full max-w-md rounded-2xl border border-slate-200 shadow-xl overflow-hidden p-5 space-y-4">
        <div className="flex items-center justify-between pb-2 border-b border-slate-100">
          <div className="flex items-center gap-2 text-rose-600 font-semibold text-sm">
            <Flag className="w-4 h-4" />
            <span>Report {targetType ? targetType.toUpperCase() : 'CONTENT'}</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {targetTitle && (
          <p className="text-xs text-text-muted">
            Reporting: <span className="font-semibold text-slate-800">{targetTitle}</span>
          </p>
        )}

        {error && (
          <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl text-xs flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {success ? (
          <div className="p-6 text-center space-y-2">
            <CheckCircle className="w-8 h-8 mx-auto text-emerald-500" />
            <p className="font-semibold text-sm text-slate-800">Report Submitted</p>
            <p className="text-xs text-text-muted">
              Thank you for keeping BorrowLoop safe. Our customer care team will review this case.
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4 text-xs">
            <div>
              <label className="block font-semibold text-slate-700 mb-1.5">
                Reason for Report:
              </label>
              <select
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="w-full border border-slate-300 rounded-xl px-3 py-2 bg-white text-xs outline-none focus:border-primary focus:ring-1 focus:ring-primary"
              >
                {reasons.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1.5">
                Details (optional, max 1000 characters):
              </label>
              <textarea
                rows={3}
                maxLength={1000}
                value={details}
                onChange={(e) => setDetails(e.target.value)}
                placeholder="Describe what occurred or why this content violates community guidelines..."
                className="w-full border border-slate-300 rounded-xl p-3 text-xs outline-none focus:border-primary focus:ring-1 focus:ring-primary"
              />
              <span className="block text-right text-[10px] text-text-muted mt-1">
                {details.length} / 1000
              </span>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100 transition"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-semibold transition disabled:opacity-50 flex items-center gap-1.5 shadow-xs"
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
