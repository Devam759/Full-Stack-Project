import React, { useState, useEffect, useCallback } from 'react';
import { AlertTriangle, X, RefreshCw, Building } from 'lucide-react';
import { generateIdempotencyKey } from '../../utils.js';

export function AdminCommunities({ token }) {
  const [communities, setCommunities] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [nextCursor, setNextCursor] = useState(null);

  // Modal State: 'suspend' | 'restore' | null
  const [modalType, setModalType] = useState(null);
  const [selectedCommunity, setSelectedCommunity] = useState(null);
  const [reason, setReason] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState('');
  const [actionSuccess, setActionSuccess] = useState('');

  const fetchCommunities = useCallback(
    async (cursor = null) => {
      setLoading(true);
      setError('');
      try {
        const params = new URLSearchParams();
        if (statusFilter !== 'all') params.append('status', statusFilter);
        if (cursor) params.append('cursor', cursor);
        params.append('limit', '20');

        const res = await fetch(`/v1/admin/communities?${params.toString()}`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data?.message || data?.error?.message || 'Failed to load communities');
        }
        setCommunities(data.communities || []);
        setNextCursor(data.nextCursor || null);
      } catch (err) {
        setError(err.message || 'Error fetching communities');
      } finally {
        setLoading(false);
      }
    },
    [statusFilter, token],
  );

  useEffect(() => {
    fetchCommunities();
  }, [fetchCommunities]);

  const openActionModal = (type, community) => {
    setSelectedCommunity(community);
    setModalType(type);
    setReason('');
    setActionError('');
    setActionSuccess('');
  };

  const closeModal = () => {
    setModalType(null);
    setSelectedCommunity(null);
    setReason('');
    setActionError('');
    setActionSuccess('');
  };

  const handleActionSubmit = async (e) => {
    e.preventDefault();
    if (!reason || reason.trim().length < 10) {
      setActionError('Reason is required and must be at least 10 characters');
      return;
    }

    setActionLoading(true);
    setActionError('');
    setActionSuccess('');

    try {
      const endpoint = `/v1/admin/communities/${selectedCommunity._id}/${modalType}`;
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'Idempotency-Key': generateIdempotencyKey(`community-${modalType}`),
        },
        body: JSON.stringify({ reason: reason.trim() }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(
          data?.message || data?.error?.message || `Failed to ${modalType} community`,
        );
      }

      setActionSuccess(
        `Successfully ${modalType === 'suspend' ? 'suspended' : 'restored'} community.`,
      );
      setTimeout(() => {
        closeModal();
        fetchCommunities();
      }, 1200);
    } catch (err) {
      setActionError(err.message || `Error executing ${modalType}`);
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-slate-900">Community Moderation</h2>
          <p className="text-xs text-slate-500">
            Moderate community circles, view membership counts, and manage suspensions
          </p>
        </div>
        <button
          type="button"
          onClick={() => fetchCommunities()}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded text-xs font-medium shadow-sm"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>Refresh</span>
        </button>
      </div>

      <div className="bg-white p-4 rounded-lg border border-slate-200 shadow-sm flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Building className="w-4 h-4 text-slate-400" />
          <span className="text-xs font-semibold text-slate-700">Filter by Status:</span>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="text-xs px-3 py-1.5 border border-slate-300 rounded outline-none focus:border-teal-600 bg-white"
          >
            <option value="all">All Communities</option>
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
          </select>
        </div>
      </div>

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded text-xs flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Communities Table */}
      <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                <th className="p-3">Community</th>
                <th className="p-3">Type</th>
                <th className="p-3">City</th>
                <th className="p-3">Status</th>
                <th className="p-3 text-center">Members</th>
                <th className="p-3">Created</th>
                <th className="p-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {communities.map((c) => (
                <tr key={c._id} className="hover:bg-slate-50 transition">
                  <td className="p-3">
                    <div className="font-semibold text-slate-900">{c.name}</div>
                    <div className="text-slate-500 font-mono text-[11px]">/{c.slug}</div>
                  </td>
                  <td className="p-3 uppercase text-slate-700 font-medium text-[11px]">{c.type}</td>
                  <td className="p-3 text-slate-700">{c.city || '—'}</td>
                  <td className="p-3">
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider ${
                        c.status === 'active'
                          ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-red-100 text-red-800'
                      }`}
                    >
                      {c.status}
                    </span>
                  </td>
                  <td className="p-3 text-center font-bold text-slate-800">{c.memberCount ?? 0}</td>
                  <td className="p-3 text-slate-500">
                    {new Date(c.createdAt).toLocaleDateString()}
                  </td>
                  <td className="p-3 text-right">
                    {c.status !== 'suspended' ? (
                      <button
                        type="button"
                        onClick={() => openActionModal('suspend', c)}
                        className="px-2.5 py-1 bg-red-50 hover:bg-red-100 text-red-700 rounded font-medium text-[11px]"
                      >
                        Suspend
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => openActionModal('restore', c)}
                        className="px-2.5 py-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded font-medium text-[11px]"
                      >
                        Restore
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {communities.length === 0 && !loading && (
                <tr>
                  <td colSpan={7} className="p-6 text-center text-slate-500">
                    No communities found matching filter.
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
              onClick={() => fetchCommunities(nextCursor)}
              disabled={loading}
              className="px-4 py-1.5 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded text-xs font-medium"
            >
              {loading ? 'Loading...' : 'Load Next Page'}
            </button>
          </div>
        )}
      </div>

      {/* Action Modal */}
      {modalType && selectedCommunity && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-md w-full p-6 space-y-4 border border-slate-200 shadow-lg">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="font-bold text-sm text-slate-900 capitalize">
                {modalType} Community: {selectedCommunity.name}
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

            <form onSubmit={handleActionSubmit} className="space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Required Justification (Audit Log Reason)
                </label>
                <textarea
                  required
                  rows={3}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="State the reason for this action (min 10 characters)..."
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
                  className={`px-4 py-1.5 text-white rounded font-semibold transition disabled:opacity-50 ${
                    modalType === 'suspend'
                      ? 'bg-red-600 hover:bg-red-700'
                      : 'bg-teal-600 hover:bg-teal-700'
                  }`}
                >
                  {actionLoading ? 'Executing...' : 'Confirm'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default AdminCommunities;
