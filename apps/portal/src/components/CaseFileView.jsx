import React, { useState, useEffect, useCallback } from 'react';
import {
  ArrowLeft,
  CheckCircle,
  AlertTriangle,
  Clock,
  Camera,
  MessageSquare,
  RefreshCw,
  Scale,
} from 'lucide-react';
import { formatPaise, calculateCommission } from '@borrowloop/shared';

export function CaseFileView({ disputeId, token, currentUser, onBack }) {
  const [caseFile, setCaseFile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [showTranscriptModal, setShowTranscriptModal] = useState(false);

  // Decision Form State
  const [idempotencyKey, setIdempotencyKey] = useState('');
  const [applyLateCharge, setApplyLateCharge] = useState(true);
  const [depositToLenderRupees, setDepositToLenderRupees] = useState('0');
  const [depositToBorrowerRupees, setDepositToBorrowerRupees] = useState('0');
  const [rentOutcome, setRentOutcome] = useState('lender'); // 'lender' | 'refund_borrower'
  const [penaltyKind, setPenaltyKind] = useState('none');
  const [faultUserId, setFaultUserId] = useState('');
  const [borrowerAccountAction, setBorrowerAccountAction] = useState('keep_frozen');
  const [note, setNote] = useState('');
  const [internalNote, setInternalNote] = useState('');

  const fetchCaseFile = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/v1/care/disputes/${disputeId}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.message || data?.error?.message || 'Failed to load case file');
      }

      setCaseFile(data);

      // Initialize form values based on booking financials
      const b = data.booking || {};
      const depositPaise = b.depositPaise || 0;
      const lateChargePaise = b.lateChargePaise || 0;
      const remainingDepositPaise = Math.max(0, depositPaise - lateChargePaise);

      setDepositToLenderRupees('0');
      setDepositToBorrowerRupees((remainingDepositPaise / 100).toString());
      setIdempotencyKey(
        typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : `idemp-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
      );
    } catch (err) {
      setError(err.message || 'Error fetching case file');
    } finally {
      setLoading(false);
    }
  }, [disputeId, token]);

  useEffect(() => {
    fetchCaseFile();
  }, [fetchCaseFile]);

  const handleAssignToMe = async () => {
    setActionLoading(true);
    setError('');
    try {
      const res = await fetch(`/v1/care/disputes/${disputeId}/assign`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ agentId: currentUser?._id }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.message || data?.error?.message || 'Failed to assign dispute');
      }
      setSuccessMsg('Dispute assigned to you successfully');
      await fetchCaseFile();
    } catch (err) {
      setError(err.message || 'Assignment failed');
    } finally {
      setActionLoading(false);
    }
  };

  // Financial calculations for live ledger preview
  const booking = caseFile?.booking || {};
  const rentPaise = booking.rentPaise || 0;
  const depositPaise = booking.depositPaise || 0;
  const lateChargePaise = booking.lateChargePaise || 0;

  const appliedLateChargePaise = applyLateCharge ? Math.min(lateChargePaise, depositPaise) : 0;
  const depositToLenderPaise = Math.round(Number(depositToLenderRupees || 0) * 100);
  const depositToBorrowerPaise = Math.round(Number(depositToBorrowerRupees || 0) * 100);

  const remainingDepositPaise = Math.max(0, depositPaise - appliedLateChargePaise);
  const depositSplitTotalPaise = depositToLenderPaise + depositToBorrowerPaise;
  const isDepositSplitValid = depositSplitTotalPaise === remainingDepositPaise;

  // Commission breakdown
  const lateChargeCommission = calculateCommission(appliedLateChargePaise);
  const rentCommission =
    rentOutcome === 'lender'
      ? calculateCommission(rentPaise)
      : { payoutPaise: 0, commissionPaise: 0 };

  const totalEscrowDebited = -(rentPaise + depositPaise);
  const lenderTotalCredit =
    rentCommission.payoutPaise + lateChargeCommission.payoutPaise + depositToLenderPaise;
  const platformTotalCredit = rentCommission.commissionPaise + lateChargeCommission.commissionPaise;
  const borrowerTotalCredit =
    depositToBorrowerPaise + (rentOutcome === 'refund_borrower' ? rentPaise : 0);

  const zeroSumBalance =
    totalEscrowDebited + lenderTotalCredit + platformTotalCredit + borrowerTotalCredit;

  // Handle dispute decision submission
  const handleDecisionSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');

    if (!isDepositSplitValid) {
      setError(
        `Deposit split must equal remaining deposit: ₹${(remainingDepositPaise / 100).toFixed(2)} (Demo money)`,
      );
      return;
    }

    if (note.trim().length < 20) {
      setError('Decision note must be at least 20 characters long.');
      return;
    }

    setActionLoading(true);
    try {
      const payload = {
        applyLateCharge,
        depositToLenderPaise,
        depositToBorrowerPaise,
        rentOutcome,
        penaltyKind,
        faultUserId: faultUserId || undefined,
        borrowerAccountAction:
          caseFile?.borrower?.status === 'frozen' ? borrowerAccountAction : undefined,
        note: note.trim(),
        internalNote: internalNote.trim() || undefined,
      };

      const res = await fetch(`/v1/care/disputes/${disputeId}/decision`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.message || data?.error?.message || 'Failed to submit decision');
      }

      setSuccessMsg('Dispute decision submitted and double-entry ledger settled successfully!');
      await fetchCaseFile();
    } catch (err) {
      setError(err.message || 'Decision submission failed');
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="p-12 text-center text-xs text-slate-500">
        <RefreshCw className="w-6 h-6 mx-auto mb-2 animate-spin text-teal-600" />
        Loading case file details...
      </div>
    );
  }

  if (!caseFile) {
    return (
      <div className="p-8 text-center space-y-4">
        <p className="text-sm text-red-600 font-semibold">Case file not found</p>
        <button
          type="button"
          onClick={onBack}
          className="px-4 py-2 text-xs bg-slate-200 hover:bg-slate-300 font-semibold rounded text-slate-800"
        >
          Back to Queue
        </button>
      </div>
    );
  }

  const dispute = caseFile.dispute;
  const isDecided =
    dispute.status === 'decided' || dispute.status === 'closed' || dispute.status === 'appealed';

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="p-1.5 rounded hover:bg-slate-200 transition text-slate-600"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-bold text-slate-900">
                Case File #{dispute._id.substring(dispute._id.length - 8)}
              </h2>
              <span className="text-xs px-2.5 py-0.5 rounded-full font-bold bg-teal-100 text-teal-800">
                {dispute.disputeReason.replace('_', ' ').toUpperCase()}
              </span>
              <span className="text-xs px-2 py-0.5 rounded-full font-semibold bg-slate-100 text-slate-700">
                Status: {dispute.status.toUpperCase()}
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Associated Booking #{booking._id} • Opened on{' '}
              {new Date(dispute.createdAt).toLocaleString()}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {!dispute.assignedAgentId && (
            <button
              type="button"
              onClick={handleAssignToMe}
              disabled={actionLoading}
              className="px-3 py-1.5 bg-teal-600 hover:bg-teal-700 text-white font-semibold text-xs rounded transition disabled:opacity-50"
            >
              Assign to Me
            </button>
          )}
          {dispute.assignedAgentId && (
            <span className="text-xs px-2.5 py-1 bg-slate-100 text-slate-700 rounded border border-slate-200">
              Assigned Agent: #{dispute.assignedAgentId.substring(18)}
            </span>
          )}
        </div>
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

      {/* Grid: Case File Explorer & Decision Form */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left 2 Cols: Timeline, Participants, Item & Evidence */}
        <div className="lg:col-span-2 space-y-6">
          {/* Booking Lifecycle Timeline */}
          <div className="bg-white p-5 rounded-lg border border-slate-200 shadow-sm space-y-3">
            <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-slate-500" />
              Booking & Dispute Timeline
            </h3>
            <div className="flex items-center gap-2 overflow-x-auto pb-2 text-xs">
              <div className="px-3 py-1.5 bg-slate-100 rounded text-slate-700 font-medium whitespace-nowrap">
                1. Requested: {new Date(booking.createdAt).toLocaleDateString()}
              </div>
              <span className="text-slate-300">→</span>
              <div className="px-3 py-1.5 bg-slate-100 rounded text-slate-700 font-medium whitespace-nowrap">
                2. Picked up:{' '}
                {booking.pickedUpAt ? new Date(booking.pickedUpAt).toLocaleDateString() : 'N/A'}
              </div>
              <span className="text-slate-300">→</span>
              <div className="px-3 py-1.5 bg-slate-100 rounded text-slate-700 font-medium whitespace-nowrap">
                3. Due: {booking.dueAt ? new Date(booking.dueAt).toLocaleDateString() : 'N/A'}
              </div>
              <span className="text-slate-300">→</span>
              <div className="px-3 py-1.5 bg-amber-100 text-amber-900 rounded font-bold whitespace-nowrap">
                4. Disputed: {new Date(dispute.createdAt).toLocaleDateString()}
              </div>
              {dispute.decision && (
                <>
                  <span className="text-slate-300">→</span>
                  <div className="px-3 py-1.5 bg-emerald-100 text-emerald-900 rounded font-bold whitespace-nowrap">
                    5. Decided: {new Date(dispute.decision.decidedAt).toLocaleDateString()}
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Participants Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Borrower Card */}
            <div className="bg-white p-4 rounded-lg border border-slate-200 shadow-sm space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-500 uppercase">Borrower</span>
                <span className="text-xs px-2 py-0.5 rounded bg-blue-50 text-blue-700 font-semibold">
                  Status: {caseFile.borrower?.status || 'active'}
                </span>
              </div>
              <p className="font-bold text-sm text-slate-900">
                {caseFile.borrower?.name || 'Borrower'}
              </p>
              <p className="text-xs text-slate-500 font-mono">
                Email: {caseFile.borrower?.email || 'b***@domain.com'}
              </p>
              <div className="flex items-center gap-3 pt-2 border-t border-slate-100 text-xs">
                <span className="font-semibold text-slate-700">
                  Trust: {caseFile.borrower?.trustScore ?? 50} / 100
                </span>
                <span className="font-semibold text-slate-700">
                  Strikes: {caseFile.borrower?.strikesCount ?? 0}
                </span>
                <span className="text-slate-400">
                  Joined:{' '}
                  {new Date(caseFile.borrower?.createdAt || Date.now()).toLocaleDateString()}
                </span>
              </div>
            </div>

            {/* Lender Card */}
            <div className="bg-white p-4 rounded-lg border border-slate-200 shadow-sm space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-500 uppercase">Lender</span>
                <span className="text-xs px-2 py-0.5 rounded bg-blue-50 text-blue-700 font-semibold">
                  Status: {caseFile.lender?.status || 'active'}
                </span>
              </div>
              <p className="font-bold text-sm text-slate-900">
                {caseFile.lender?.name || 'Lender'}
              </p>
              <p className="text-xs text-slate-500 font-mono">
                Email: {caseFile.lender?.email || 'l***@domain.com'}
              </p>
              <div className="flex items-center gap-3 pt-2 border-t border-slate-100 text-xs">
                <span className="font-semibold text-slate-700">
                  Trust: {caseFile.lender?.trustScore ?? 50} / 100
                </span>
                <span className="font-semibold text-slate-700">
                  Strikes: {caseFile.lender?.strikesCount ?? 0}
                </span>
                <span className="text-slate-400">
                  Joined: {new Date(caseFile.lender?.createdAt || Date.now()).toLocaleDateString()}
                </span>
              </div>
            </div>
          </div>

          {/* Item Details Card */}
          <div className="bg-white p-5 rounded-lg border border-slate-200 shadow-sm space-y-3">
            <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
              Item & Rental Escrow
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
              <div>
                <p className="text-slate-500">Item Title</p>
                <p className="font-bold text-slate-900">{caseFile.item?.title || 'Rental Item'}</p>
              </div>
              <div>
                <p className="text-slate-500">Rent / Day</p>
                <p className="font-bold text-slate-900">
                  {formatPaise(caseFile.item?.rentPerDayPaise || 0, { showDemoTag: true })}
                </p>
              </div>
              <div>
                <p className="text-slate-500">Deposit In Escrow</p>
                <p className="font-bold text-slate-900">
                  {formatPaise(depositPaise, { showDemoTag: true })}
                </p>
              </div>
              <div>
                <p className="text-slate-500">Accumulated Late Charge</p>
                <p className="font-bold text-amber-700">
                  {formatPaise(lateChargePaise, { showDemoTag: true })}
                </p>
              </div>
            </div>
          </div>

          {/* Handover & Evidence Gallery */}
          <div className="bg-white p-5 rounded-lg border border-slate-200 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                <Camera className="w-3.5 h-3.5 text-slate-500" />
                Evidence & Handover Photos
              </h3>
              <button
                type="button"
                onClick={() => setShowTranscriptModal(true)}
                className="text-xs font-semibold text-teal-700 hover:text-teal-800 flex items-center gap-1"
              >
                <MessageSquare className="w-3.5 h-3.5" />
                View Chat Transcript ({caseFile.messages?.length || 0})
              </button>
            </div>

            {/* Handover Photos (Pickup & Return) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="p-3 bg-slate-50 rounded border border-slate-200 text-xs space-y-2">
                <span className="font-semibold text-slate-700">Pickup Handover Photos</span>
                <div className="flex gap-2 overflow-x-auto py-1">
                  {(caseFile.handoverPickup?.photos || []).length > 0 ? (
                    caseFile.handoverPickup.photos.map((url, idx) => (
                      <img
                        key={idx}
                        src={url}
                        alt="Pickup Handover"
                        className="w-16 h-16 object-cover rounded border border-slate-300 shrink-0"
                      />
                    ))
                  ) : (
                    <p className="text-slate-400 italic">No handover photos uploaded at pickup</p>
                  )}
                </div>
              </div>

              <div className="p-3 bg-slate-50 rounded border border-slate-200 text-xs space-y-2">
                <span className="font-semibold text-slate-700">Return Handover Photos</span>
                <div className="flex gap-2 overflow-x-auto py-1">
                  {(caseFile.handoverReturn?.photos || []).length > 0 ? (
                    caseFile.handoverReturn.photos.map((url, idx) => (
                      <img
                        key={idx}
                        src={url}
                        alt="Return Handover"
                        className="w-16 h-16 object-cover rounded border border-slate-300 shrink-0"
                      />
                    ))
                  ) : (
                    <p className="text-slate-400 italic">No handover photos uploaded at return</p>
                  )}
                </div>
              </div>
            </div>

            {/* Submitted Dispute Evidence Entries */}
            <div className="space-y-3 pt-2">
              <span className="text-xs font-semibold text-slate-700 block">
                Dispute Evidence Records ({(dispute.evidence || []).length}):
              </span>
              {(dispute.evidence || []).length === 0 ? (
                <p className="text-xs text-slate-400 italic">
                  No supplemental evidence submitted yet.
                </p>
              ) : (
                dispute.evidence.map((ev, i) => (
                  <div
                    key={i}
                    className="p-3 rounded border border-slate-200 bg-slate-50 text-xs space-y-2"
                  >
                    <div className="flex items-center justify-between text-slate-500">
                      <span>Submitted by User #{ev.by?.substring?.(18) || ev.by}</span>
                      <span>{new Date(ev.createdAt).toLocaleString()}</span>
                    </div>
                    {ev.notes && <p className="text-slate-800">{ev.notes}</p>}
                    <div className="flex gap-2 overflow-x-auto">
                      {(ev.photos || []).map((p, idx) => (
                        <img
                          key={idx}
                          src={p.url || p}
                          alt="Dispute evidence"
                          className="w-20 h-20 object-cover rounded border border-slate-300 shrink-0"
                        />
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Right Col: Decision Form & Live Ledger Preview */}
        <div className="space-y-6">
          <div className="bg-white p-5 rounded-lg border border-slate-200 shadow-sm space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-slate-200">
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                <Scale className="w-4 h-4 text-teal-600" />
                Case Decision & Settlement
              </h3>
              <span className="text-[10px] font-mono px-2 py-0.5 bg-slate-100 rounded text-slate-600">
                Demo money
              </span>
            </div>

            {isDecided ? (
              <div className="space-y-3 text-xs">
                <div className="p-3 bg-emerald-50 border border-emerald-200 rounded text-emerald-900 space-y-1">
                  <p className="font-bold">Dispute Decided</p>
                  <p>Decided at: {new Date(dispute.decision.decidedAt).toLocaleString()}</p>
                  <p>
                    Deposit to Lender:{' '}
                    {formatPaise(dispute.decision.depositToLenderPaise, { showDemoTag: true })}
                  </p>
                  <p>
                    Deposit to Borrower:{' '}
                    {formatPaise(dispute.decision.depositToBorrowerPaise, { showDemoTag: true })}
                  </p>
                  <p>Rent Outcome: {dispute.decision.rentOutcome}</p>
                </div>
                <div className="p-3 bg-slate-50 rounded border border-slate-200 space-y-1">
                  <p className="font-semibold text-slate-700">Public Note:</p>
                  <p className="text-slate-600">{dispute.decision.note}</p>
                </div>
                {dispute.decision.internalNote && (
                  <div className="p-3 bg-amber-50 rounded border border-amber-200 space-y-1">
                    <p className="font-semibold text-amber-800">Internal Staff Note:</p>
                    <p className="text-amber-700">{dispute.decision.internalNote}</p>
                  </div>
                )}
              </div>
            ) : (
              <form onSubmit={handleDecisionSubmit} className="space-y-4 text-xs">
                {/* Apply Late Charge Checkbox */}
                {lateChargePaise > 0 && (
                  <label className="flex items-center gap-2 p-2 bg-amber-50 rounded border border-amber-200 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={applyLateCharge}
                      onChange={(e) => {
                        setApplyLateCharge(e.target.checked);
                        const newApplied = e.target.checked
                          ? Math.min(lateChargePaise, depositPaise)
                          : 0;
                        const newRemaining = Math.max(0, depositPaise - newApplied);
                        setDepositToBorrowerRupees((newRemaining / 100).toString());
                        setDepositToLenderRupees('0');
                      }}
                      className="rounded text-teal-600 focus:ring-teal-500"
                    />
                    <span className="font-semibold text-amber-900">
                      Apply late charge of {formatPaise(lateChargePaise, { showDemoTag: true })}{' '}
                      (15% commission)
                    </span>
                  </label>
                )}

                {/* Deposit Split Inputs */}
                <div className="space-y-3 p-3 bg-slate-50 rounded border border-slate-200">
                  <span className="font-bold text-slate-700 block">
                    Deposit Split (Remaining: ₹{(remainingDepositPaise / 100).toFixed(2)} Demo
                    money):
                  </span>
                  <div>
                    <label className="block text-slate-600 mb-1">Deposit to Lender (₹):</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={depositToLenderRupees}
                      onChange={(e) => {
                        const val = e.target.value;
                        setDepositToLenderRupees(val);
                        const lenderP = Math.round(Number(val || 0) * 100);
                        const autoBorrowerP = Math.max(0, remainingDepositPaise - lenderP);
                        setDepositToBorrowerRupees((autoBorrowerP / 100).toString());
                      }}
                      className="w-full border border-slate-300 rounded px-2.5 py-1.5 outline-none focus:border-teal-600 font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-600 mb-1">Deposit to Borrower (₹):</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={depositToBorrowerRupees}
                      onChange={(e) => setDepositToBorrowerRupees(e.target.value)}
                      className="w-full border border-slate-300 rounded px-2.5 py-1.5 outline-none focus:border-teal-600 font-mono"
                    />
                  </div>
                  {!isDepositSplitValid && (
                    <p className="text-red-600 font-semibold">
                      Invalid split: sum is ₹{(depositSplitTotalPaise / 100).toFixed(2)}, must equal
                      ₹{(remainingDepositPaise / 100).toFixed(2)}
                    </p>
                  )}
                </div>

                {/* Rent Outcome Radio */}
                <div className="space-y-1.5">
                  <label className="block font-bold text-slate-700">Rent Outcome:</label>
                  <div className="flex items-center gap-4">
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="radio"
                        name="rentOutcome"
                        value="lender"
                        checked={rentOutcome === 'lender'}
                        onChange={(e) => setRentOutcome(e.target.value)}
                      />
                      <span>Lender Earns Rent (15% comm)</span>
                    </label>
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="radio"
                        name="rentOutcome"
                        value="refund_borrower"
                        checked={rentOutcome === 'refund_borrower'}
                        onChange={(e) => setRentOutcome(e.target.value)}
                      />
                      <span>Refund Rent to Borrower</span>
                    </label>
                  </div>
                </div>

                {/* Penalty Kind Select */}
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Penalty Kind:</label>
                  <select
                    value={penaltyKind}
                    onChange={(e) => setPenaltyKind(e.target.value)}
                    className="w-full border border-slate-300 rounded px-2.5 py-1.5 bg-white outline-none focus:border-teal-600"
                  >
                    <option value="none">None (0 trust, 0 strikes)</option>
                    <option value="lost_dispute">Lost Dispute (-10 trust, 1 strike)</option>
                    <option value="rejected_damage_claim">
                      Rejected Damage Claim (-5 trust, 0 strikes)
                    </option>
                    <option value="no_show">No Show (-5 trust, 0 strikes)</option>
                  </select>
                </div>

                {/* Fault User Select */}
                {penaltyKind !== 'none' && (
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">Party at Fault:</label>
                    <select
                      value={faultUserId}
                      onChange={(e) => setFaultUserId(e.target.value)}
                      className="w-full border border-slate-300 rounded px-2.5 py-1.5 bg-white outline-none focus:border-teal-600"
                    >
                      <option value="">Select party at fault...</option>
                      <option value={caseFile.borrower?._id}>
                        Borrower ({caseFile.borrower?.name})
                      </option>
                      <option value={caseFile.lender?._id}>Lender ({caseFile.lender?.name})</option>
                    </select>
                  </div>
                )}

                {/* Borrower Account Action if Frozen */}
                {caseFile.borrower?.status === 'frozen' && (
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">
                      Borrower Account Action:
                    </label>
                    <select
                      value={borrowerAccountAction}
                      onChange={(e) => setBorrowerAccountAction(e.target.value)}
                      className="w-full border border-slate-300 rounded px-2.5 py-1.5 bg-white outline-none focus:border-teal-600"
                    >
                      <option value="keep_frozen">Keep Frozen</option>
                      <option value="unfreeze">Unfreeze Account</option>
                    </select>
                  </div>
                )}

                {/* Public Note (min 20 chars) */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="font-bold text-slate-700">Public Decision Note:</label>
                    <span
                      className={`text-[10px] ${
                        note.trim().length >= 20 ? 'text-emerald-600 font-bold' : 'text-slate-400'
                      }`}
                    >
                      {note.trim().length} / 20 min chars
                    </span>
                  </div>
                  <textarea
                    rows={3}
                    required
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Provide a clear, detailed reason visible to both borrower and lender..."
                    className="w-full border border-slate-300 rounded p-2 outline-none focus:border-teal-600"
                  />
                </div>

                {/* Internal Staff Note */}
                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    Internal Note (Staff Only):
                  </label>
                  <textarea
                    rows={2}
                    value={internalNote}
                    onChange={(e) => setInternalNote(e.target.value)}
                    placeholder="Confidential notes for care agents and audit..."
                    className="w-full border border-slate-300 rounded p-2 outline-none focus:border-teal-600"
                  />
                </div>

                {/* Live Ledger Preview Table */}
                <div className="border border-slate-200 rounded p-3 bg-slate-50 space-y-2">
                  <div className="flex items-center justify-between font-bold text-slate-800">
                    <span>Live Ledger Preview (Double-Entry Zero Sum)</span>
                    <span className="text-[10px] font-mono text-emerald-700">
                      Balance: ₹{(zeroSumBalance / 100).toFixed(2)}
                    </span>
                  </div>
                  <div className="overflow-x-auto text-[11px] font-mono">
                    <table className="w-full text-left">
                      <thead>
                        <tr className="border-b border-slate-300 text-slate-500">
                          <th className="py-1">Account</th>
                          <th className="py-1">Entry</th>
                          <th className="py-1 text-right">Amount (Demo money)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200">
                        <tr>
                          <td className="py-1 text-slate-600">Escrow</td>
                          <td className="py-1 text-slate-600">Total Booking Debit</td>
                          <td className="py-1 text-right text-red-600 font-semibold">
                            {formatPaise(totalEscrowDebited)}
                          </td>
                        </tr>
                        {rentOutcome === 'lender' && (
                          <>
                            <tr>
                              <td className="py-1 text-slate-600">Lender</td>
                              <td className="py-1 text-slate-600">Rent Payout (85%)</td>
                              <td className="py-1 text-right text-emerald-600">
                                +{formatPaise(rentCommission.payoutPaise)}
                              </td>
                            </tr>
                            <tr>
                              <td className="py-1 text-slate-600">Platform</td>
                              <td className="py-1 text-slate-600">Rent Commission (15%)</td>
                              <td className="py-1 text-right text-teal-700">
                                +{formatPaise(rentCommission.commissionPaise)}
                              </td>
                            </tr>
                          </>
                        )}
                        {appliedLateChargePaise > 0 && (
                          <>
                            <tr>
                              <td className="py-1 text-slate-600">Lender</td>
                              <td className="py-1 text-slate-600">Late Charge Payout (85%)</td>
                              <td className="py-1 text-right text-emerald-600">
                                +{formatPaise(lateChargeCommission.payoutPaise)}
                              </td>
                            </tr>
                            <tr>
                              <td className="py-1 text-slate-600">Platform</td>
                              <td className="py-1 text-slate-600">Late Charge Comm (15%)</td>
                              <td className="py-1 text-right text-teal-700">
                                +{formatPaise(lateChargeCommission.commissionPaise)}
                              </td>
                            </tr>
                          </>
                        )}
                        {depositToLenderPaise > 0 && (
                          <tr>
                            <td className="py-1 text-slate-600">Lender</td>
                            <td className="py-1 text-slate-600">Deposit Compensation (0% comm)</td>
                            <td className="py-1 text-right text-emerald-600">
                              +{formatPaise(depositToLenderPaise)}
                            </td>
                          </tr>
                        )}
                        {depositToBorrowerPaise > 0 && (
                          <tr>
                            <td className="py-1 text-slate-600">Borrower</td>
                            <td className="py-1 text-slate-600">Deposit Refund</td>
                            <td className="py-1 text-right text-blue-600">
                              +{formatPaise(depositToBorrowerPaise)}
                            </td>
                          </tr>
                        )}
                        {rentOutcome === 'refund_borrower' && (
                          <tr>
                            <td className="py-1 text-slate-600">Borrower</td>
                            <td className="py-1 text-slate-600">Full Rent Refund</td>
                            <td className="py-1 text-right text-blue-600">
                              +{formatPaise(rentPaise)}
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>

                  <div className="pt-2 border-t border-slate-300 flex items-center justify-between text-xs font-semibold">
                    <span className="text-slate-600">Zero-Sum Check:</span>
                    <span
                      className={
                        zeroSumBalance === 0
                          ? 'text-emerald-700 font-bold'
                          : 'text-red-600 font-bold'
                      }
                    >
                      {zeroSumBalance === 0
                        ? '✓ Verified: Double-Entry Zero-Sum'
                        : `✗ Imbalance: ${zeroSumBalance} paise`}
                    </span>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={
                    actionLoading ||
                    !isDepositSplitValid ||
                    note.trim().length < 20 ||
                    zeroSumBalance !== 0
                  }
                  className="w-full py-2.5 bg-teal-600 hover:bg-teal-700 text-white font-bold rounded text-xs transition disabled:opacity-50"
                >
                  {actionLoading ? 'Executing Settlement...' : 'Execute Binding Decision'}
                </button>
              </form>
            )}
          </div>
        </div>
      </div>

      {/* Conversation Transcript Modal */}
      {showTranscriptModal && (
        <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center p-4 z-50">
          <div className="max-w-2xl w-full bg-white rounded-lg border border-slate-200 shadow-lg p-5 space-y-4 max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between pb-2 border-b border-slate-200">
              <h3 className="font-bold text-sm text-slate-900">
                Booking Conversation Transcript ({caseFile.messages?.length || 0} messages)
              </h3>
              <button
                type="button"
                onClick={() => setShowTranscriptModal(false)}
                className="text-slate-400 hover:text-slate-700 font-bold text-sm"
              >
                ✕
              </button>
            </div>
            <div className="flex-1 overflow-y-auto space-y-3 p-2 text-xs">
              {(caseFile.messages || []).length === 0 ? (
                <p className="text-slate-400 italic text-center py-4">
                  No chat messages exchanged.
                </p>
              ) : (
                caseFile.messages.map((m) => {
                  const isBorrower = m.senderId === caseFile.borrower?._id;
                  return (
                    <div
                      key={m._id}
                      className={`p-3 rounded-lg max-w-[80%] ${
                        isBorrower
                          ? 'bg-teal-50 border border-teal-100 mr-auto text-teal-950'
                          : 'bg-slate-100 border border-slate-200 ml-auto text-slate-900'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-4 text-[10px] text-slate-500 mb-1">
                        <span className="font-semibold">{isBorrower ? 'Borrower' : 'Lender'}</span>
                        <span>{new Date(m.createdAt).toLocaleTimeString()}</span>
                      </div>
                      <p className="whitespace-pre-wrap">{m.text}</p>
                    </div>
                  );
                })
              )}
            </div>
            <div className="pt-2 border-t border-slate-200 text-right">
              <button
                type="button"
                onClick={() => setShowTranscriptModal(false)}
                className="px-4 py-1.5 text-xs font-semibold bg-slate-100 hover:bg-slate-200 rounded text-slate-800"
              >
                Close Transcript
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default CaseFileView;
