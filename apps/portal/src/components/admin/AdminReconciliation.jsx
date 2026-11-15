import React, { useState, useEffect, useCallback } from 'react';
import { Play, AlertTriangle, CheckCircle2, X, RefreshCw } from 'lucide-react';
import { generateIdempotencyKey } from '../../utils.js';

export function AdminReconciliation({ token }) {
  const [runs, setRuns] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [nextCursor, setNextCursor] = useState(null);

  // Trigger Run Modal State
  const [showRunModal, setShowRunModal] = useState(false);
  const [reason, setReason] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState('');
  const [actionSuccess, setActionSuccess] = useState('');

  // Inspect Run Details
  const [inspectedRun, setInspectedRun] = useState(null);

  const fetchRuns = useCallback(
    async (cursor = null) => {
      setLoading(true);
      setError('');
      try {
        const params = new URLSearchParams();
        if (cursor) params.append('cursor', cursor);
        params.append('limit', '20');

        const res = await fetch(`/v1/admin/ledger/reconciliation?${params.toString()}`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(
            data?.message || data?.error?.message || 'Failed to load reconciliation runs',
          );
        }
        setRuns(data.runs || []);
        setNextCursor(data.nextCursor || null);
      } catch (err) {
        setError(err.message || 'Error fetching reconciliation history');
      } finally {
        setLoading(false);
      }
    },
    [token],
  );

  useEffect(() => {
    fetchRuns();
  }, [fetchRuns]);

  const handleTriggerRun = async (e) => {
    e.preventDefault();
    if (!reason || reason.trim().length < 10) {
      setActionError('Reason is required and must be at least 10 characters');
      return;
    }

    setActionLoading(true);
    setActionError('');
    setActionSuccess('');

    try {
      const res = await fetch('/v1/admin/ledger/reconciliation/run', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'Idempotency-Key': generateIdempotencyKey('recon-run'),
        },
        body: JSON.stringify({ reason: reason.trim() }),
      });

      const data = await res.json();
      if (!res.ok) {
        if (data?.error?.code === 'RECONCILIATION_COOLDOWN') {
          throw new Error(
            `Cooldown in effect: Another reconciliation run occurred recently. Please wait before triggering again.`,
          );
        }
        throw new Error(
          data?.message || data?.error?.message || 'Failed to enqueue reconciliation run',
        );
      }

      setActionSuccess('Reconciliation run safely enqueued to background worker queue.');
      setTimeout(() => {
        setShowRunModal(false);
        setReason('');
        setActionSuccess('');
        fetchRuns();
      }, 1500);
    } catch (err) {
      setActionError(err.message || 'Error triggering reconciliation');
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-slate-900">Ledger Financial Reconciliation</h2>
          <p className="text-xs text-slate-500">
            Reconcile double-entry ledger entries against wallet balances and verify zero-sum
            invariance
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowRunModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-teal-600 hover:bg-teal-700 text-white rounded text-xs font-semibold shadow-sm transition"
          >
            <Play className="w-3.5 h-3.5" />
            <span>Trigger Reconciliation Run</span>
          </button>
          <button
            type="button"
            onClick={() => fetchRuns()}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded text-xs font-medium shadow-sm"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded text-xs flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* History Table */}
      <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                <th className="p-3">Run Timestamp</th>
                <th className="p-3">Status</th>
                <th className="p-3 text-center">Wallets Reconciled</th>
                <th className="p-3 text-center">Discrepancies</th>
                <th className="p-3">Triggered Reason</th>
                <th className="p-3 text-right">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {runs.map((r) => (
                <tr key={r._id} className="hover:bg-slate-50 transition">
                  <td className="p-3 font-mono text-slate-900">
                    {new Date(r.createdAt).toLocaleString()}
                  </td>
                  <td className="p-3">
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider ${
                        r.status === 'completed'
                          ? 'bg-emerald-100 text-emerald-800'
                          : r.status === 'in_progress'
                            ? 'bg-blue-100 text-blue-800'
                            : 'bg-red-100 text-red-800'
                      }`}
                    >
                      {r.status}
                    </span>
                  </td>
                  <td className="p-3 text-center font-bold text-slate-800">
                    {r.walletsReconciledCount ?? r.walletsChecked ?? 0}
                  </td>
                  <td className="p-3 text-center font-bold">
                    {(r.discrepancyCount ?? (r.discrepancies?.length || 0)) === 0 ? (
                      <span className="text-emerald-700 flex items-center justify-center gap-1">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>0</span>
                      </span>
                    ) : (
                      <span className="text-red-700">
                        {r.discrepancyCount ?? r.discrepancies.length}
                      </span>
                    )}
                  </td>
                  <td className="p-3 text-slate-600 italic max-w-xs truncate">
                    &ldquo;{r.reason || 'Automated periodic run'}&rdquo;
                  </td>
                  <td className="p-3 text-right">
                    <button
                      type="button"
                      onClick={() => setInspectedRun(r)}
                      className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded font-medium text-[11px]"
                    >
                      View Report
                    </button>
                  </td>
                </tr>
              ))}
              {runs.length === 0 && !loading && (
                <tr>
                  <td colSpan={6} className="p-6 text-center text-slate-500">
                    No reconciliation runs recorded yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {nextCursor && (
          <div className="p-3 bg-slate-50 border-t border-slate-200 flex justify-center">
            <button
              type="button"
              onClick={() => fetchRuns(nextCursor)}
              disabled={loading}
              className="px-4 py-1.5 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded text-xs font-medium"
            >
              {loading ? 'Loading...' : 'Load Next Page'}
            </button>
          </div>
        )}
      </div>

      {/* Trigger Run Modal */}
      {showRunModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-md w-full p-6 space-y-4 border border-slate-200 shadow-lg">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="font-bold text-sm text-slate-900">Trigger On-Demand Reconciliation</h3>
              <button
                type="button"
                onClick={() => setShowRunModal(false)}
                className="text-slate-400 hover:text-slate-700"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {actionError && (
              <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded text-xs">
                {actionError}
              </div>
            )}

            {actionSuccess && (
              <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-700 rounded text-xs flex items-center gap-1.5 font-medium">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>{actionSuccess}</span>
              </div>
            )}

            <form onSubmit={handleTriggerRun} className="space-y-4 text-xs">
              <div className="p-3 bg-teal-50 border border-teal-200 rounded text-teal-900 space-y-1">
                <p className="font-semibold">Execution Guidelines:</p>
                <p className="text-teal-800 text-[11px]">
                  Enqueues an asynchronous verification worker job. Enforces a 5-minute cooldown to
                  prevent database overload.
                </p>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Required Justification (Audit Log Reason)
                </label>
                <textarea
                  required
                  rows={3}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Operational justification for triggering on-demand ledger audit (min 10 characters)..."
                  className="w-full p-2 border border-slate-300 rounded outline-none focus:border-teal-600 font-sans"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowRunModal(false)}
                  className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={actionLoading}
                  className="px-4 py-1.5 bg-teal-600 hover:bg-teal-700 text-white rounded font-semibold transition disabled:opacity-50"
                >
                  {actionLoading ? 'Enqueuing...' : 'Trigger Run'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Inspected Report Modal */}
      {inspectedRun && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-lg w-full p-6 space-y-4 border border-slate-200 shadow-xl max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="font-bold text-sm text-slate-900">
                Reconciliation Report: {new Date(inspectedRun.createdAt).toLocaleDateString()}
              </h3>
              <button
                type="button"
                onClick={() => setInspectedRun(null)}
                className="text-slate-400 hover:text-slate-700"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-2 bg-slate-50 p-3 rounded border border-slate-200">
                <div>
                  <span className="text-slate-500 block">Status</span>
                  <span className="font-bold uppercase text-slate-900">{inspectedRun.status}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">Discrepancies</span>
                  <span className="font-bold text-slate-900">
                    {inspectedRun.discrepancyCount ?? inspectedRun.discrepancies?.length ?? 0}
                  </span>
                </div>
              </div>

              {inspectedRun.discrepancies && inspectedRun.discrepancies.length > 0 ? (
                <div className="space-y-2">
                  <span className="font-semibold text-red-700 block">Discrepancy Details:</span>
                  <pre className="p-3 bg-red-50 text-red-900 border border-red-200 rounded font-mono text-[11px] overflow-x-auto">
                    {JSON.stringify(inspectedRun.discrepancies, null, 2)}
                  </pre>
                </div>
              ) : (
                <div className="p-3 bg-emerald-50 text-emerald-800 border border-emerald-200 rounded flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span>100% Zero-sum ledger integrity verified with zero discrepancies.</span>
                </div>
              )}
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={() => setInspectedRun(null)}
                className="px-4 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded font-semibold text-xs"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default AdminReconciliation;
