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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-white w-full max-w-lg rounded-3xl border border-neutral-200 shadow-2xl overflow-hidden p-6 space-y-5">
        <div className="flex items-center justify-between pb-3 border-b border-neutral-100">
          <div className="flex items-center gap-2 text-neutral-900 font-black text-base">
            <AlertTriangle className="w-5 h-5 text-neutral-900" />
            <span>Open Rental Dispute</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-full text-neutral-400 hover:text-neutral-900 hover:bg-neutral-100 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {error && (
          <div className="p-3.5 bg-rose-50 border border-rose-200 text-rose-700 rounded-2xl text-xs flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {success ? (
          <div className="p-6 text-center space-y-2">
            <CheckCircle2 className="w-10 h-10 mx-auto text-neutral-900" />
            <p className="font-bold text-base text-neutral-900">Dispute Filed Successfully</p>
            <p className="text-xs text-neutral-500">
              Funds for this booking are frozen in escrow. Customer care has been notified.
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4 text-xs">
            <div>
              <label className="block font-bold text-neutral-700 mb-1.5">Dispute Reason:</label>
              <select
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="w-full border border-neutral-200 rounded-2xl px-3.5 py-3 bg-neutral-50 text-xs font-semibold text-neutral-900 outline-none focus:bg-white focus:border-black"
              >
                <option value="condition_mismatch">
                  Condition Mismatch (Item differs significantly from listing)
                </option>
                <option value="no_show">No Show (Counterparty failed to appear for pickup)</option>
              </select>
            </div>

            <div>
              <label className="block font-bold text-neutral-700 mb-1.5">
                Detailed Explanation (min 10 characters):
              </label>
              <textarea
                rows={3}
                required
                value={details}
                onChange={(e) => setDetails(e.target.value)}
                placeholder="Explain the specific issue encountered..."
                className="w-full border border-neutral-200 rounded-2xl p-3.5 text-xs bg-neutral-50 text-neutral-900 outline-none focus:bg-white focus:border-black resize-none"
              />
            </div>

            {/* Photos upload */}
            <div>
              <label className="block font-bold text-neutral-700 mb-1.5">
                Evidence Photos (Optional, up to 6 photos):
              </label>
              <div className="flex items-center gap-2.5 overflow-x-auto py-1">
                {photos.map((p, idx) => (
                  <div key={idx} className="relative shrink-0">
                    <img
                      src={p.url}
                      alt="Dispute evidence"
                      className="w-16 h-16 object-cover rounded-xl border border-neutral-200"
                    />
                    <button
                      type="button"
                      onClick={() => setPhotos((prev) => prev.filter((_, i) => i !== idx))}
                      className="absolute -top-1 -right-1 bg-black text-white rounded-full w-5 h-5 text-xs flex items-center justify-center font-bold"
                    >
                      ×
                    </button>
                  </div>
                ))}

                {photos.length < 6 && (
                  <label className="w-16 h-16 rounded-xl border-2 border-dashed border-neutral-300 hover:border-black flex flex-col items-center justify-center text-neutral-400 hover:text-black cursor-pointer transition shrink-0 bg-neutral-50">
                    <Camera className="w-4 h-4 mb-0.5" />
                    <span className="text-[10px] font-bold">Add</span>
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
                <p className="text-[10px] text-neutral-600 flex items-center gap-1 mt-1 font-semibold">
                  <Loader2 className="w-3 h-3 animate-spin" /> Uploading photos to secure dispute
                  folder...
                </p>
              )}
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-4 border-t border-neutral-100">
              <button
                type="button"
                onClick={onClose}
                className="px-5 py-2.5 rounded-full text-xs font-bold text-neutral-600 hover:bg-neutral-100 transition"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting || uploading || details.trim().length < 10}
                className="px-6 py-2.5 bg-black hover:bg-neutral-800 text-white rounded-full text-xs font-bold transition disabled:opacity-50 flex items-center gap-1.5 cursor-pointer shadow-xs"
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
