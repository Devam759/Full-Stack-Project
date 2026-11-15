import React, { useState, useEffect, useCallback } from 'react';
import { Scale, AlertTriangle, CheckCircle, X, RefreshCw } from 'lucide-react';
import { formatPaise, generateIdempotencyKey } from '../../utils.js';

export function AdminAppeals({ token }) {
  const [appeals, setAppeals] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState('pending');

  // Decision Modal State
  const [selectedDispute, setSelectedDispute] = useState(null);
  const [decisionMode, setDecisionMode] = useState('upheld'); // 'upheld' | 'overturned'
  const [note, setNote] = useState('');

  // Revised Decision Inputs
  const [rentOutcome, setRentOutcome] = useState('lender');
  const [depositToLender, setDepositToLender] = useState('');
  const [depositToBorrower, setDepositToBorrower] = useState('');
  const [penaltyKind, setPenaltyKind] = useState('lost_dispute');

  // Preview State
  const [previewResult, setPreviewResult] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const [acknowledgeShortfall, setAcknowledgeShortfall] = useState(false);

  // Submit Action State
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState('');
  const [actionSuccess, setActionSuccess] = useState('');

  const fetchAppeals = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.append('status', statusFilter);
      params.append('limit', '50');

      const res = await fetch(`/v1/admin/appeals?${params.toString()}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.message || data?.error?.message || 'Failed to load appeals');
      }
      setAppeals(data.appeals || []);
    } catch (err) {
      setError(err.message || 'Error fetching appeals queue');
    } finally {
      setLoading(false);
    }
  }, [statusFilter, token]);

  useEffect(() => {
    fetchAppeals();
  }, [fetchAppeals]);

  const openDecisionModal = (dispute) => {
    setSelectedDispute(dispute);
    setDecisionMode('upheld');
    setNote('');
    setPreviewResult(null);
    setPreviewError('');
    setPreviewLoading(false);
    setAcknowledgeShortfall(false);
    setActionError('');
    setActionSuccess('');

    // Prepopulate default overturn values based on original decision
    const original = dispute.careDecision || {};
    setRentOutcome(original.rentOutcome || 'lender');
    setDepositToLender(
      original.depositToLenderPaise !== undefined
        ? (original.depositToLenderPaise / 100).toString()
        : '0',
    );
    setDepositToBorrower(
      original.depositToBorrowerPaise !== undefined
        ? (original.depositToBorrowerPaise / 100).toString()
        : '0',
    );
    setPenaltyKind(original.penaltyKind || 'lost_dispute');
  };

  const closeModal = () => {
    setSelectedDispute(null);
    setPreviewResult(null);
    setPreviewError('');
    setActionError('');
    setActionSuccess('');
  };

  const handlePreviewCalculation = async () => {
    setPreviewLoading(true);
    setPreviewError('');
    setPreviewResult(null);

    const lenderPaise = Math.round(parseFloat(depositToLender || '0') * 100);
    const borrowerPaise = Math.round(parseFloat(depositToBorrower || '0') * 100);

    const revisedDecision = {
      depositToLenderPaise: lenderPaise,
      depositToBorrowerPaise: borrowerPaise,
      rentOutcome,
      penaltyKind,
      faultUserId: null,
    };

    try {
      const res = await fetch(`/v1/admin/appeals/${selectedDispute._id}/preview`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ revisedDecision }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.message || data?.error?.message || 'Settlement preview failed');
      }

      setPreviewResult(data);
    } catch (err) {
      setPreviewError(err.message || 'Error computing preview settlement');
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleDecisionSubmit = async (e) => {
    e.preventDefault();
    if (!note || note.trim().length < 20) {
      setActionError('Decision note is required and must be at least 20 characters');
      return;
    }

    if (
      decisionMode === 'overturned' &&
      previewResult?.acknowledgeRequired &&
      !acknowledgeShortfall
    ) {
      setActionError(
        'Shortfall acknowledgment is required before confirming an overturned settlement',
      );
      return;
    }

    setActionLoading(true);
    setActionError('');
    setActionSuccess('');

    const payload = {
      decision: decisionMode,
      note: note.trim(),
    };

    if (decisionMode === 'overturned') {
      const lenderPaise = Math.round(parseFloat(depositToLender || '0') * 100);
      const borrowerPaise = Math.round(parseFloat(depositToBorrower || '0') * 100);
      payload.revisedDecision = {
        depositToLenderPaise: lenderPaise,
        depositToBorrowerPaise: borrowerPaise,
        rentOutcome,
        penaltyKind,
        faultUserId: null,
      };
      payload.acknowledgeShortfall = acknowledgeShortfall;
    }

    try {
      const res = await fetch(`/v1/admin/appeals/${selectedDispute._id}/decide`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'Idempotency-Key': generateIdempotencyKey('appeal-decide'),
        },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.message || data?.error?.message || 'Failed to decide appeal');
      }

      setActionSuccess(`Appeal successfully ${decisionMode}.`);
      setTimeout(() => {
        closeModal();
        fetchAppeals();
      }, 1200);
    } catch (err) {
      setActionError(err.message || 'Error submitting appeal decision');
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-slate-900">Dispute Appeals Management</h2>
          <p className="text-xs text-slate-500">
            Review contested dispute decisions, simulate settlement reversals, and issue final
            rulings
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="text-xs px-3 py-1.5 border border-slate-300 rounded outline-none focus:border-teal-600 bg-white"
          >
            <option value="pending">Pending Appeals</option>
            <option value="upheld">Upheld Decisions</option>
            <option value="overturned">Overturned Decisions</option>
          </select>
          <button
            type="button"
            onClick={fetchAppeals}
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

      {/* Appeals List Cards */}
      <div className="space-y-3">
        {appeals.map((item) => (
          <div
            key={item._id}
            className="bg-white p-4 rounded-lg border border-slate-200 shadow-sm space-y-3 hover:border-slate-300 transition"
          >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-2">
              <div className="flex items-center gap-2">
                <span className="font-bold text-sm text-slate-900">
                  {item.itemTitle || 'Item Rental'}
                </span>
                <span className="text-xs text-slate-500 font-mono">
                  Dispute #{item._id.slice(-6)}
                </span>
                <span className="px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider bg-purple-100 text-purple-800">
                  Appealed by {item.requesterRole || 'Party'}
                </span>
              </div>
              <span
                className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider self-start sm:self-auto ${
                  item.appeal?.status === 'pending'
                    ? 'bg-amber-100 text-amber-800'
                    : item.appeal?.status === 'upheld'
                      ? 'bg-emerald-100 text-emerald-800'
                      : 'bg-indigo-100 text-indigo-800'
                }`}
              >
                Appeal {item.appeal?.status || 'pending'}
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
              <div className="bg-slate-50 p-2.5 rounded border border-slate-200 space-y-1">
                <span className="font-semibold text-slate-700 block">Original Care Decision</span>
                <div className="text-slate-600">
                  Rent outcome:{' '}
                  <strong className="text-slate-800">
                    {item.careDecision?.rentOutcome === 'lender' ? 'Paid to Lender' : 'Refunded'}
                  </strong>
                </div>
                <div className="text-slate-600">
                  Deposit split: Lender{' '}
                  <strong className="text-slate-800">
                    {formatPaise(item.careDecision?.depositToLenderPaise || 0)}
                  </strong>{' '}
                  • Borrower{' '}
                  <strong className="text-slate-800">
                    {formatPaise(item.careDecision?.depositToBorrowerPaise || 0)}
                  </strong>
                </div>
                <p className="text-slate-500 italic mt-1 text-[11px]">
                  &ldquo;{item.careDecision?.note || 'No care note'}&rdquo;
                </p>
              </div>

              <div className="bg-slate-50 p-2.5 rounded border border-slate-200 space-y-1">
                <span className="font-semibold text-slate-700 block">Appeal Argument</span>
                <div className="text-slate-600 font-medium">
                  Contested Reason:{' '}
                  <span className="capitalize">{item.disputeReason?.replace('_', ' ')}</span>
                </div>
                <p className="text-slate-700 bg-white p-2 rounded border border-slate-200 text-[11px]">
                  &ldquo;{item.appeal?.reason || 'No appeal justification provided'}&rdquo;
                </p>
              </div>
            </div>

            {item.appeal?.status === 'pending' && (
              <div className="flex justify-end pt-1">
                <button
                  type="button"
                  onClick={() => openDecisionModal(item)}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-teal-600 hover:bg-teal-700 text-white rounded text-xs font-semibold shadow-sm transition"
                >
                  <Scale className="w-3.5 h-3.5" />
                  <span>Review & Decide Appeal</span>
                </button>
              </div>
            )}
          </div>
        ))}

        {appeals.length === 0 && !loading && (
          <div className="bg-white p-8 rounded-lg border border-slate-200 text-center text-slate-500 text-xs">
            No {statusFilter} dispute appeals found in queue.
          </div>
        )}
      </div>

      {/* Appeal Decision & Settlement Reversal Dialog */}
      {selectedDispute && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 z-50 overflow-y-auto">
          <div className="bg-white rounded-lg max-w-2xl w-full p-6 space-y-4 border border-slate-200 shadow-xl my-8">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="font-bold text-sm text-slate-900">
                  Judicial Appeal Decision: Dispute #{selectedDispute._id.slice(-6)}
                </h3>
                <p className="text-xs text-slate-500">
                  Decide whether to uphold the customer care decision or overturn and reverse ledger
                  funds
                </p>
              </div>
              <button
                type="button"
                onClick={closeModal}
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
              <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-700 rounded text-xs flex items-center gap-2">
                <CheckCircle className="w-4 h-4" />
                <span>{actionSuccess}</span>
              </div>
            )}

            <form onSubmit={handleDecisionSubmit} className="space-y-4 text-xs">
              {/* Decision Mode Toggle */}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setDecisionMode('upheld');
                    setPreviewResult(null);
                  }}
                  className={`flex-1 py-2 px-3 rounded font-semibold text-center border transition ${
                    decisionMode === 'upheld'
                      ? 'bg-emerald-50 border-emerald-500 text-emerald-800'
                      : 'bg-slate-50 border-slate-200 text-slate-600'
                  }`}
                >
                  Uphold Care Decision (No Money Moves)
                </button>
                <button
                  type="button"
                  onClick={() => setDecisionMode('overturned')}
                  className={`flex-1 py-2 px-3 rounded font-semibold text-center border transition ${
                    decisionMode === 'overturned'
                      ? 'bg-indigo-50 border-indigo-500 text-indigo-800'
                      : 'bg-slate-50 border-slate-200 text-slate-600'
                  }`}
                >
                  Overturn & Recompute Settlement
                </button>
              </div>

              {decisionMode === 'overturned' && (
                <div className="p-4 bg-slate-50 rounded-lg border border-slate-200 space-y-4">
                  <h4 className="font-bold text-slate-800 text-xs">
                    Revised Settlement Parameters
                  </h4>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-slate-600 mb-1 font-medium">Rent Outcome</label>
                      <select
                        value={rentOutcome}
                        onChange={(e) => setRentOutcome(e.target.value)}
                        className="w-full p-2 border border-slate-300 rounded outline-none focus:border-teal-600 bg-white"
                      >
                        <option value="lender">Release Rent to Lender</option>
                        <option value="refund_borrower">Full Refund to Borrower</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-slate-600 mb-1 font-medium">
                        Penalty Assessment
                      </label>
                      <select
                        value={penaltyKind}
                        onChange={(e) => setPenaltyKind(e.target.value)}
                        className="w-full p-2 border border-slate-300 rounded outline-none focus:border-teal-600 bg-white"
                      >
                        <option value="lost_dispute">Lost Dispute Penalty (-10 trust)</option>
                        <option value="rejected_damage_claim">Rejected Claim (-15 trust)</option>
                        <option value="no_show">No Show (-20 trust, 1 strike)</option>
                        <option value="none">No Penalties (Mutual)</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-slate-600 mb-1 font-medium">
                        Deposit to Lender (₹)
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={depositToLender}
                        onChange={(e) => setDepositToLender(e.target.value)}
                        className="w-full p-2 border border-slate-300 rounded outline-none focus:border-teal-600 font-mono"
                      />
                    </div>

                    <div>
                      <label className="block text-slate-600 mb-1 font-medium">
                        Deposit to Borrower (₹)
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={depositToBorrower}
                        onChange={(e) => setDepositToBorrower(e.target.value)}
                        className="w-full p-2 border border-slate-300 rounded outline-none focus:border-teal-600 font-mono"
                      />
                    </div>
                  </div>

                  <div className="flex justify-between items-center pt-2">
                    <span className="text-[11px] text-slate-500">
                      Simulate double-entry movements before confirming.
                    </span>
                    <button
                      type="button"
                      onClick={handlePreviewCalculation}
                      disabled={previewLoading}
                      className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded font-semibold text-xs shadow-sm transition disabled:opacity-50"
                    >
                      {previewLoading ? 'Calculating...' : 'Preview Reversal Calculations'}
                    </button>
                  </div>

                  {previewError && (
                    <div className="p-2.5 bg-red-50 border border-red-200 text-red-700 rounded text-xs">
                      {previewError}
                    </div>
                  )}

                  {/* Preview Reversal Result & Shortfall Warning */}
                  {previewResult && (
                    <div className="p-3 bg-white rounded border border-indigo-200 space-y-3">
                      <h5 className="font-bold text-slate-900 text-xs">Net Delta Movements</h5>
                      <div className="grid grid-cols-3 gap-2 text-center">
                        <div className="bg-slate-50 p-2 rounded">
                          <span className="text-slate-500 block">Borrower Delta</span>
                          <span
                            className={`font-bold font-mono ${previewResult.deltas.borrower >= 0 ? 'text-emerald-700' : 'text-red-700'}`}
                          >
                            {previewResult.deltas.borrower >= 0 ? '+' : ''}
                            {formatPaise(previewResult.deltas.borrower)}
                          </span>
                        </div>
                        <div className="bg-slate-50 p-2 rounded">
                          <span className="text-slate-500 block">Lender Delta</span>
                          <span
                            className={`font-bold font-mono ${previewResult.deltas.lender >= 0 ? 'text-emerald-700' : 'text-red-700'}`}
                          >
                            {previewResult.deltas.lender >= 0 ? '+' : ''}
                            {formatPaise(previewResult.deltas.lender)}
                          </span>
                        </div>
                        <div className="bg-slate-50 p-2 rounded">
                          <span className="text-slate-500 block">Platform Comm.</span>
                          <span
                            className={`font-bold font-mono ${previewResult.deltas.platform >= 0 ? 'text-emerald-700' : 'text-red-700'}`}
                          >
                            {previewResult.deltas.platform >= 0 ? '+' : ''}
                            {formatPaise(previewResult.deltas.platform)}
                          </span>
                        </div>
                      </div>

                      {/* Prominent Shortfall Alert when lender has withdrawn funds */}
                      {previewResult.shortfallPaise > 0 && (
                        <div className="p-3 bg-amber-50 border border-amber-300 rounded text-amber-900 space-y-2">
                          <div className="flex items-center gap-1.5 font-bold">
                            <AlertTriangle className="w-4 h-4 text-amber-600" />
                            <span>
                              Shortfall Detected: {formatPaise(previewResult.shortfallPaise)}
                            </span>
                          </div>
                          <p className="text-[11px] text-amber-800 leading-relaxed">
                            The debited party has already withdrawn their funds. Debit is strictly
                            capped at available wallet balance (never going negative). The
                            unrecovered shortfall of {formatPaise(previewResult.shortfallPaise)} has
                            been automatically deducted from the gaining party&apos;s payout.
                          </p>
                          <label className="flex items-center gap-2 pt-1 font-semibold cursor-pointer">
                            <input
                              type="checkbox"
                              checked={acknowledgeShortfall}
                              onChange={(e) => setAcknowledgeShortfall(e.target.checked)}
                              className="rounded border-amber-400 text-teal-600 focus:ring-teal-500 w-4 h-4"
                            />
                            <span className="text-amber-950">
                              I acknowledge and authorize the unrecovered shortfall of{' '}
                              {formatPaise(previewResult.shortfallPaise)}
                            </span>
                          </label>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Judicial Ruling Justification (Required Note, min 20 chars)
                </label>
                <textarea
                  required
                  rows={3}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Provide a detailed operational justification explaining why this decision was upheld or overturned..."
                  className="w-full p-2 border border-slate-300 rounded outline-none focus:border-teal-600 font-sans"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={closeModal}
                  className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={actionLoading}
                  className={`px-4 py-1.5 text-white rounded font-semibold shadow-sm transition disabled:opacity-50 ${
                    decisionMode === 'upheld'
                      ? 'bg-emerald-600 hover:bg-emerald-700'
                      : 'bg-indigo-600 hover:bg-indigo-700'
                  }`}
                >
                  {actionLoading ? 'Executing Ruling...' : `Confirm Ruling (${decisionMode})`}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default AdminAppeals;
