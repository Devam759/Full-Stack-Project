import React, { useState, useEffect, useCallback } from 'react';
import { Search, AlertTriangle, X, RefreshCw } from 'lucide-react';
import { formatPaise, generateIdempotencyKey, maskEmail } from '../../utils.js';

export function AdminUsers({ token }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Filters
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [nextCursor, setNextCursor] = useState(null);

  // Active Modals: 'inspect' | 'ban' | 'unban' | 'reverse-strike' | null
  const [modalType, setModalType] = useState(null);
  const [selectedUser, setSelectedUser] = useState(null);
  const [userDetails, setUserDetails] = useState(null);
  const [detailsLoading, setDetailsLoading] = useState(false);

  // Action Form State
  const [reason, setReason] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState('');
  const [actionSuccess, setActionSuccess] = useState('');

  const fetchUsers = useCallback(
    async (cursor = null) => {
      setLoading(true);
      setError('');
      try {
        const params = new URLSearchParams();
        if (search.trim()) params.append('q', search.trim());
        if (roleFilter !== 'all') params.append('role', roleFilter);
        if (statusFilter !== 'all') params.append('status', statusFilter);
        if (cursor) params.append('cursor', cursor);
        params.append('limit', '20');

        const res = await fetch(`/v1/admin/users?${params.toString()}`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data?.message || data?.error?.message || 'Failed to load users');
        }
        setUsers(data.users || []);
        setNextCursor(data.nextCursor || null);
      } catch (err) {
        setError(err.message || 'Error fetching users list');
      } finally {
        setLoading(false);
      }
    },
    [search, roleFilter, statusFilter, token],
  );

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const openInspectModal = async (user) => {
    setSelectedUser(user);
    setModalType('inspect');
    setUserDetails(null);
    setDetailsLoading(true);
    setActionError('');
    try {
      const res = await fetch(`/v1/admin/users/${user._id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.message || data?.error?.message || 'Failed to inspect user');
      }
      setUserDetails(data.user);
    } catch (err) {
      setActionError(err.message || 'Error loading user details');
    } finally {
      setDetailsLoading(false);
    }
  };

  const openActionModal = (type, user) => {
    setSelectedUser(user);
    setModalType(type);
    setReason('');
    setActionError('');
    setActionSuccess('');
  };

  const closeModal = () => {
    setModalType(null);
    setSelectedUser(null);
    setUserDetails(null);
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
      let endpoint = '';
      if (modalType === 'ban') endpoint = `/v1/admin/users/${selectedUser._id}/ban`;
      if (modalType === 'unban') endpoint = `/v1/admin/users/${selectedUser._id}/unban`;
      if (modalType === 'reverse-strike')
        endpoint = `/v1/admin/users/${selectedUser._id}/reverse-strike`;

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'Idempotency-Key': generateIdempotencyKey(modalType),
        },
        body: JSON.stringify({ reason: reason.trim() }),
      });

      const data = await res.json();
      if (!res.ok) {
        if (data?.error?.code === 'USER_HAS_ACTIVE_BOOKINGS') {
          const bookings = data.error.details?.activeBookings?.join(', ') || 'in-progress bookings';
          throw new Error(
            `Cannot ban user: User has active booking(s) [${bookings}]. Items must not be stranded.`,
          );
        }
        throw new Error(data?.message || data?.error?.message || `Failed to execute ${modalType}`);
      }

      setActionSuccess(`Successfully completed ${modalType} action.`);
      setTimeout(() => {
        closeModal();
        fetchUsers();
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
          <h2 className="text-lg font-bold text-slate-900">User Moderation & Enforcement</h2>
          <p className="text-xs text-slate-500">
            Search users by email, manage bans, and inspect active records
          </p>
        </div>
        <button
          type="button"
          onClick={() => fetchUsers()}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded text-xs font-medium self-start sm:self-auto shadow-sm"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>Refresh</span>
        </button>
      </div>

      {/* Filter Toolbar */}
      <div className="bg-white p-4 rounded-lg border border-slate-200 shadow-sm flex flex-col md:flex-row gap-3">
        <div className="flex-1 relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by full email (e.g. user@example.com)..."
            className="w-full text-xs pl-9 pr-3 py-2 border border-slate-300 rounded outline-none focus:border-teal-600"
          />
        </div>

        <div className="flex gap-2">
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            className="text-xs px-3 py-2 border border-slate-300 rounded outline-none focus:border-teal-600 bg-white"
          >
            <option value="all">All Roles</option>
            <option value="user">User</option>
            <option value="care_agent">Care Agent</option>
            <option value="admin">Admin</option>
          </select>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="text-xs px-3 py-2 border border-slate-300 rounded outline-none focus:border-teal-600 bg-white"
          >
            <option value="all">All Statuses</option>
            <option value="active">Active</option>
            <option value="frozen">Frozen</option>
            <option value="banned">Banned</option>
          </select>
        </div>
      </div>

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded text-xs flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Users Table */}
      <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                <th className="p-3">User</th>
                <th className="p-3">Role</th>
                <th className="p-3">Status</th>
                <th className="p-3 text-center">Strikes</th>
                <th className="p-3 text-center">Trust Score</th>
                <th className="p-3">Joined</th>
                <th className="p-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {users.map((u) => (
                <tr key={u._id} className="hover:bg-slate-50 transition">
                  <td className="p-3">
                    <div className="font-semibold text-slate-900">{u.name}</div>
                    <div className="text-slate-500 font-mono text-[11px]">{maskEmail(u.email)}</div>
                  </td>
                  <td className="p-3">
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider ${
                        u.role === 'admin'
                          ? 'bg-purple-100 text-purple-800'
                          : u.role === 'care_agent'
                            ? 'bg-blue-100 text-blue-800'
                            : 'bg-slate-100 text-slate-700'
                      }`}
                    >
                      {u.role}
                    </span>
                  </td>
                  <td className="p-3">
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider ${
                        u.status === 'active'
                          ? 'bg-emerald-100 text-emerald-800'
                          : u.status === 'frozen'
                            ? 'bg-amber-100 text-amber-800'
                            : 'bg-red-100 text-red-800'
                      }`}
                    >
                      {u.status}
                    </span>
                  </td>
                  <td className="p-3 text-center font-bold text-slate-800">{u.strikes ?? 0}</td>
                  <td className="p-3 text-center font-bold text-slate-800">{u.trustScore ?? 50}</td>
                  <td className="p-3 text-slate-500">
                    {new Date(u.createdAt).toLocaleDateString()}
                  </td>
                  <td className="p-3 text-right space-x-1">
                    <button
                      type="button"
                      onClick={() => openInspectModal(u)}
                      className="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded font-medium text-[11px]"
                    >
                      Inspect
                    </button>
                    {u.status !== 'banned' ? (
                      <button
                        type="button"
                        onClick={() => openActionModal('ban', u)}
                        disabled={u.role === 'admin' || u.role === 'care_agent'}
                        className="px-2 py-1 bg-red-50 hover:bg-red-100 text-red-700 rounded font-medium text-[11px] disabled:opacity-30"
                      >
                        Ban
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => openActionModal('unban', u)}
                        className="px-2 py-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded font-medium text-[11px]"
                      >
                        Unban
                      </button>
                    )}
                    {u.strikes > 0 && (
                      <button
                        type="button"
                        onClick={() => openActionModal('reverse-strike', u)}
                        className="px-2 py-1 bg-amber-50 hover:bg-amber-100 text-amber-700 rounded font-medium text-[11px]"
                      >
                        Reverse Strike
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {users.length === 0 && !loading && (
                <tr>
                  <td colSpan={7} className="p-6 text-center text-slate-500">
                    No users matching criteria.
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
              onClick={() => fetchUsers(nextCursor)}
              disabled={loading}
              className="px-4 py-1.5 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded text-xs font-medium"
            >
              {loading ? 'Loading...' : 'Load Next Page'}
            </button>
          </div>
        )}
      </div>

      {/* Inspect User Modal */}
      {modalType === 'inspect' && selectedUser && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-lg w-full p-6 space-y-4 border border-slate-200 shadow-lg">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="font-bold text-sm text-slate-900">User Audit & Financial Details</h3>
              <button
                type="button"
                onClick={closeModal}
                className="text-slate-400 hover:text-slate-700"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {detailsLoading ? (
              <div className="py-8 text-center text-xs text-slate-500">Loading user file...</div>
            ) : actionError ? (
              <div className="p-3 bg-red-50 text-red-700 rounded text-xs">{actionError}</div>
            ) : userDetails ? (
              <div className="space-y-4 text-xs">
                <div className="grid grid-cols-2 gap-3 bg-slate-50 p-3 rounded border border-slate-200">
                  <div>
                    <span className="text-slate-500 block">Masked Email</span>
                    <span className="font-mono font-semibold text-slate-900">
                      {maskEmail(userDetails.email)}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Trust Score / Strikes</span>
                    <span className="font-semibold text-slate-900">
                      Score: {userDetails.trustScore ?? 50} • Strikes: {userDetails.strikes ?? 0}
                    </span>
                  </div>
                </div>

                <div className="bg-slate-50 p-3 rounded border border-slate-200 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-slate-700">Wallet Balances</span>
                    <span className="text-[10px] font-bold text-amber-700">Demo money</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="bg-white p-2 rounded border border-slate-200">
                      <span className="text-slate-500 block">Available</span>
                      <span className="font-bold text-slate-900">
                        {formatPaise(userDetails.wallet?.availablePaise || 0)}
                      </span>
                    </div>
                    <div className="bg-white p-2 rounded border border-slate-200">
                      <span className="text-slate-500 block">Frozen (Escrow)</span>
                      <span className="font-bold text-indigo-700">
                        {formatPaise(userDetails.wallet?.frozenPaise || 0)}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="bg-slate-50 p-3 rounded border border-slate-200 space-y-1">
                  <span className="font-semibold text-slate-700 block">Active Bookings Status</span>
                  <p className="text-slate-600">
                    Active in-progress bookings (picked_up, returned, disputed):{' '}
                    <strong className="text-slate-900">
                      {userDetails.activeBookingsCount ?? 0}
                    </strong>
                  </p>
                  {userDetails.activeBookingsCount > 0 && (
                    <p className="text-amber-700 text-[11px]">
                      Notice: User cannot be banned while participating in active bookings.
                    </p>
                  )}
                </div>
              </div>
            ) : null}

            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={closeModal}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded text-xs font-semibold"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Action Confirmation Modal (Ban, Unban, Reverse Strike) */}
      {modalType && modalType !== 'inspect' && selectedUser && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-md w-full p-6 space-y-4 border border-slate-200 shadow-lg">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="font-bold text-sm text-slate-900 capitalize">
                {modalType.replace('-', ' ')}: {selectedUser.name}
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
              {modalType === 'ban' && (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded text-amber-800 space-y-1">
                  <p className="font-semibold">Account Ban Consequences:</p>
                  <ul className="list-disc list-inside space-y-0.5 text-[11px] text-amber-700">
                    <li>Pending bookings will be cancelled</li>
                    <li>Accepted bookings will be refunded to borrower</li>
                    <li>All listed items will be hidden (owner_banned)</li>
                    <li>Session tokens revoked and sockets disconnected</li>
                  </ul>
                </div>
              )}

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Required Justification (Audit Log Reason)
                </label>
                <textarea
                  required
                  rows={3}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="State the regulatory or operational reason for this action (min 10 characters)..."
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
                    modalType === 'ban'
                      ? 'bg-red-600 hover:bg-red-700'
                      : 'bg-teal-600 hover:bg-teal-700'
                  }`}
                >
                  {actionLoading ? 'Executing...' : 'Confirm Action'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default AdminUsers;
