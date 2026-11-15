import React, { useState, useEffect, useCallback } from 'react';
import {
  AlertTriangle,
  CheckCircle,
  EyeOff,
  Trash2,
  RotateCcw,
  AlertOctagon,
  RefreshCw,
  User,
  Package,
  MessageSquare,
} from 'lucide-react';
import { formatPaise } from '@borrowloop/shared';

export function ModerationQueue({ token }) {
  const [targetType, setTargetType] = useState('item'); // 'item' | 'user' | 'message'
  const [statusFilter, setStatusFilter] = useState('pending'); // 'pending' | 'reviewed'
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Action Modal State
  const [selectedReport, setSelectedReport] = useState(null);
  const [selectedAction, setSelectedAction] = useState('');
  const [actionNote, setActionNote] = useState('');
  const [submittingAction, setSubmittingAction] = useState(false);

  const fetchReports = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      params.append('targetType', targetType);
      params.append('status', statusFilter);
      params.append('limit', '50');

      const res = await fetch(`/v1/care/reports?${params.toString()}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.message || data?.error?.message || 'Failed to fetch reports');
      }

      setReports(data.reports || []);
    } catch (err) {
      setError(err.message || 'Error fetching moderation queue');
    } finally {
      setLoading(false);
    }
  }, [targetType, statusFilter, token]);

  useEffect(() => {
    fetchReports();
  }, [fetchReports]);

  const handleOpenActionModal = (report, action) => {
    setSelectedReport(report);
    setSelectedAction(action);
    setActionNote('');
    setError('');
    setSuccessMsg('');
  };

  const handleExecuteAction = async (e) => {
    e.preventDefault();
    if (!actionNote.trim()) {
      setError('An action note is required for audit trail.');
      return;
    }

    setSubmittingAction(true);
    setError('');
    try {
      const res = await fetch(`/v1/care/reports/${selectedReport._id}/action`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: selectedAction,
          actionNote: actionNote.trim(),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(
          data?.message || data?.error?.message || 'Failed to execute moderation action',
        );
      }

      setSuccessMsg(`Action "${selectedAction}" executed successfully.`);
      setSelectedReport(null);
      setSelectedAction('');
      setActionNote('');
      await fetchReports();
    } catch (err) {
      setError(err.message || 'Moderation action execution failed');
    } finally {
      setSubmittingAction(false);
    }
  };

  const getReasonBadge = (reason) => {
    return (
      <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-800">
        {reason.replace('_', ' ').toUpperCase()}
      </span>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Content Moderation Queue</h2>
          <p className="text-xs text-slate-500 mt-1">
            Review user reports, inspect target snapshots, and enforce moderation actions.
          </p>
        </div>
        <button
          type="button"
          onClick={fetchReports}
          disabled={loading}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-white border border-slate-300 rounded hover:bg-slate-50 transition text-slate-700 disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>Refresh</span>
        </button>
      </div>

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded text-xs flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {successMsg && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded text-xs flex items-center gap-2">
          <CheckCircle className="w-4 h-4 shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}

      {/* Tabs for Target Types & Status Filter */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex border-b border-slate-200 w-full md:w-auto">
          <button
            type="button"
            onClick={() => setTargetType('item')}
            className={`flex items-center gap-1.5 px-4 py-2 text-xs font-bold border-b-2 transition -mb-px ${
              targetType === 'item'
                ? 'border-teal-600 text-teal-700'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <Package className="w-3.5 h-3.5" />
            <span>Items Queue</span>
          </button>
          <button
            type="button"
            onClick={() => setTargetType('user')}
            className={`flex items-center gap-1.5 px-4 py-2 text-xs font-bold border-b-2 transition -mb-px ${
              targetType === 'user'
                ? 'border-teal-600 text-teal-700'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <User className="w-3.5 h-3.5" />
            <span>Users Queue</span>
          </button>
          <button
            type="button"
            onClick={() => setTargetType('message')}
            className={`flex items-center gap-1.5 px-4 py-2 text-xs font-bold border-b-2 transition -mb-px ${
              targetType === 'message'
                ? 'border-teal-600 text-teal-700'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <MessageSquare className="w-3.5 h-3.5" />
            <span>Messages Queue</span>
          </button>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-600 font-semibold">Status:</span>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="text-xs border border-slate-300 rounded px-2.5 py-1.5 bg-white outline-none focus:border-teal-600"
          >
            <option value="pending">Pending Review</option>
            <option value="reviewed">Already Reviewed</option>
          </select>
        </div>
      </div>

      {/* Reports List */}
      <div className="space-y-4">
        {loading && (
          <div className="p-8 text-center text-xs text-slate-500 bg-white rounded-lg border border-slate-200">
            <RefreshCw className="w-5 h-5 mx-auto mb-2 animate-spin text-teal-600" />
            Loading moderation queue...
          </div>
        )}

        {!loading && reports.length === 0 && (
          <div className="p-8 text-center text-slate-500 bg-white rounded-lg border border-slate-200 space-y-2">
            <CheckCircle className="w-8 h-8 mx-auto text-emerald-500" />
            <p className="text-sm font-semibold text-slate-700">Moderation Queue Clear</p>
            <p className="text-xs">No reports currently matching this queue filter.</p>
          </div>
        )}

        {!loading &&
          reports.map((r) => {
            const s = r.snapshot || {};
            return (
              <div
                key={r._id}
                className="bg-white rounded-lg border border-slate-200 shadow-sm p-5 space-y-4"
              >
                {/* Header row */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-100">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-xs text-slate-900">
                      Report #{r._id.substring(r._id.length - 8)}
                    </span>
                    {getReasonBadge(r.reason)}
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full font-semibold ${
                        r.status === 'pending'
                          ? 'bg-amber-100 text-amber-800'
                          : 'bg-slate-100 text-slate-700'
                      }`}
                    >
                      {r.status.toUpperCase()}
                    </span>
                  </div>
                  <span className="text-xs text-slate-400">
                    Filed on {new Date(r.createdAt).toLocaleString()}
                  </span>
                </div>

                {/* Details & Target Snapshot */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                  {/* Reporter details */}
                  <div className="p-3 bg-slate-50 rounded border border-slate-200 space-y-1.5">
                    <span className="font-bold text-slate-700 block">Report Details:</span>
                    <p className="text-slate-600">
                      <span className="font-semibold text-slate-700">Reporter ID:</span> #
                      {r.reporterId?.toString?.().substring(18) || r.reporterId}
                    </p>
                    <p className="text-slate-600">
                      <span className="font-semibold text-slate-700">Target Owner ID:</span> #
                      {r.targetOwnerId?.toString?.().substring(18) || r.targetOwnerId}
                    </p>
                    <p className="text-slate-800 pt-1 italic">
                      &ldquo;{r.details || 'No additional details provided.'}&rdquo;
                    </p>
                  </div>

                  {/* Frozen Snapshot at Report Time */}
                  <div className="p-3 bg-slate-50 rounded border border-slate-200 space-y-1.5">
                    <span className="font-bold text-slate-700 block">Frozen Target Snapshot:</span>
                    {r.targetType === 'item' && (
                      <div className="space-y-1">
                        <p className="font-semibold text-slate-900">{s.title || 'Item'}</p>
                        <p className="text-slate-600">Category: {s.category || 'General'}</p>
                        <p className="text-slate-600">
                          Rent: {formatPaise(s.rentPerDayPaise || 0, { showDemoTag: true })} / day
                        </p>
                        <p className="text-slate-600">
                          Deposit: {formatPaise(s.depositPaise || 0, { showDemoTag: true })}
                        </p>
                        {(s.photos || []).length > 0 && (
                          <div className="flex gap-1.5 overflow-x-auto pt-1">
                            {s.photos.slice(0, 3).map((img, idx) => (
                              <img
                                key={idx}
                                src={img}
                                alt="Item snapshot"
                                className="w-12 h-12 object-cover rounded border border-slate-300"
                              />
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {r.targetType === 'user' && (
                      <div className="space-y-1">
                        <p className="font-semibold text-slate-900">{s.name || 'User'}</p>
                        <p className="text-slate-600 font-mono">Email: {s.email || '***'}</p>
                        <p className="text-slate-600">Trust Score: {s.trustScore ?? 50} / 100</p>
                        <p className="text-slate-600">Strikes: {s.strikes ?? 0}</p>
                        <p className="text-slate-600">Account Status: {s.status || 'active'}</p>
                      </div>
                    )}

                    {r.targetType === 'message' && (
                      <div className="space-y-1">
                        <p className="font-semibold text-slate-700">Message Content:</p>
                        <p className="p-2 bg-white rounded border border-slate-200 font-mono text-[11px] text-slate-800">
                          {s.text || 'N/A'}
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Review status or Quick Actions */}
                {r.status === 'reviewed' ? (
                  <div className="p-3 bg-emerald-50 rounded border border-emerald-200 text-xs text-emerald-900 space-y-1">
                    <span className="font-bold">
                      Reviewed by Agent #{r.reviewedById?.substring?.(18) || r.reviewedById}
                    </span>
                    <p>
                      Action Taken: <span className="font-semibold uppercase">{r.careAction}</span>
                    </p>
                    {r.actionNote && <p className="italic">&ldquo;{r.actionNote}&rdquo;</p>}
                  </div>
                ) : (
                  <div className="pt-2 border-t border-slate-100 flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-semibold text-slate-500 mr-2">
                      Quick Actions:
                    </span>

                    <button
                      type="button"
                      onClick={() => handleOpenActionModal(r, 'dismiss')}
                      className="px-2.5 py-1 text-xs font-semibold rounded bg-slate-100 hover:bg-slate-200 text-slate-700 transition"
                    >
                      Dismiss
                    </button>

                    {r.targetType === 'item' && (
                      <>
                        <button
                          type="button"
                          onClick={() => handleOpenActionModal(r, 'hide_item')}
                          className="px-2.5 py-1 text-xs font-semibold rounded bg-amber-50 hover:bg-amber-100 text-amber-800 transition flex items-center gap-1"
                        >
                          <EyeOff className="w-3 h-3" />
                          Hide Item
                        </button>
                        <button
                          type="button"
                          onClick={() => handleOpenActionModal(r, 'remove_item')}
                          className="px-2.5 py-1 text-xs font-semibold rounded bg-red-50 hover:bg-red-100 text-red-800 transition flex items-center gap-1"
                        >
                          <Trash2 className="w-3 h-3" />
                          Remove Item
                        </button>
                        <button
                          type="button"
                          onClick={() => handleOpenActionModal(r, 'restore_item')}
                          className="px-2.5 py-1 text-xs font-semibold rounded bg-emerald-50 hover:bg-emerald-100 text-emerald-800 transition flex items-center gap-1"
                        >
                          <RotateCcw className="w-3 h-3" />
                          Restore Item
                        </button>
                      </>
                    )}

                    {r.targetType === 'user' && (
                      <>
                        <button
                          type="button"
                          onClick={() => handleOpenActionModal(r, 'warn_user')}
                          className="px-2.5 py-1 text-xs font-semibold rounded bg-amber-50 hover:bg-amber-100 text-amber-800 transition flex items-center gap-1"
                        >
                          <AlertTriangle className="w-3 h-3" />
                          Warn User
                        </button>
                        <button
                          type="button"
                          onClick={() => handleOpenActionModal(r, 'strike_user')}
                          className="px-2.5 py-1 text-xs font-semibold rounded bg-red-50 hover:bg-red-100 text-red-800 transition flex items-center gap-1"
                        >
                          <AlertOctagon className="w-3 h-3" />
                          Strike User (-10 trust)
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
      </div>

      {/* Action Execution Modal */}
      {selectedReport && (
        <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center p-4 z-50">
          <div className="max-w-md w-full bg-white rounded-lg border border-slate-200 shadow-xl p-5 space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-slate-200">
              <h3 className="font-bold text-sm text-slate-900">
                Execute Moderation Action:{' '}
                <span className="uppercase text-teal-700">{selectedAction}</span>
              </h3>
              <button
                type="button"
                onClick={() => setSelectedReport(null)}
                className="text-slate-400 hover:text-slate-700 text-sm font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleExecuteAction} className="space-y-4 text-xs">
              <p className="text-slate-600">
                You are about to execute action{' '}
                <strong className="uppercase">{selectedAction}</strong> on{' '}
                {selectedReport.targetType} #{selectedReport.targetId}. This operation will be
                logged to the audit trail.
              </p>

              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  Action Note (Required for Audit Log):
                </label>
                <textarea
                  rows={3}
                  required
                  value={actionNote}
                  onChange={(e) => setActionNote(e.target.value)}
                  placeholder="Detail the justification for this moderation action..."
                  className="w-full border border-slate-300 rounded p-2 outline-none focus:border-teal-600"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setSelectedReport(null)}
                  className="px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingAction || !actionNote.trim()}
                  className="px-4 py-1.5 text-xs font-bold text-white bg-teal-600 hover:bg-teal-700 rounded transition disabled:opacity-50"
                >
                  {submittingAction ? 'Executing...' : 'Confirm Action'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default ModerationQueue;
