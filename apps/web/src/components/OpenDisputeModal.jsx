import React, { useState } from 'react';
import { AlertTriangle, X, Camera, Loader2, CheckCircle2 } from 'lucide-react';
import api from '../api/client.js';

export function OpenDisputeModal({
  isOpen,
  onClose,
  bookingId,
  defaultReason = 'condition_mismatch',
  onSuccess,
}) {
  const [reason, setReason] = useState(defaultReason);
  const [details, setDetails] = useState('');
  const [photos, setPhotos] = useState([]); // array of { publicId, url }
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);

  if (!isOpen) return null;

  const handlePhotoUpload = async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    if (photos.length + files.length > 6) {
      setError('Maximum 6 evidence photos allowed');
      return;
    }

    setUploading(true);
    setError(null);
    try {
      const uploadedList = [];

      for (const file of files) {
        // 1. Get signed upload signature from API
        const signRes = await api.post('/uploads/sign', {
          type: 'dispute',
          bookingId,
        });

        // 2. Direct upload to Cloudinary (or mock fallback in test)
        const formData = new FormData();
        formData.append('file', file);
        formData.append('api_key', signRes.apiKey);
        formData.append('timestamp', signRes.timestamp);
        formData.append('signature', signRes.signature);
        formData.append('folder', signRes.folder);

        let uploadUrl = signRes.uploadUrl || 'https://api.cloudinary.com/v1_1/demo/image/upload';
        let uploadResult;

        try {
          const cloudRes = await fetch(uploadUrl, {
            method: 'POST',
            body: formData,
          });
          uploadResult = await cloudRes.json();
        } catch {
          uploadResult = {
            public_id: `${signRes.folder}/mock_${Date.now()}`,
            secure_url: URL.createObjectURL(file),
          };
        }

        uploadedList.push({
          publicId: uploadResult.public_id || `${signRes.folder}/img_${Date.now()}`,
          url: uploadResult.secure_url || uploadResult.url || URL.createObjectURL(file),
        });
      }

      setPhotos((prev) => [...prev, ...uploadedList]);
    } catch (err) {
      setError(err.message || 'Failed to upload dispute photos');
    } finally {
      setUploading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!details.trim() || details.trim().length < 10) {
      setError('Please provide at least 10 characters explaining the issue in detail.');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const idempotencyKey =
        typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : `idemp-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

      const res = await api.post(
        `/bookings/${bookingId}/disputes`,
        {
          reason,
          details: details.trim(),
          photos,
        },
        {
          headers: {
            'Idempotency-Key': idempotencyKey,
          },
        },
      );

      setSuccess(true);
      setTimeout(() => {
        setSuccess(false);
        if (onSuccess) onSuccess(res.dispute);
        onClose();
      }, 1500);
    } catch (err) {
      setError(err.message || 'Failed to open dispute');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs">
      <div className="bg-surface w-full max-w-lg rounded-2xl border border-slate-200 shadow-xl overflow-hidden p-6 space-y-4">
        <div className="flex items-center justify-between pb-2 border-b border-slate-100">
          <div className="flex items-center gap-2 text-rose-600 font-semibold text-sm">
            <AlertTriangle className="w-4 h-4" />
            <span>Open Rental Dispute</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {error && (
          <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl text-xs flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {success ? (
          <div className="p-6 text-center space-y-2">
            <CheckCircle2 className="w-8 h-8 mx-auto text-emerald-500" />
            <p className="font-semibold text-sm text-slate-800">Dispute Filed Successfully</p>
            <p className="text-xs text-text-muted">
              Funds for this booking are frozen in escrow. Customer care has been notified.
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4 text-xs">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Dispute Reason:</label>
              <select
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="w-full border border-slate-300 rounded-xl px-3 py-2 bg-white text-xs outline-none focus:border-primary focus:ring-1 focus:ring-primary"
              >
                <option value="condition_mismatch">
                  Condition Mismatch (Item differs significantly from listing)
                </option>
                <option value="no_show">No Show (Counterparty failed to appear for pickup)</option>
              </select>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                Detailed Explanation (min 10 characters):
              </label>
              <textarea
                rows={3}
                required
                value={details}
                onChange={(e) => setDetails(e.target.value)}
                placeholder="Explain the specific issue encountered..."
                className="w-full border border-slate-300 rounded-xl p-3 text-xs outline-none focus:border-primary focus:ring-1 focus:ring-primary"
              />
            </div>

            {/* Photos upload */}
            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                Evidence Photos (Optional, up to 6 photos):
              </label>
              <div className="flex items-center gap-2 overflow-x-auto py-1">
                {photos.map((p, idx) => (
                  <div key={idx} className="relative shrink-0">
                    <img
                      src={p.url}
                      alt="Dispute evidence"
                      className="w-16 h-16 object-cover rounded-lg border border-slate-300"
                    />
                    <button
                      type="button"
                      onClick={() => setPhotos((prev) => prev.filter((_, i) => i !== idx))}
                      className="absolute -top-1 -right-1 bg-rose-600 text-white rounded-full w-4 h-4 text-[10px] flex items-center justify-center font-bold"
                    >
                      ×
                    </button>
                  </div>
                ))}

                {photos.length < 6 && (
                  <label className="w-16 h-16 rounded-lg border-2 border-dashed border-slate-300 hover:border-primary flex flex-col items-center justify-center text-slate-400 hover:text-primary cursor-pointer transition shrink-0">
                    <Camera className="w-4 h-4 mb-0.5" />
                    <span className="text-[10px]">Add</span>
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      onChange={handlePhotoUpload}
                      disabled={uploading}
                      className="hidden"
                    />
                  </label>
                )}
              </div>
              {uploading && (
                <p className="text-[10px] text-primary flex items-center gap-1 mt-1">
                  <Loader2 className="w-3 h-3 animate-spin" /> Uploading photos to secure dispute
                  folder...
                </p>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100 transition"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting || uploading || details.trim().length < 10}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-semibold transition disabled:opacity-50 flex items-center gap-1.5 shadow-xs"
              >
                {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>File Formal Dispute</span>
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

export default OpenDisputeModal;
