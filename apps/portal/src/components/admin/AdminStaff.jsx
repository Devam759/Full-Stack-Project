import React, { useState, useEffect, useCallback } from 'react';
import { UserPlus, AlertTriangle, CheckCircle, X, RefreshCw, Lock } from 'lucide-react';
import { generateIdempotencyKey, maskEmail } from '../../utils.js';

export function AdminStaff({ token }) {
  const [agents, setAgents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Modals: 'promote' | 'demote' | null
  const [modalType, setModalType] = useState(null);
  const [selectedAgent, setSelectedAgent] = useState(null);

  // Form State
  const [promoteUserId, setPromoteUserId] = useState('');
  const [reason, setReason] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState('');
  const [actionSuccess, setActionSuccess] = useState('');
  const [inviteResult, setInviteResult] = useState(null);

  const fetchAgents = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/v1/admin/agents', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.message || data?.error?.message || 'Failed to load staff list');
      }
      setAgents(data.agents || []);
    } catch (err) {
      setError(err.message || 'Error fetching staff agents');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchAgents();
  }, [fetchAgents]);

  const openPromoteModal = () => {
    setModalType('promote');
    setSelectedAgent(null);
    setPromoteUserId('');
    setReason('');
    setActionError('');
    setActionSuccess('');
    setInviteResult(null);
  };

  const openDemoteModal = (agent) => {
    setModalType('demote');
    setSelectedAgent(agent);
    setReason('');
    setActionError('');
    setActionSuccess('');
    setInviteResult(null);
  };

  const closeModal = () => {
    setModalType(null);
    setSelectedAgent(null);
    setPromoteUserId('');
    setReason('');
    setActionError('');
    setActionSuccess('');
    setInviteResult(null);
  };

  const handlePromoteSubmit = async (e) => {
    e.preventDefault();
    if (!promoteUserId.trim()) {
      setActionError('User ID is required');
      return;
    }
    if (!reason || reason.trim().length < 10) {
      setActionError('Reason is required and must be at least 10 characters');
      return;
    }

    setActionLoading(true);
    setActionError('');
    setActionSuccess('');
    setInviteResult(null);

    try {
      const res = await fetch('/v1/admin/agents', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'Idempotency-Key': generateIdempotencyKey('agent-promote'),
        },
        body: JSON.stringify({
          userId: promoteUserId.trim(),
          reason: reason.trim(),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.message || data?.error?.message || 'Failed to promote user to agent');
      }

      setInviteResult(data);
      setActionSuccess('User successfully promoted to Care Agent.');
      fetchAgents();
    } catch (err) {
      setActionError(err.message || 'Error promoting user');
    } finally {
      setActionLoading(false);
    }
  };

  const handleDemoteSubmit = async (e) => {
    e.preventDefault();
    if (!reason || reason.trim().length < 10) {
      setActionError('Reason is required and must be at least 10 characters');
      return;
    }

    setActionLoading(true);
    setActionError('');
    setActionSuccess('');

    try {
      const res = await fetch(`/v1/admin/agents/${selectedAgent._id}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'Idempotency-Key': generateIdempotencyKey('agent-demote'),
        },
        body: JSON.stringify({
          reason: reason.trim(),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.message || data?.error?.message || 'Failed to demote agent');
      }

      setActionSuccess('Agent successfully demoted to standard user.');
      setTimeout(() => {
        closeModal();
        fetchAgents();
      }, 1200);
    } catch (err) {
      setActionError(err.message || 'Error demoting agent');
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-slate-900">Staff & Care Agent Management</h2>
          <p className="text-xs text-slate-500">
            Promote verified users to care agents, manage credentials, and handle demotions
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={openPromoteModal}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-teal-600 hover:bg-teal-700 text-white rounded text-xs font-semibold shadow-sm transition"
          >
            <UserPlus className="w-3.5 h-3.5" />
            <span>Promote New Agent</span>
          </button>
          <button
            type="button"
            onClick={fetchAgents}
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

      {/* Agents Table */}
      <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                <th className="p-3">Staff Member</th>
                <th className="p-3">Role</th>
                <th className="p-3">Email Verified</th>
                <th className="p-3">2FA Enrollment</th>
                <th className="p-3">Joined Staff</th>
                <th className="p-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {agents.map((a) => (
                <tr key={a._id} className="hover:bg-slate-50 transition">
                  <td className="p-3">
                    <div className="font-semibold text-slate-900">{a.name}</div>
                    <div className="text-slate-500 font-mono text-[11px]">{maskEmail(a.email)}</div>
                  </td>
                  <td className="p-3">
                    <span className="px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider bg-blue-100 text-blue-800">
                      {a.role}
                    </span>
                  </td>
                  <td className="p-3">
                    {a.emailVerified ? (
                      <span className="text-emerald-700 font-medium flex items-center gap-1">
                        <CheckCircle className="w-3.5 h-3.5" />
                        <span>Verified</span>
                      </span>
                    ) : (
                      <span className="text-amber-700 font-medium">Pending</span>
                    )}
                  </td>
                  <td className="p-3">
                    {a.totpConfigured ? (
                      <span className="text-emerald-700 font-medium flex items-center gap-1">
                        <Lock className="w-3.5 h-3.5" />
                        <span>Configured</span>
                      </span>
                    ) : (
                      <span className="text-slate-500 font-medium">Invite Sent</span>
                    )}
                  </td>
                  <td className="p-3 text-slate-500">
                    {new Date(a.createdAt).toLocaleDateString()}
                  </td>
                  <td className="p-3 text-right">
                    <button
                      type="button"
                      onClick={() => openDemoteModal(a)}
                      className="px-2.5 py-1 bg-red-50 hover:bg-red-100 text-red-700 rounded font-medium text-[11px]"
                    >
                      Demote to User
                    </button>
                  </td>
                </tr>
              ))}
              {agents.length === 0 && !loading && (
                <tr>
                  <td colSpan={6} className="p-6 text-center text-slate-500">
                    No care agents registered yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Promote Agent Modal */}
      {modalType === 'promote' && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-md w-full p-6 space-y-4 border border-slate-200 shadow-lg">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="font-bold text-sm text-slate-900">Promote User to Care Agent</h3>
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
              <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-700 rounded text-xs space-y-2">
                <div className="flex items-center gap-1.5 font-semibold">
                  <CheckCircle className="w-4 h-4" />
                  <span>{actionSuccess}</span>
                </div>
                {inviteResult && (
                  <div className="p-2.5 bg-white border border-emerald-300 rounded text-[11px] text-slate-700 space-y-1">
                    <p className="font-medium text-slate-900">Security Guarantee:</p>
                    <p>
                      The TOTP 2FA enrollment link has been securely emailed to the agent. For
                      zero-trust compliance, the secret is never displayed to admins.
                    </p>
                  </div>
                )}
              </div>
            )}

            {!actionSuccess && (
              <form onSubmit={handlePromoteSubmit} className="space-y-4 text-xs">
                <div className="p-3 bg-blue-50 border border-blue-200 rounded text-blue-900 space-y-1">
                  <p className="font-semibold">Promotion Requirements:</p>
                  <ul className="list-disc list-inside space-y-0.5 text-[11px] text-blue-800">
                    <li>Target user must be active with a verified email</li>
                    <li>User cannot already be an agent or admin</li>
                    <li>A secure TOTP enrollment link will be emailed to them</li>
                  </ul>
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Target User MongoDB ID
                  </label>
                  <input
                    type="text"
                    required
                    value={promoteUserId}
                    onChange={(e) => setPromoteUserId(e.target.value)}
                    placeholder="e.g. 64b8a1c92f1a9b2c3d4e5f60"
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
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Reason for granting customer care credentials (min 10 characters)..."
                    className="w-full p-2 border border-slate-300 rounded outline-none focus:border-teal-600 font-sans"
                  />
                </div>

                <div className="flex justify-end gap-2 pt-2">
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
                    className="px-4 py-1.5 bg-teal-600 hover:bg-teal-700 text-white rounded font-semibold transition disabled:opacity-50"
                  >
                    {actionLoading ? 'Promoting...' : 'Promote Agent'}
                  </button>
                </div>
              </form>
            )}

            {actionSuccess && (
              <div className="flex justify-end pt-2">
                <button
                  type="button"
                  onClick={closeModal}
                  className="px-4 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded font-semibold text-xs"
                >
                  Close
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Demote Agent Modal */}
      {modalType === 'demote' && selectedAgent && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-md w-full p-6 space-y-4 border border-slate-200 shadow-lg">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="font-bold text-sm text-slate-900">
                Demote Staff Agent: {selectedAgent.name}
              </h3>
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
              <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-700 rounded text-xs">
                {actionSuccess}
              </div>
            )}

            <form onSubmit={handleDemoteSubmit} className="space-y-4 text-xs">
              <div className="p-3 bg-amber-50 border border-amber-200 rounded text-amber-800 space-y-1">
                <p className="font-semibold">Demotion Consequences:</p>
                <ul className="list-disc list-inside space-y-0.5 text-[11px] text-amber-700">
                  <li>Resets agent role back to regular user</li>
                  <li>Clears stored TOTP credentials</li>
                  <li>Revokes active refresh tokens</li>
                  <li>
                    Unassigns any open disputes assigned to this agent back to &apos;opened&apos;
                  </li>
                </ul>
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
                  placeholder="Reason for revoking care agent privileges (min 10 characters)..."
                  className="w-full p-2 border border-slate-300 rounded outline-none focus:border-teal-600 font-sans"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
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
                  className="px-4 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded font-semibold transition disabled:opacity-50"
                >
                  {actionLoading ? 'Demoting...' : 'Confirm Demotion'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default AdminStaff;
