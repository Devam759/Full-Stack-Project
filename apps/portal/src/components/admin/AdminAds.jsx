import React, { useState, useEffect, useCallback } from 'react';
import {
  Power,
  Copy,
  Check,
  AlertTriangle,
  CheckCircle,
  X,
  RefreshCw,
  ShieldAlert,
} from 'lucide-react';
import { generateIdempotencyKey } from '../../utils.js';

export function AdminAds({ token }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  // Master Switch Modal State
  const [showMasterModal, setShowMasterModal] = useState(false);
  const [targetMasterState, setTargetMasterState] = useState(false);
  const [confirmInput, setConfirmInput] = useState('');
  const [clientIdInput, setClientIdInput] = useState('');
  const [masterReason, setMasterReason] = useState('');
  const [masterLoading, setMasterLoading] = useState(false);
  const [masterError, setMasterError] = useState('');
  const [masterSuccess, setMasterSuccess] = useState('');

  // Placement Edit State
  const [editingPlacement, setEditingPlacement] = useState(null);
  const [slotIdInput, setSlotIdInput] = useState('');
  const [placementEnabled, setPlacementEnabled] = useState(false);
  const [placementReason, setPlacementReason] = useState('');
  const [placementLoading, setPlacementLoading] = useState(false);
  const [placementError, setPlacementError] = useState('');
  const [placementSuccess, setPlacementSuccess] = useState('');

  const fetchAdsConfig = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/v1/admin/ads', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(
          json?.message || json?.error?.message || 'Failed to load ads configuration',
        );
      }
      setData(json);
      setClientIdInput(json.clientId || '');
    } catch (err) {
      setError(err.message || 'Error fetching ads configuration');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchAdsConfig();
  }, [fetchAdsConfig]);

  const openMasterModal = (newState) => {
    setTargetMasterState(newState);
    setShowMasterModal(true);
    setConfirmInput('');
    setMasterReason('');
    setMasterError('');
    setMasterSuccess('');
  };

  const handleMasterSubmit = async (e) => {
    e.preventDefault();
    if (targetMasterState && confirmInput !== 'ENABLE_ADS') {
      setMasterError("Confirmation text must exactly match 'ENABLE_ADS'");
      return;
    }
    if (!masterReason || masterReason.trim().length < 10) {
      setMasterError('Reason is required and must be at least 10 characters');
      return;
    }

    setMasterLoading(true);
    setMasterError('');
    setMasterSuccess('');

    try {
      const body = {
        enabled: targetMasterState,
        reason: masterReason.trim(),
      };
      if (targetMasterState) {
        body.confirm = confirmInput;
        if (clientIdInput.trim()) body.clientId = clientIdInput.trim();
      }

      const res = await fetch('/v1/admin/ads/master', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'Idempotency-Key': generateIdempotencyKey('ad-master'),
        },
        body: JSON.stringify(body),
      });

      const json = await res.json();
      if (!res.ok) {
        throw new Error(
          json?.message || json?.error?.message || 'Failed to update master ads toggle',
        );
      }

      setMasterSuccess(
        `Master ads switch successfully turned ${targetMasterState ? 'ON' : 'OFF'}.`,
      );
      setTimeout(() => {
        setShowMasterModal(false);
        fetchAdsConfig();
      }, 1200);
    } catch (err) {
      setMasterError(err.message || 'Error updating master ads switch');
    } finally {
      setMasterLoading(false);
    }
  };

  const openPlacementModal = (p) => {
    setEditingPlacement(p);
    setSlotIdInput(p.adsenseSlotId || '');
    setPlacementEnabled(p.enabled);
    setPlacementReason('');
    setPlacementError('');
    setPlacementSuccess('');
  };

  const handlePlacementSubmit = async (e) => {
    e.preventDefault();
    if (!placementReason || placementReason.trim().length < 10) {
      setPlacementError('Reason is required and must be at least 10 characters');
      return;
    }

    if (slotIdInput.trim() && !/^\d{6,20}$/.test(slotIdInput.trim())) {
      setPlacementError('AdSense Slot ID must be 6-20 digits');
      return;
    }

    setPlacementLoading(true);
    setPlacementError('');
    setPlacementSuccess('');

    try {
      const res = await fetch(`/v1/admin/ads/${editingPlacement.placement}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'Idempotency-Key': generateIdempotencyKey('ad-placement'),
        },
        body: JSON.stringify({
          enabled: placementEnabled,
          adsenseSlotId: slotIdInput.trim() || undefined,
          reason: placementReason.trim(),
        }),
      });

      const json = await res.json();
      if (!res.ok) {
        throw new Error(json?.message || json?.error?.message || 'Failed to update ad placement');
      }

      setPlacementSuccess(`Placement ${editingPlacement.placement} successfully saved.`);
      setTimeout(() => {
        setEditingPlacement(null);
        fetchAdsConfig();
      }, 1200);
    } catch (err) {
      setPlacementError(err.message || 'Error updating placement');
    } finally {
      setPlacementLoading(false);
    }
  };

  const copyScriptSnippet = () => {
    const client = data?.clientId || clientIdInput || 'ca-pub-XXXXXXXXXX';
    const snippet = `<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${client}" crossorigin="anonymous"></script>`;
    navigator.clipboard.writeText(snippet);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-slate-900">
            Advertisements & Monetization Controls
          </h2>
          <p className="text-xs text-slate-500">
            Configure Google AdSense slots, manage placement allowlists, and toggle master platform
            switch
          </p>
        </div>
        <button
          type="button"
          onClick={fetchAdsConfig}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded text-xs font-medium shadow-sm"
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

      {/* Master Switch Banner */}
      <div className="bg-white p-6 rounded-lg border border-slate-200 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div
              className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                data?.masterEnabled
                  ? 'bg-emerald-100 text-emerald-800'
                  : 'bg-slate-100 text-slate-500'
              }`}
            >
              <Power className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-sm text-slate-900">Platform AdSense Master Switch</h3>
                <span
                  className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider ${
                    data?.masterEnabled
                      ? 'bg-emerald-100 text-emerald-800'
                      : 'bg-slate-100 text-slate-700'
                  }`}
                >
                  {data?.masterEnabled ? 'Enabled (ON)' : 'Disabled (OFF)'}
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                {data?.masterEnabled
                  ? 'AdSense scripts and active placements are rendered on public screens for consented users.'
                  : 'Master switch is off. Zero ad scripts are loaded and all placements are hidden platform-wide.'}
              </p>
            </div>
          </div>

          <div>
            {data?.masterEnabled ? (
              <button
                type="button"
                onClick={() => openMasterModal(false)}
                className="px-4 py-2 bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 rounded font-semibold text-xs shadow-sm transition"
              >
                Turn Master Ads OFF
              </button>
            ) : (
              <button
                type="button"
                onClick={() => openMasterModal(true)}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded font-semibold text-xs shadow-sm transition"
              >
                Turn Master Ads ON
              </button>
            )}
          </div>
        </div>

        <div className="pt-3 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-slate-600">AdSense Client ID:</span>
            <span className="font-mono bg-slate-50 px-2 py-0.5 border border-slate-200 rounded text-slate-800">
              {data?.clientId || 'Not configured'}
            </span>
          </div>
          <button
            type="button"
            onClick={copyScriptSnippet}
            className="flex items-center gap-1.5 px-3 py-1 bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200 rounded text-xs font-medium transition self-start sm:self-auto"
          >
            {copied ? (
              <Check className="w-3.5 h-3.5 text-emerald-600" />
            ) : (
              <Copy className="w-3.5 h-3.5" />
            )}
            <span>{copied ? 'Copied Snippet!' : 'Copy AdSense Script Tag'}</span>
          </button>
        </div>
      </div>

      {/* Ad Placements List */}
      <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-100 flex items-center justify-between">
          <h3 className="font-bold text-sm text-slate-900">Placement Slot Configuration</h3>
          <span className="text-xs text-slate-500">Public screens: home, browse, item detail</span>
        </div>

        <div className="divide-y divide-slate-100">
          {(data?.placements || []).map((p) => (
            <div
              key={p.placement}
              className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-slate-50 transition text-xs"
            >
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-slate-900 font-mono text-sm capitalize">
                    {p.placement.replace('_', ' ')}
                  </span>
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider ${
                      p.enabled ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    {p.enabled ? 'Active' : 'Disabled'}
                  </span>
                </div>
                <div className="text-slate-500 flex items-center gap-2">
                  <span>Slot ID:</span>
                  <span className="font-mono font-medium text-slate-800">
                    {p.adsenseSlotId || 'Not set'}
                  </span>
                </div>
                <div className="text-slate-400 text-[11px]">
                  Screens: {(p.pages || []).join(', ')}
                </div>
              </div>

              <div>
                <button
                  type="button"
                  onClick={() => openPlacementModal(p)}
                  className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded font-semibold transition"
                >
                  Configure Placement
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Master Toggle Confirmation Modal */}
      {showMasterModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-md w-full p-6 space-y-4 border border-slate-200 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="font-bold text-sm text-slate-900">
                {targetMasterState
                  ? 'Enable Master AdSense Network'
                  : 'Disable Master AdSense Network'}
              </h3>
              <button
                type="button"
                onClick={() => setShowMasterModal(false)}
                className="text-slate-400 hover:text-slate-700"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {masterError && (
              <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded text-xs">
                {masterError}
              </div>
            )}

            {masterSuccess && (
              <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-700 rounded text-xs flex items-center gap-2">
                <CheckCircle className="w-4 h-4" />
                <span>{masterSuccess}</span>
              </div>
            )}

            <form onSubmit={handleMasterSubmit} className="space-y-4 text-xs">
              {targetMasterState && (
                <>
                  <div className="p-3 bg-amber-50 border border-amber-300 rounded text-amber-900 space-y-2">
                    <p className="font-bold flex items-center gap-1.5">
                      <ShieldAlert className="w-4 h-4 text-amber-700" />
                      <span>Security & Commercial Confirmation</span>
                    </p>
                    <p className="text-[11px] leading-relaxed">
                      Enabling ads will dynamically load Google AdSense script tags across public
                      screens for users who have consented. Type <strong>ENABLE_ADS</strong> below
                      to confirm.
                    </p>
                  </div>

                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">
                      Type &apos;ENABLE_ADS&apos; to confirm
                    </label>
                    <input
                      type="text"
                      required
                      value={confirmInput}
                      onChange={(e) => setConfirmInput(e.target.value)}
                      placeholder="ENABLE_ADS"
                      className="w-full p-2 border border-slate-300 rounded outline-none focus:border-teal-600 font-mono font-bold"
                    />
                  </div>

                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">
                      AdSense Client ID (ca-pub-XXXXXXXXXX)
                    </label>
                    <input
                      type="text"
                      value={clientIdInput}
                      onChange={(e) => setClientIdInput(e.target.value)}
                      placeholder="ca-pub-1234567890123456"
                      className="w-full p-2 border border-slate-300 rounded outline-none focus:border-teal-600 font-mono"
                    />
                  </div>
                </>
              )}

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Required Justification (Audit Log Reason)
                </label>
                <textarea
                  required
                  rows={3}
                  value={masterReason}
                  onChange={(e) => setMasterReason(e.target.value)}
                  placeholder="State the business reason for changing the master ad network state (min 10 characters)..."
                  className="w-full p-2 border border-slate-300 rounded outline-none focus:border-teal-600 font-sans"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowMasterModal(false)}
                  className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={masterLoading}
                  className={`px-4 py-1.5 text-white rounded font-semibold shadow-sm transition disabled:opacity-50 ${
                    targetMasterState
                      ? 'bg-emerald-600 hover:bg-emerald-700'
                      : 'bg-red-600 hover:bg-red-700'
                  }`}
                >
                  {masterLoading ? 'Processing...' : 'Confirm Switch'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Placement Edit Modal */}
      {editingPlacement && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-md w-full p-6 space-y-4 border border-slate-200 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="font-bold text-sm text-slate-900 capitalize">
                Configure Placement: {editingPlacement.placement.replace('_', ' ')}
              </h3>
              <button
                type="button"
                onClick={() => setEditingPlacement(null)}
                className="text-slate-400 hover:text-slate-700"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {placementError && (
              <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded text-xs">
                {placementError}
              </div>
            )}

            {placementSuccess && (
              <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-700 rounded text-xs flex items-center gap-2">
                <CheckCircle className="w-4 h-4" />
                <span>{placementSuccess}</span>
              </div>
            )}

            <form onSubmit={handlePlacementSubmit} className="space-y-4 text-xs">
              <label className="flex items-center gap-2 cursor-pointer font-semibold text-slate-800">
                <input
                  type="checkbox"
                  checked={placementEnabled}
                  onChange={(e) => setPlacementEnabled(e.target.checked)}
                  className="rounded border-slate-300 text-teal-600 focus:ring-teal-500 w-4 h-4"
                />
                <span>Enable this Ad Placement</span>
              </label>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  AdSense Slot ID (6-20 Digits)
                </label>
                <input
                  type="text"
                  value={slotIdInput}
                  onChange={(e) => setSlotIdInput(e.target.value)}
                  placeholder="e.g. 1234567890"
                  className="w-full p-2 border border-slate-300 rounded outline-none focus:border-teal-600 font-mono"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Required Justification (Audit Log Reason)
                </label>
                <textarea
                  required
                  rows={3}
                  value={placementReason}
                  onChange={(e) => setPlacementReason(e.target.value)}
                  placeholder="Justification for updating placement settings (min 10 characters)..."
                  className="w-full p-2 border border-slate-300 rounded outline-none focus:border-teal-600 font-sans"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setEditingPlacement(null)}
                  className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={placementLoading}
                  className="px-4 py-1.5 bg-teal-600 hover:bg-teal-700 text-white rounded font-semibold shadow-sm transition disabled:opacity-50"
                >
                  {placementLoading ? 'Saving...' : 'Save Placement'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default AdminAds;
