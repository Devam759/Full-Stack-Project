import React, { useState, useEffect, useCallback } from 'react';
import {
  ArrowLeft,
  Scale,
  AlertTriangle,
  CheckCircle2,
  Camera,
  Loader2,
  Shield,
  HelpCircle,
} from 'lucide-react';
import { formatPaise } from '@borrowloop/shared';
import api from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';

export function DisputeDetailScreen({ bookingId, disputeId: propDisputeId, onBack }) {
  const { user } = useAuth();
  const [dispute, setDispute] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [actionSuccess, setActionSuccess] = useState(null);

  // Evidence submission state
  const [evidenceNotes, setEvidenceNotes] = useState('');
  const [evidencePhotos, setEvidencePhotos] = useState([]);
  const [uploadingEvidence, setUploadingEvidence] = useState(false);
  const [submittingEvidence, setSubmittingEvidence] = useState(false);

  // Appeal modal state
  const [showAppealModal, setShowAppealModal] = useState(false);
  const [appealReason, setAppealReason] = useState('');
  const [submittingAppeal, setSubmittingAppeal] = useState(false);

  const fetchDispute = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      let res;
      if (propDisputeId) {
        res = await api.get(`/disputes/${propDisputeId}`);
      } else if (bookingId) {
        res = await api.get(`/bookings/${bookingId}/dispute`);
      } else {
        throw new Error('No dispute or booking identifier provided');
      }
      setDispute(res.dispute);
    } catch (err) {
      setError(err.message || 'Failed to load dispute details');
    } finally {
      setLoading(false);
    }
  }, [bookingId, propDisputeId]);

  useEffect(() => {
    fetchDispute();
  }, [fetchDispute]);

  // Handle uploading supplemental evidence photos
  const handleEvidencePhotoUpload = async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    if (evidencePhotos.length + files.length > 6) {
      setError('Maximum 6 evidence photos per upload entry');
      return;
    }

    setUploadingEvidence(true);
    setError(null);
    try {
      const uploadedList = [];

      for (const file of files) {
        const signRes = await api.post('/uploads/sign', {
          type: 'dispute',
          bookingId: dispute?.bookingId,
        });

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

      setEvidencePhotos((prev) => [...prev, ...uploadedList]);
    } catch (err) {
      setError(err.message || 'Evidence photo upload failed');
    } finally {
      setUploadingEvidence(false);
    }
  };

  const handleAddEvidence = async (e) => {
    e.preventDefault();
    if (!evidenceNotes.trim() && evidencePhotos.length === 0) {
      setError('Please provide notes or at least one photo as evidence.');
      return;
    }

    setSubmittingEvidence(true);
    setError(null);
    try {
      await api.post(`/disputes/${dispute._id}/evidence`, {
        notes: evidenceNotes.trim(),
        photos: evidencePhotos,
      });

      setActionSuccess('Evidence uploaded successfully.');
      setEvidenceNotes('');
      setEvidencePhotos([]);
      await fetchDispute();
    } catch (err) {
      setError(err.message || 'Failed to submit evidence');
    } finally {
      setSubmittingEvidence(false);
    }
  };

  const handleAppealSubmit = async (e) => {
    e.preventDefault();
    if (appealReason.trim().length < 20) {
      setError('Appeal reason must be at least 20 characters long.');
      return;
    }

    setSubmittingAppeal(true);
    setError(null);
    try {
      await api.post(`/disputes/${dispute._id}/appeal`, {
        reason: appealReason.trim(),
      });

      setActionSuccess('Appeal submitted successfully and marked pending review.');
      setShowAppealModal(false);
      setAppealReason('');
      await fetchDispute();
    } catch (err) {
      setError(err.message || 'Appeal submission failed');
    } finally {
      setSubmittingAppeal(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center p-16 text-neutral-500">
        <Loader2 className="w-8 h-8 animate-spin text-black mb-3" />
        <p className="text-sm font-bold text-neutral-800">Loading dispute details...</p>
      </div>
    );
  }

  if (!dispute) {
    return (
      <div className="p-8 text-center space-y-4 max-w-md mx-auto">
        <p className="text-rose-600 font-bold text-sm">Dispute record not found.</p>
        <button
          type="button"
          onClick={onBack}
          className="px-5 py-2.5 bg-neutral-100 rounded-full text-xs font-bold text-neutral-800 hover:bg-neutral-200 transition"
        >
          Back
        </button>
      </div>
    );
  }

  const isDecided =
    dispute.status === 'decided' || dispute.status === 'appealed' || dispute.status === 'closed';
  const hasAppealed = dispute.appeal && dispute.appeal.appealedAt;

  // Check 7-day appeal eligibility window
  let canAppeal = false;
  if (isDecided && !hasAppealed) {
    const decidedAt = dispute.decision?.decidedAt
      ? new Date(dispute.decision.decidedAt).getTime()
      : 0;
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    canAppeal = Date.now() - decidedAt <= sevenDaysMs;
  }

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-2xl mx-auto pb-24">
      {/* Top Header */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-2 text-xs font-bold text-neutral-600 hover:text-black transition"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back</span>
        </button>
        <span className="text-xs font-bold px-3 py-1 rounded-full bg-amber-400 text-black shadow-xs">
          Demo money
        </span>
      </div>

      {error && (
        <div className="p-4 bg-rose-50 border border-rose-200 text-rose-700 rounded-2xl text-xs flex items-center gap-2 font-medium">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {actionSuccess && (
        <div className="p-4 bg-neutral-900 text-white rounded-2xl text-xs flex items-center gap-2.5 font-semibold">
          <CheckCircle2 className="w-5 h-5 shrink-0 text-emerald-400" />
          <span>{actionSuccess}</span>
        </div>
      )}

      {/* Main Dispute Status Banner */}
      <div className="bg-white rounded-3xl border border-neutral-200 p-6 shadow-xs space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2.5">
            <Scale className="w-5 h-5 text-neutral-900" />
            <h2 className="font-heading font-black text-xl text-neutral-900 tracking-tight">
              Rental Dispute
            </h2>
          </div>
          <span
            className={`text-xs px-3 py-1 rounded-full font-bold uppercase tracking-wider ${
              dispute.status === 'opened'
                ? 'bg-amber-100 text-amber-900'
                : dispute.status === 'assigned'
                  ? 'bg-neutral-100 text-neutral-900'
                  : dispute.status === 'decided'
                    ? 'bg-black text-white'
                    : dispute.status === 'appealed'
                      ? 'bg-neutral-900 text-white'
                      : 'bg-neutral-100 text-neutral-700'
            }`}
          >
            {dispute.status.toUpperCase()}
          </span>
        </div>

        <div className="text-xs text-neutral-500 font-medium space-y-1 pt-1 border-t border-neutral-100">
          <p>
            Reason:{' '}
            <strong className="text-neutral-900 uppercase">
              {dispute.disputeReason.replace('_', ' ')}
            </strong>
          </p>
          <p>Opened on: {new Date(dispute.createdAt).toLocaleString()}</p>
          <p>Booking ID: #{dispute.bookingId}</p>
        </div>
      </div>

      {/* Decision Summary Card (Visible once decided) */}
      {isDecided && dispute.decision && (
        <div className="bg-neutral-50 rounded-3xl border border-neutral-200 p-6 shadow-xs space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-base text-neutral-900 flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-neutral-900" /> Care Resolution Decision
            </h3>
            <span className="text-xs font-semibold text-neutral-500">
              {new Date(dispute.decision.decidedAt).toLocaleDateString()}
            </span>
          </div>

          {/* Public Decision Note (Never internalNote) */}
          <div className="p-4 bg-white rounded-2xl border border-neutral-200 text-xs space-y-1">
            <span className="font-bold text-neutral-700 block">Care Agent Finding:</span>
            <p className="text-neutral-900 font-medium whitespace-pre-wrap">
              {dispute.decision.note}
            </p>
          </div>

          {/* Settlement Breakdown Table */}
          <div className="p-4 bg-white rounded-2xl border border-neutral-200 text-xs space-y-2">
            <span className="font-bold text-neutral-700 block">Settlement Payouts & Refunds:</span>
            <div className="space-y-1.5 text-neutral-600 font-medium">
              <div className="flex justify-between">
                <span>Deposit to Borrower:</span>
                <span className="font-bold text-neutral-900">
                  {formatPaise(dispute.decision.depositToBorrowerPaise || 0, { showDemoTag: true })}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Deposit Compensation to Lender:</span>
                <span className="font-bold text-neutral-900">
                  {formatPaise(dispute.decision.depositToLenderPaise || 0, { showDemoTag: true })}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Rent Outcome:</span>
                <span className="font-bold text-neutral-900">
                  {dispute.decision.rentOutcome === 'lender'
                    ? 'Earned by Lender'
                    : 'Refunded to Borrower'}
                </span>
              </div>
            </div>
          </div>

          {/* Appeal Status / Button */}
          {hasAppealed ? (
            <div className="p-4 bg-white rounded-2xl border border-neutral-200 text-xs text-neutral-900 flex items-center gap-2 font-medium">
              <Shield className="w-4 h-4 shrink-0 text-neutral-900" />
              <span>
                An appeal was filed on {new Date(dispute.appeal.appealedAt).toLocaleDateString()}{' '}
                (Status:{' '}
                <strong className="font-bold">{dispute.appeal.status.toUpperCase()}</strong>).
              </span>
            </div>
          ) : canAppeal ? (
            <div className="pt-2">
              <button
                type="button"
                onClick={() => setShowAppealModal(true)}
                className="w-full py-3.5 bg-black hover:bg-neutral-800 text-white font-bold rounded-full text-xs transition shadow-xs flex items-center justify-center gap-2 cursor-pointer"
              >
                <HelpCircle className="w-4 h-4" />
                <span>Appeal This Decision (7-day window open)</span>
              </button>
            </div>
          ) : null}
        </div>
      )}

      {/* Evidence Gallery */}
      <div className="bg-white rounded-3xl border border-neutral-200 p-6 shadow-xs space-y-4">
        <h3 className="font-bold text-base text-neutral-900 flex items-center gap-2">
          <Camera className="w-4 h-4 text-neutral-900" /> Dispute Evidence Timeline
        </h3>

        {(dispute.evidence || []).length === 0 ? (
          <p className="text-xs text-neutral-500 italic">
            No evidence photos or notes submitted yet.
          </p>
        ) : (
          <div className="space-y-3">
            {dispute.evidence.map((ev, i) => (
              <div
                key={i}
                className="p-4 rounded-2xl border border-neutral-100 bg-neutral-50 text-xs space-y-2"
              >
                <div className="flex items-center justify-between text-neutral-500 font-semibold text-[11px]">
                  <span>Submitted by {ev.by === user?.id ? 'You' : 'Counterparty'}</span>
                  <span>{new Date(ev.createdAt).toLocaleString()}</span>
                </div>
                {ev.notes && <p className="text-neutral-900 font-medium">{ev.notes}</p>}
                {(ev.photos || []).length > 0 && (
                  <div className="flex gap-2.5 overflow-x-auto py-1">
                    {ev.photos.map((p, idx) => (
                      <img
                        key={idx}
                        src={p.url || p}
                        alt="Dispute evidence"
                        className="w-16 h-16 object-cover rounded-xl border border-neutral-200 shrink-0"
                      />
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Add Evidence Form (Available before decision) */}
        {!isDecided && (
          <form
            onSubmit={handleAddEvidence}
            className="pt-4 border-t border-neutral-100 space-y-3 text-xs"
          >
            <span className="font-bold text-neutral-900 block">Add Supplemental Evidence:</span>
            <textarea
              rows={2}
              value={evidenceNotes}
              onChange={(e) => setEvidenceNotes(e.target.value)}
              placeholder="Describe what occurred or attach supporting photographs..."
              className="w-full border border-neutral-200 rounded-2xl bg-neutral-50 p-3.5 outline-none focus:bg-white focus:border-black font-medium resize-none"
            />

            <div className="flex items-center gap-2.5 overflow-x-auto">
              {evidencePhotos.map((p, idx) => (
                <div key={idx} className="relative shrink-0">
                  <img
                    src={p.url}
                    alt="Supplemental photo"
                    className="w-16 h-16 object-cover rounded-xl border border-neutral-200"
                  />
                  <button
                    type="button"
                    onClick={() => setEvidencePhotos((prev) => prev.filter((_, i) => i !== idx))}
                    className="absolute -top-1 -right-1 bg-black text-white rounded-full w-5 h-5 text-[10px] flex items-center justify-center font-bold"
                  >
                    ×
                  </button>
                </div>
              ))}

              {evidencePhotos.length < 6 && (
                <label className="w-16 h-16 rounded-xl border-2 border-dashed border-neutral-300 hover:border-black flex flex-col items-center justify-center text-neutral-400 hover:text-black cursor-pointer transition shrink-0 bg-neutral-50">
                  <Camera className="w-4 h-4 mb-0.5" />
                  <span className="text-[10px] font-bold">Photo</span>
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={handleEvidencePhotoUpload}
                    disabled={uploadingEvidence}
                    className="hidden"
                  />
                </label>
              )}
            </div>

            <button
              type="submit"
              disabled={
                submittingEvidence ||
                uploadingEvidence ||
                (!evidenceNotes.trim() && evidencePhotos.length === 0)
              }
              className="w-full py-3.5 bg-black hover:bg-neutral-800 text-white font-bold rounded-full text-xs transition disabled:opacity-50 flex items-center justify-center gap-2 shadow-xs cursor-pointer"
            >
              {submittingEvidence && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              <span>Submit Evidence</span>
            </button>
          </form>
        )}
      </div>

      {/* Appeal Submission Modal */}
      {showAppealModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-white w-full max-w-md rounded-3xl border border-neutral-200 shadow-2xl overflow-hidden p-6 space-y-4">
            <h3 className="font-black text-base text-neutral-900">Appeal Case Resolution</h3>
            <p className="text-xs text-neutral-500 font-medium">
              Submit your formal justification for appealing this decision. An administrator will
              review your case.
            </p>

            <form onSubmit={handleAppealSubmit} className="space-y-4 text-xs">
              <div>
                <label className="block font-bold text-neutral-700 mb-1.5">
                  Reason for Appeal (min 20 characters):
                </label>
                <textarea
                  rows={4}
                  required
                  value={appealReason}
                  onChange={(e) => setAppealReason(e.target.value)}
                  placeholder="Explain why this decision should be reviewed and provide any additional context..."
                  className="w-full border border-neutral-200 rounded-2xl bg-neutral-50 p-3.5 outline-none focus:bg-white focus:border-black font-medium resize-none"
                />
                <span className="block text-right text-[10px] text-neutral-400 mt-1 font-semibold">
                  {appealReason.trim().length} / 20 min characters
                </span>
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-neutral-100">
                <button
                  type="button"
                  onClick={() => setShowAppealModal(false)}
                  className="px-5 py-2.5 rounded-full text-xs font-bold text-neutral-600 hover:bg-neutral-100 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingAppeal || appealReason.trim().length < 20}
                  className="px-6 py-2.5 bg-black hover:bg-neutral-800 text-white rounded-full text-xs font-bold transition disabled:opacity-50 flex items-center gap-1.5 cursor-pointer shadow-xs"
                >
                  {submittingAppeal && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>Submit Appeal</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default DisputeDetailScreen;
