import React, { useState, useEffect, useCallback } from 'react';
import {
  ArrowLeft,
  Users,
  Globe,
  Lock,
  KeyRound,
  ShieldCheck,
  Check,
  X,
  LogOut,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { apiRequest } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { MapArea } from '../components/MapArea.jsx';

export function CommunityDetailScreen({ communityId, onBack }) {
  const { user } = useAuth();
  const [community, setCommunity] = useState(null);
  const [members, setMembers] = useState([]);
  const [requests, setRequests] = useState([]);
  const [activeTab, setActiveTab] = useState('overview'); // overview, members, requests
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionLoading, setActionLoading] = useState(false);

  // Invite code input dialog
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inputInviteCode, setInputInviteCode] = useState('');

  // Transfer ownership dialog
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [newOwnerId, setNewOwnerId] = useState('');

  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await apiRequest(`/communities/${communityId}`);
      setCommunity(data.community);

      if (data.community.membershipStatus === 'active') {
        const memRes = await apiRequest(`/communities/${communityId}/members`).catch(() => ({}));
        setMembers(memRes.members || []);

        if (data.community.userRole === 'owner') {
          const reqRes = await apiRequest(`/communities/${communityId}/requests`).catch(() => ({}));
          setRequests(reqRes.requests || []);
        }
      }
    } catch (err) {
      setError(err.message || 'Failed to load community details');
    } finally {
      setLoading(false);
    }
  }, [communityId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleJoin = async (inviteCodeToUse) => {
    setActionLoading(true);
    try {
      await apiRequest(`/communities/${communityId}/join`, {
        method: 'POST',
        body: JSON.stringify({ inviteCode: inviteCodeToUse }),
      });
      setShowInviteModal(false);
      setInputInviteCode('');
      await loadData();
    } catch (err) {
      alert(err.message || 'Failed to join community');
    } finally {
      setActionLoading(false);
    }
  };

  const handleLeave = async () => {
    if (!confirm('Are you sure you want to leave this community?')) return;
    setActionLoading(true);
    try {
      await apiRequest(`/communities/${communityId}/join`, { method: 'DELETE' });
      await loadData();
    } catch (err) {
      alert(err.message || 'Failed to leave community');
    } finally {
      setActionLoading(false);
    }
  };

  const handleCancelRequest = async () => {
    setActionLoading(true);
    try {
      await apiRequest(`/communities/${communityId}/requests/me`, { method: 'DELETE' });
      await loadData();
    } catch (err) {
      alert(err.message || 'Failed to cancel request');
    } finally {
      setActionLoading(false);
    }
  };

  const handleApprove = async (userId) => {
    try {
      await apiRequest(`/communities/${communityId}/requests/${userId}/approve`, {
        method: 'POST',
      });
      setRequests(requests.filter((r) => r.user._id !== userId));
      await loadData();
    } catch (err) {
      alert(err.message || 'Failed to approve request');
    }
  };

  const handleReject = async (userId) => {
    try {
      await apiRequest(`/communities/${communityId}/requests/${userId}/reject`, { method: 'POST' });
      setRequests(requests.filter((r) => r.user._id !== userId));
    } catch (err) {
      alert(err.message || 'Failed to reject request');
    }
  };

  const handleRemoveMember = async (userId) => {
    if (!confirm('Remove this member from the community? They will be blocked from re-joining.'))
      return;
    try {
      await apiRequest(`/communities/${communityId}/members/${userId}`, { method: 'DELETE' });
      setMembers(members.filter((m) => m.userId !== userId));
      await loadData();
    } catch (err) {
      alert(err.message || 'Failed to remove member');
    }
  };

  const handleRegenerateCode = async () => {
    try {
      const data = await apiRequest(`/communities/${communityId}/invite-code`, { method: 'POST' });
      setCommunity({ ...community, inviteCode: data.inviteCode });
      alert('Invite code regenerated!');
    } catch (err) {
      alert(err.message || 'Failed to regenerate code');
    }
  };

  const handleTransfer = async () => {
    if (!newOwnerId) return;
    try {
      await apiRequest(`/communities/${communityId}/transfer-owner`, {
        method: 'POST',
        body: JSON.stringify({ newOwnerId }),
      });
      setShowTransferModal(false);
      await loadData();
    } catch (err) {
      alert(err.message || 'Failed to transfer ownership');
    }
  };

  const handleDeleteCommunity = async () => {
    if (!confirm('Are you sure you want to delete this community? This cannot be undone.')) return;
    try {
      await apiRequest(`/communities/${communityId}`, { method: 'DELETE' });
      onBack();
    } catch (err) {
      alert(err.message || 'Failed to delete community');
    }
  };

  if (loading) {
    return <div className="p-8 text-center text-xs text-text-muted">Loading community...</div>;
  }

  if (error || !community) {
    return (
      <div className="p-4 space-y-3">
        <button
          onClick={onBack}
          className="text-xs text-primary flex items-center gap-1 font-medium"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Back
        </button>
        <div className="p-3 bg-red-50 text-red-700 text-xs rounded-brand border border-red-200">
          {error || 'Community not found'}
        </div>
      </div>
    );
  }

  const isMember = community.membershipStatus === 'active';
  const isOwner = community.userRole === 'owner';
  const isPending = community.membershipStatus === 'pending';

  return (
    <div className="max-w-md mx-auto p-4 space-y-4 pb-24">
      {/* Top Bar */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={onBack}
          className="text-xs text-slate-600 hover:text-slate-900 flex items-center gap-1 font-medium"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Back</span>
        </button>

        {isOwner && (
          <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-teal-100 text-teal-800">
            Community Owner
          </span>
        )}
      </div>

      {/* Main Info Card */}
      <div className="bg-surface rounded-brand border border-slate-200 p-5 shadow-sm space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-lg font-heading font-bold text-slate-900 leading-tight">
              {community.name}
            </h1>
            <p className="text-xs text-text-muted mt-0.5">{community.city}</p>
          </div>

          <span
            className={`px-2 py-0.5 rounded-full text-[10px] font-semibold flex items-center gap-1 shrink-0 ${
              community.type === 'public'
                ? 'bg-blue-50 text-blue-700 border border-blue-200'
                : 'bg-purple-50 text-purple-700 border border-purple-200'
            }`}
          >
            {community.type === 'public' ? (
              <Globe className="w-3 h-3" />
            ) : (
              <Lock className="w-3 h-3" />
            )}
            <span className="capitalize">{community.type}</span>
          </span>
        </div>

        <div className="flex items-center gap-4 text-xs text-text-muted pt-1">
          <div className="flex items-center gap-1.5">
            <Users className="w-4 h-4 text-slate-400" />
            <span className="font-semibold text-slate-800">{community.memberCount}</span>
            <span>members</span>
          </div>
        </div>

        {/* Map area (if coordinates available) */}
        {community.location?.coordinates && (
          <div className="pt-2">
            <MapArea center={community.location.coordinates} className="h-36" />
          </div>
        )}

        {/* Description or Private Lock notice */}
        {isMember || community.type === 'public' ? (
          <p className="text-xs text-slate-700 leading-relaxed pt-2 border-t border-slate-100">
            {community.description || 'No description provided.'}
          </p>
        ) : (
          <div className="p-3 bg-slate-50 border border-slate-200 rounded-brand text-xs text-text-muted flex items-center gap-2">
            <Lock className="w-4 h-4 text-slate-400 shrink-0" />
            <span>
              This is a private community. Description and member lists are visible to members only.
            </span>
          </div>
        )}

        {/* Owner's Invite Code Section */}
        {isOwner && community.inviteCode && (
          <div className="p-3 bg-teal-50 border border-teal-200 rounded-brand text-xs space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-teal-900 flex items-center gap-1.5">
                <KeyRound className="w-3.5 h-3.5" /> Invite Code:
              </span>
              <button
                type="button"
                onClick={handleRegenerateCode}
                className="text-[11px] text-teal-700 hover:text-teal-900 flex items-center gap-1"
              >
                <RefreshCw className="w-3 h-3" /> Regenerate
              </button>
            </div>
            <div className="font-mono font-bold text-sm tracking-wider text-teal-950">
              {community.inviteCode}
            </div>
            <p className="text-[10px] text-teal-800">
              Share this code with neighbors to allow them to join instantly without waiting for
              approval.
            </p>
          </div>
        )}

        {/* Join/Leave Action Bar */}
        <div className="pt-2">
          {!user ? (
            <div className="p-2.5 bg-slate-50 text-center text-xs text-text-muted rounded-brand">
              Please log in to join this community.
            </div>
          ) : isMember ? (
            !isOwner && (
              <button
                type="button"
                onClick={handleLeave}
                disabled={actionLoading}
                className="w-full py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-brand flex items-center justify-center gap-1.5"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Leave Community</span>
              </button>
            )
          ) : isPending ? (
            <div className="flex items-center justify-between p-2.5 bg-amber-50 border border-amber-200 rounded-brand text-xs text-amber-900">
              <span>Join request pending owner approval</span>
              <button
                type="button"
                onClick={handleCancelRequest}
                className="text-[11px] font-semibold text-amber-800 hover:underline"
              >
                Cancel
              </button>
            </div>
          ) : community.type === 'public' ? (
            <button
              type="button"
              onClick={() => handleJoin()}
              disabled={actionLoading}
              className="w-full py-2.5 bg-primary hover:bg-primary-dark text-white text-xs font-semibold rounded-brand shadow-xs"
            >
              {actionLoading ? 'Joining...' : 'Join Community (Instant)'}
            </button>
          ) : (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => handleJoin()}
                disabled={actionLoading}
                className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-semibold rounded-brand"
              >
                Request to Join
              </button>
              <button
                type="button"
                onClick={() => setShowInviteModal(true)}
                className="flex-1 py-2.5 bg-primary hover:bg-primary-dark text-white text-xs font-semibold rounded-brand"
              >
                Enter Invite Code
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Tabs for Active Members & Owners */}
      {isMember && (
        <div className="bg-surface rounded-brand border border-slate-200 p-4 shadow-sm space-y-3">
          <div className="flex border-b border-slate-200">
            <button
              type="button"
              onClick={() => setActiveTab('members')}
              className={`pb-2 px-3 text-xs font-semibold border-b-2 transition ${
                activeTab === 'members'
                  ? 'border-primary text-primary'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              Members ({members.length})
            </button>

            {isOwner && (
              <button
                type="button"
                onClick={() => setActiveTab('requests')}
                className={`pb-2 px-3 text-xs font-semibold border-b-2 transition flex items-center gap-1.5 ${
                  activeTab === 'requests'
                    ? 'border-primary text-primary'
                    : 'border-transparent text-slate-500 hover:text-slate-700'
                }`}
              >
                <span>Requests</span>
                {requests.length > 0 && (
                  <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-amber-500 text-white">
                    {requests.length}
                  </span>
                )}
              </button>
            )}
          </div>

          {/* Members List */}
          {activeTab === 'members' && (
            <div className="divide-y divide-slate-100">
              {members.map((m) => (
                <div key={m.userId} className="py-2.5 flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2.5">
                    <div className="w-7 h-7 rounded-full bg-slate-100 overflow-hidden flex items-center justify-center font-bold text-[10px] text-slate-500">
                      {m.photoUrl ? (
                        <img src={m.photoUrl} alt={m.name} className="w-full h-full object-cover" />
                      ) : (
                        m.name.charAt(0)
                      )}
                    </div>
                    <div>
                      <div className="font-semibold text-slate-900 flex items-center gap-1.5">
                        <span>{m.name}</span>
                        {m.role === 'owner' && (
                          <span className="text-[10px] px-1 py-0.2 rounded bg-teal-100 text-teal-800">
                            Owner
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-text-muted flex items-center gap-1">
                        <ShieldCheck className="w-3 h-3 text-teal-600" />
                        <span>Trust: {m.trustScore}</span>
                      </div>
                    </div>
                  </div>

                  {isOwner && m.role !== 'owner' && (
                    <button
                      type="button"
                      onClick={() => handleRemoveMember(m.userId)}
                      className="text-[11px] text-red-600 hover:underline"
                    >
                      Remove
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Requests Tab (Owner Only) */}
          {activeTab === 'requests' && isOwner && (
            <div className="divide-y divide-slate-100">
              {requests.length === 0 ? (
                <p className="text-xs text-text-muted py-3 text-center">No pending join requests</p>
              ) : (
                requests.map((r) => (
                  <div
                    key={r.membershipId}
                    className="py-2.5 flex items-center justify-between text-xs"
                  >
                    <div>
                      <div className="font-semibold text-slate-900">{r.user?.name}</div>
                      <div className="text-[10px] text-text-muted">
                        Trust Score: {r.user?.trustScore} • Requested:{' '}
                        {new Date(r.requestedAt).toLocaleDateString()}
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => handleApprove(r.user._id)}
                        className="p-1.5 bg-emerald-100 hover:bg-emerald-200 text-emerald-800 rounded-brand"
                        title="Approve"
                      >
                        <Check className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleReject(r.user._id)}
                        className="p-1.5 bg-red-100 hover:bg-red-200 text-red-800 rounded-brand"
                        title="Reject"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      )}

      {/* Owner Administration Controls */}
      {isOwner && (
        <div className="bg-surface rounded-brand border border-slate-200 p-4 shadow-sm space-y-2">
          <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
            Owner Controls
          </h3>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setShowTransferModal(true)}
              className="flex-1 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-brand"
            >
              Transfer Ownership
            </button>
            <button
              type="button"
              onClick={handleDeleteCommunity}
              className="py-2 px-3 text-red-600 hover:bg-red-50 text-xs font-semibold rounded-brand flex items-center gap-1"
            >
              <Trash2 className="w-3.5 h-3.5" /> Delete
            </button>
          </div>
        </div>
      )}

      {/* Enter Invite Code Modal */}
      {showInviteModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-surface rounded-brand max-w-sm w-full p-5 space-y-3 shadow-xl">
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
              <KeyRound className="w-4 h-4 text-primary" /> Enter Invite Code
            </h3>
            <p className="text-xs text-text-muted">
              Enter the 10-character code provided by the community owner to join instantly.
            </p>
            <input
              type="text"
              placeholder="e.g. A1B2C3D4E5"
              value={inputInviteCode}
              onChange={(e) => setInputInviteCode(e.target.value)}
              className="w-full text-xs px-3 py-2 border border-slate-300 rounded-brand outline-none focus:border-primary font-mono tracking-wider"
            />
            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowInviteModal(false)}
                className="flex-1 py-2 bg-slate-100 text-slate-700 rounded-brand text-xs font-medium"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleJoin(inputInviteCode)}
                disabled={actionLoading || !inputInviteCode.trim()}
                className="flex-1 py-2 bg-primary text-white rounded-brand text-xs font-semibold disabled:opacity-50"
              >
                {actionLoading ? 'Joining...' : 'Submit Code'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Transfer Ownership Modal */}
      {showTransferModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-surface rounded-brand max-w-sm w-full p-5 space-y-3 shadow-xl">
            <h3 className="text-sm font-bold text-slate-900">Transfer Community Ownership</h3>
            <p className="text-xs text-text-muted">
              Select an active member to receive ownership of this community. You will become a
              regular member.
            </p>
            <select
              value={newOwnerId}
              onChange={(e) => setNewOwnerId(e.target.value)}
              className="w-full text-xs px-3 py-2 border border-slate-300 rounded-brand outline-none focus:border-primary"
            >
              <option value="">Select a member...</option>
              {members
                .filter((m) => m.userId !== user._id)
                .map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.name} (Trust: {m.trustScore})
                  </option>
                ))}
            </select>
            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowTransferModal(false)}
                className="flex-1 py-2 bg-slate-100 text-slate-700 rounded-brand text-xs font-medium"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleTransfer}
                disabled={!newOwnerId}
                className="flex-1 py-2 bg-primary text-white rounded-brand text-xs font-semibold disabled:opacity-50"
              >
                Confirm Transfer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default CommunityDetailScreen;
