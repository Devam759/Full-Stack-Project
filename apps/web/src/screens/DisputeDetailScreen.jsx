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
      <div className="flex flex-col items-center justify-center p-12 text-text-muted">
        <Loader2 className="w-8 h-8 animate-spin text-primary mb-3" />
        <p className="text-sm font-medium">Loading dispute details...</p>
      </div>
    );
  }

  if (!dispute) {
    return (
      <div className="p-6 text-center space-y-4">
        <p className="text-rose-600 font-medium text-sm">Dispute record not found.</p>
        <button
          type="button"
          onClick={onBack}
          className="px-4 py-2 bg-slate-100 rounded-xl text-xs font-semibold hover:bg-slate-200"
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
    <div className="p-4 space-y-5 max-w-lg mx-auto">
      {/* Top Header */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1.5 text-xs font-semibold text-text-muted hover:text-text transition"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back</span>
        </button>
        <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-300">
          Demo money
        </span>
      </div>

      {error && (
        <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl text-xs flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {actionSuccess && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl text-xs flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{actionSuccess}</span>
        </div>
      )}

      {/* Main Dispute Status Banner */}
      <div className="bg-surface rounded-2xl border border-slate-200 p-5 shadow-xs space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <Scale className="w-5 h-5 text-primary" />
            <h2 className="font-bold text-base text-slate-900">Rental Dispute</h2>
          </div>
          <span
            className={`text-xs px-2.5 py-0.5 rounded-full font-bold ${
              dispute.status === 'opened'
                ? 'bg-amber-100 text-amber-800'
                : dispute.status === 'assigned'
                  ? 'bg-blue-100 text-blue-800'
                  : dispute.status === 'decided'
                    ? 'bg-emerald-100 text-emerald-800'
                    : dispute.status === 'appealed'
                      ? 'bg-purple-100 text-purple-800'
                      : 'bg-slate-200 text-slate-800'
            }`}
          >
            {dispute.status.toUpperCase()}
          </span>
        </div>

        <div className="text-xs text-text-muted space-y-1">
          <p>
            Reason:{' '}
            <strong className="text-slate-800 uppercase">
              {dispute.disputeReason.replace('_', ' ')}
            </strong>
          </p>
          <p>Opened on: {new Date(dispute.createdAt).toLocaleString()}</p>
          <p>Booking ID: #{dispute.bookingId}</p>
        </div>
      </div>

      {/* Decision Summary Card (Visible once decided) */}
      {isDecided && dispute.decision && (
        <div className="bg-emerald-50/60 rounded-2xl border border-emerald-200 p-5 shadow-xs space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-sm text-emerald-950 flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-600" /> Care Resolution Decision
            </h3>
            <span className="text-[11px] text-emerald-800">
              {new Date(dispute.decision.decidedAt).toLocaleDateString()}
            </span>
          </div>

          {/* Public Decision Note (Never internalNote) */}
          <div className="p-3 bg-white rounded-xl border border-emerald-100 text-xs space-y-1">
            <span className="font-semibold text-slate-700 block">Care Agent Finding:</span>
            <p className="text-slate-800 whitespace-pre-wrap">{dispute.decision.note}</p>
          </div>

          {/* Settlement Breakdown Table */}
          <div className="p-3 bg-white rounded-xl border border-emerald-100 text-xs space-y-2">
            <span className="font-semibold text-slate-700 block">
              Settlement Payouts & Refunds:
            </span>
            <div className="space-y-1 text-text-muted">
              <div className="flex justify-between">
                <span>Deposit to Borrower:</span>
                <span className="font-bold text-slate-900">
                  {formatPaise(dispute.decision.depositToBorrowerPaise || 0, { showDemoTag: true })}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Deposit Compensation to Lender:</span>
                <span className="font-bold text-slate-900">
                  {formatPaise(dispute.decision.depositToLenderPaise || 0, { showDemoTag: true })}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Rent Outcome:</span>
                <span className="font-bold text-slate-900">
                  {dispute.decision.rentOutcome === 'lender'
                    ? 'Earned by Lender'
                    : 'Refunded to Borrower'}
                </span>
              </div>
            </div>
          </div>

          {/* Appeal Status / Button */}
          {hasAppealed ? (
            <div className="p-3 bg-purple-50 rounded-xl border border-purple-200 text-xs text-purple-900 flex items-center gap-2">
              <Shield className="w-4 h-4 shrink-0" />
              <span>
                An appeal was filed on {new Date(dispute.appeal.appealedAt).toLocaleDateString()}{' '}
                (Status: <strong>{dispute.appeal.status.toUpperCase()}</strong>).
              </span>
            </div>
          ) : canAppeal ? (
            <div className="pt-2">
              <button
                type="button"
                onClick={() => setShowAppealModal(true)}
                className="w-full py-2.5 bg-purple-600 hover:bg-purple-700 text-white font-semibold rounded-xl text-xs transition shadow-xs flex items-center justify-center gap-1.5"
              >
                <HelpCircle className="w-4 h-4" />
                <span>Appeal This Decision (7-day window open)</span>
              </button>
            </div>
          ) : null}
        </div>
      )}

      {/* Evidence Gallery */}
      <div className="bg-surface rounded-2xl border border-slate-200 p-5 shadow-xs space-y-4">
        <h3 className="font-bold text-sm text-slate-900 flex items-center gap-1.5">
          <Camera className="w-4 h-4 text-primary" /> Dispute Evidence Timeline
        </h3>

        {(dispute.evidence || []).length === 0 ? (
          <p className="text-xs text-text-muted italic">
            No evidence photos or notes submitted yet.
          </p>
        ) : (
          <div className="space-y-3">
            {dispute.evidence.map((ev, i) => (
              <div
                key={i}
                className="p-3 rounded-xl border border-slate-100 bg-slate-50 text-xs space-y-2"
              >
                <div className="flex items-center justify-between text-text-muted text-[11px]">
                  <span>Submitted by {ev.by === user?.id ? 'You' : 'Counterparty'}</span>
                  <span>{new Date(ev.createdAt).toLocaleString()}</span>
                </div>
                {ev.notes && <p className="text-slate-800">{ev.notes}</p>}
                {(ev.photos || []).length > 0 && (
                  <div className="flex gap-2 overflow-x-auto py-1">
                    {ev.photos.map((p, idx) => (
                      <img
                        key={idx}
                        src={p.url || p}
                        alt="Dispute evidence"
                        className="w-16 h-16 object-cover rounded-lg border border-slate-200 shrink-0"
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
            className="pt-3 border-t border-slate-100 space-y-3 text-xs"
          >
            <span className="font-semibold text-slate-800 block">Add Supplemental Evidence:</span>
            <textarea
              rows={2}
              value={evidenceNotes}
              onChange={(e) => setEvidenceNotes(e.target.value)}
              placeholder="Describe what occurred or attach supporting photographs..."
              className="w-full border border-slate-300 rounded-xl p-3 outline-none focus:border-primary focus:ring-1 focus:ring-primary"
            />

            <div className="flex items-center gap-2 overflow-x-auto">
              {evidencePhotos.map((p, idx) => (
                <div key={idx} className="relative shrink-0">
                  <img
                    src={p.url}
                    alt="Supplemental photo"
                    className="w-14 h-14 object-cover rounded-lg border border-slate-200"
                  />
                  <button
                    type="button"
                    onClick={() => setEvidencePhotos((prev) => prev.filter((_, i) => i !== idx))}
                    className="absolute -top-1 -right-1 bg-rose-600 text-white rounded-full w-4 h-4 text-[10px] flex items-center justify-center font-bold"
                  >
                    ×
                  </button>
                </div>
              ))}

              {evidencePhotos.length < 6 && (
                <label className="w-14 h-14 rounded-lg border-2 border-dashed border-slate-300 hover:border-primary flex flex-col items-center justify-center text-slate-400 hover:text-primary cursor-pointer transition shrink-0">
                  <Camera className="w-4 h-4 mb-0.5" />
                  <span className="text-[10px]">Photo</span>
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
              className="w-full py-2.5 bg-primary text-white font-semibold rounded-xl text-xs hover:bg-primary-dark transition disabled:opacity-50 flex items-center justify-center gap-1.5 shadow-xs"
            >
              {submittingEvidence && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              <span>Submit Evidence</span>
            </button>
          </form>
        )}
      </div>

      {/* Appeal Submission Modal */}
      {showAppealModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs">
          <div className="bg-surface w-full max-w-md rounded-2xl border border-slate-200 shadow-xl overflow-hidden p-5 space-y-4">
            <h3 className="font-bold text-sm text-slate-900">Appeal Case Resolution</h3>
            <p className="text-xs text-text-muted">
              Submit your formal justification for appealing this decision. An administrator will
              review your case.
            </p>

            <form onSubmit={handleAppealSubmit} className="space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Reason for Appeal (min 20 characters):
                </label>
                <textarea
                  rows={4}
                  required
                  value={appealReason}
                  onChange={(e) => setAppealReason(e.target.value)}
                  placeholder="Explain why this decision should be reviewed and provide any additional context..."
                  className="w-full border border-slate-300 rounded-xl p-3 outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                />
                <span className="block text-right text-[10px] text-text-muted mt-1">
                  {appealReason.trim().length} / 20 min characters
                </span>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowAppealModal(false)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingAppeal || appealReason.trim().length < 20}
                  className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-xs font-semibold transition disabled:opacity-50 flex items-center gap-1.5 shadow-xs"
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
