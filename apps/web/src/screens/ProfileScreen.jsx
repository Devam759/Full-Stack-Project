import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { apiRequest } from '../api/client.js';
import {
  User,
  Wallet,
  LogOut,
  Edit2,
  Lock,
  Trash2,
  UserX,
  AlertCircle,
  CheckCircle,
  Star,
} from 'lucide-react';
import { formatPaise } from '@borrowloop/shared';
import TrustBadge from '../components/TrustBadge.jsx';
import SuspensionBanner from '../components/SuspensionBanner.jsx';

export function ProfileScreen({ onNavigate }) {
  const { user, logout, updateProfile } = useAuth();

  const [editName, setEditName] = useState(user?.name || '');
  const [editPhone, setEditPhone] = useState(user?.phone || '');
  const [isEditing, setIsEditing] = useState(false);
  const [blockedUsers, setBlockedUsers] = useState([]);
  const [deletePassword, setDeletePassword] = useState('');
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [showPasswordModal, setShowPasswordModal] = useState(false);

  const [statusMessage, setStatusMessage] = useState({ text: '', type: '' });
  const [ratings, setRatings] = useState([]);
  const [ratingsLoading, setRatingsLoading] = useState(false);

  useEffect(() => {
    async function loadRatings() {
      if (!user?._id && !user?.id) return;
      try {
        setRatingsLoading(true);
        const uid = user?._id || user?.id;
        const data = await apiRequest(`/users/${uid}/ratings`);
        setRatings(data.ratings || []);
      } catch {
        // silent
      } finally {
        setRatingsLoading(false);
      }
    }
    loadRatings();
  }, [user]);

  useEffect(() => {
    async function loadBlocked() {
      try {
        const data = await apiRequest('/users/me/blocks');
        setBlockedUsers(data.blocks || []);
      } catch {
        // silent
      }
    }
    loadBlocked();
  }, []);

  const handleUpdate = async (e) => {
    e.preventDefault();
    try {
      await updateProfile({ name: editName, phone: editPhone });
      setIsEditing(false);
      setStatusMessage({ text: 'Profile updated successfully', type: 'success' });
    } catch (err) {
      setStatusMessage({ text: err.message || 'Failed to update profile', type: 'error' });
    }
  };

  const handleChangePassword = async (e) => {
    e.preventDefault();
    try {
      await apiRequest('/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      setShowPasswordModal(false);
      setCurrentPassword('');
      setNewPassword('');
      setStatusMessage({ text: 'Password changed successfully', type: 'success' });
    } catch (err) {
      setStatusMessage({ text: err.message || 'Failed to change password', type: 'error' });
    }
  };

  const handleDeleteAccount = async () => {
    if (!deletePassword) {
      alert('Password is required to delete account');
      return;
    }

    try {
      await apiRequest('/users/me', {
        method: 'DELETE',
        body: JSON.stringify({ password: deletePassword }),
      });
      await logout();
      onNavigate('onboarding');
    } catch (err) {
      alert(err.message || 'Failed to delete account');
    }
  };

  const handleUnblock = async (blockedId) => {
    try {
      await apiRequest(`/users/${blockedId}/block`, { method: 'DELETE' });
      setBlockedUsers(blockedUsers.filter((b) => b.blockedUser._id !== blockedId));
      setStatusMessage({ text: 'User unblocked', type: 'success' });
    } catch (err) {
      setStatusMessage({ text: err.message || 'Failed to unblock user', type: 'error' });
    }
  };

  if (!user) {
    return (
      <div className="p-4 text-center">
        <p className="text-xs text-text-muted">Please log in to view your profile.</p>
        <button
          onClick={() => onNavigate('login')}
          className="mt-3 px-4 py-2 bg-primary text-white text-xs rounded-brand"
        >
          Go to Log In
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto p-4 space-y-4 pb-24">
      {/* Suspension / Ban Warning Banner */}
      <SuspensionBanner user={user} />

      {statusMessage.text && (
        <div
          className={`p-3 rounded-brand text-xs flex items-center gap-2 ${
            statusMessage.type === 'error'
              ? 'bg-red-50 text-red-700 border border-red-200'
              : 'bg-emerald-50 text-emerald-800 border border-emerald-200'
          }`}
        >
          {statusMessage.type === 'error' ? (
            <AlertCircle className="w-4 h-4 shrink-0" />
          ) : (
            <CheckCircle className="w-4 h-4 shrink-0" />
          )}
          <span>{statusMessage.text}</span>
        </div>
      )}

      {/* User Card */}
      <div className="bg-surface rounded-brand border border-slate-200 p-5 shadow-sm space-y-4">
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-full border border-slate-200 overflow-hidden bg-slate-100 flex items-center justify-center shrink-0">
            {user.photoUrl ? (
              <img src={user.photoUrl} alt={user.name} className="w-full h-full object-cover" />
            ) : (
              <User className="w-8 h-8 text-slate-400" />
            )}
          </div>

          <div className="flex-1 min-w-0">
            <h2 className="text-base font-heading font-bold text-slate-900 truncate">
              {user.name}
            </h2>
            <p className="text-xs text-text-muted truncate">{user.email}</p>
            <div className="flex items-center gap-2 mt-1">
              <span
                className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${
                  user.emailVerified
                    ? 'bg-emerald-100 text-emerald-800'
                    : 'bg-amber-100 text-amber-800'
                }`}
              >
                {user.emailVerified ? 'Email Verified' : 'Unverified'}
              </span>
              <span
                className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${
                  user.status === 'banned'
                    ? 'bg-rose-100 text-rose-800'
                    : user.banUntil && new Date(user.banUntil) > new Date()
                      ? 'bg-amber-100 text-amber-800'
                      : user.strikes === 1
                        ? 'bg-amber-50 text-amber-700 border border-amber-200'
                        : 'bg-emerald-50 text-emerald-700'
                }`}
              >
                {user.status === 'banned'
                  ? 'Banned'
                  : user.banUntil && new Date(user.banUntil) > new Date()
                    ? 'Suspended'
                    : user.strikes === 1
                      ? '1 Strike'
                      : 'Active'}
              </span>
            </div>
          </div>
        </div>

        {/* Badges Bar: Trust Badge & Demo Wallet */}
        <div className="flex items-center justify-between pt-3 border-t border-slate-100">
          <TrustBadge
            trustScore={user.trustScore}
            ratingAvg={user.ratingAvg}
            ratingCount={user.ratingCount}
            size="md"
          />

          <div className="p-2 rounded-brand bg-slate-50 border border-slate-100 flex items-center gap-2">
            <Wallet className="w-4 h-4 text-amber-600 shrink-0" />
            <div className="text-right">
              <span className="block text-[9px] text-text-muted font-medium">Demo Wallet</span>
              <span className="text-xs font-bold text-slate-900 font-mono">
                {formatPaise(0, { showDemoTag: true })}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Edit Profile Form / Trigger */}
      <div className="bg-surface rounded-brand border border-slate-200 p-4 shadow-sm space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
            Account Details
          </h3>
          <button
            type="button"
            onClick={() => setIsEditing(!isEditing)}
            className="text-xs text-primary font-medium flex items-center gap-1"
          >
            <Edit2 className="w-3.5 h-3.5" />
            <span>{isEditing ? 'Cancel' : 'Edit'}</span>
          </button>
        </div>

        {isEditing ? (
          <form onSubmit={handleUpdate} className="space-y-3 pt-2">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Name</label>
              <input
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="w-full text-xs px-3 py-2 border border-slate-300 rounded-brand outline-none focus:border-primary"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Phone</label>
              <input
                type="text"
                value={editPhone}
                placeholder="+91 9876543210"
                onChange={(e) => setEditPhone(e.target.value)}
                className="w-full text-xs px-3 py-2 border border-slate-300 rounded-brand outline-none focus:border-primary"
              />
            </div>
            <button
              type="submit"
              className="w-full py-2 bg-primary text-white text-xs font-semibold rounded-brand"
            >
              Save Changes
            </button>
          </form>
        ) : (
          <div className="text-xs space-y-1.5 text-slate-700">
            <div>
              <span className="text-text-muted">Phone: </span>
              <span>{user.phone || 'Not added'}</span>
            </div>
          </div>
        )}
      </div>

      {/* Blocked Users Section */}
      {blockedUsers.length > 0 && (
        <div className="bg-surface rounded-brand border border-slate-200 p-4 shadow-sm space-y-2">
          <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-1.5">
            <UserX className="w-3.5 h-3.5 text-slate-500" />
            <span>Blocked Users ({blockedUsers.length})</span>
          </h3>
          <div className="divide-y divide-slate-100">
            {blockedUsers.map((b) => (
              <div key={b.blockId} className="py-2 flex items-center justify-between text-xs">
                <span className="font-medium text-slate-800">{b.blockedUser?.name || 'User'}</span>
                <button
                  type="button"
                  onClick={() => handleUnblock(b.blockedUser._id)}
                  className="text-primary text-[11px] hover:underline"
                >
                  Unblock
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Revealed Reviews Section (Phase 7) */}
      <div className="bg-surface rounded-brand border border-slate-200 p-4 shadow-sm space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-1.5">
            <Star className="w-3.5 h-3.5 text-amber-500 fill-amber-500" />
            <span>Revealed Reviews ({ratings.length})</span>
          </h3>
          <span className="text-[10px] text-text-muted">Public Feedback</span>
        </div>

        {ratingsLoading ? (
          <div className="text-xs text-text-muted py-2 text-center">Loading reviews...</div>
        ) : ratings.length === 0 ? (
          <p className="text-xs text-text-muted py-2">
            No public reviews yet. Reviews are revealed once both parties submit or after 7 days.
          </p>
        ) : (
          <div className="space-y-2.5 divide-y divide-slate-100">
            {ratings.map((r) => (
              <div key={r._id} className="pt-2.5 first:pt-0 space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-1">
                    {[1, 2, 3, 4, 5].map((s) => (
                      <Star
                        key={s}
                        className={`w-3 h-3 ${
                          s <= r.stars
                            ? 'text-amber-400 fill-amber-400'
                            : 'text-zinc-200 fill-zinc-100'
                        }`}
                      />
                    ))}
                    <span className="font-semibold text-slate-800 ml-1">
                      {r.raterId?.name || 'Borrower'}
                    </span>
                  </div>
                  <span className="text-[10px] text-zinc-400">
                    {new Date(r.revealedAt || r.createdAt).toLocaleDateString()}
                  </span>
                </div>
                {r.comment && (
                  <p className="text-xs text-slate-600 italic">&ldquo;{r.comment}&rdquo;</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Security Actions */}
      <div className="space-y-2">
        <button
          type="button"
          onClick={() => setShowPasswordModal(true)}
          className="w-full py-2.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-brand text-xs font-medium flex items-center justify-center gap-2"
        >
          <Lock className="w-3.5 h-3.5 text-slate-500" />
          <span>Change Password</span>
        </button>

        <button
          type="button"
          onClick={logout}
          className="w-full py-2.5 bg-white border border-slate-200 hover:bg-slate-50 text-red-600 rounded-brand text-xs font-medium flex items-center justify-center gap-2"
        >
          <LogOut className="w-3.5 h-3.5" />
          <span>Log Out</span>
        </button>

        <button
          type="button"
          onClick={() => setShowDeleteModal(true)}
          className="w-full py-2 text-slate-400 hover:text-red-600 text-[11px] font-medium flex items-center justify-center gap-1.5 transition"
        >
          <Trash2 className="w-3 h-3" />
          <span>Delete Account</span>
        </button>
      </div>

      {/* Change Password Modal */}
      {showPasswordModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-surface rounded-brand max-w-sm w-full p-5 space-y-3 shadow-lg">
            <h3 className="text-sm font-bold text-slate-900">Change Password</h3>
            <form onSubmit={handleChangePassword} className="space-y-3">
              <div>
                <label className="block text-xs text-slate-700 mb-1">Current Password</label>
                <input
                  type="password"
                  required
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  className="w-full text-xs px-3 py-2 border border-slate-300 rounded-brand outline-none focus:border-primary"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-700 mb-1">New Password</label>
                <input
                  type="password"
                  required
                  minLength={8}
                  maxLength={128}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full text-xs px-3 py-2 border border-slate-300 rounded-brand outline-none focus:border-primary"
                />
              </div>
              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowPasswordModal(false)}
                  className="flex-1 py-2 bg-slate-100 text-slate-700 rounded-brand text-xs font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2 bg-primary text-white rounded-brand text-xs font-semibold"
                >
                  Update
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Account Modal */}
      {showDeleteModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-surface rounded-brand max-w-sm w-full p-5 space-y-3 shadow-lg">
            <h3 className="text-sm font-bold text-red-600 flex items-center gap-2">
              <AlertCircle className="w-4 h-4" />
              <span>Delete Account</span>
            </h3>
            <p className="text-xs text-text-muted">
              This action clears your personal data, revokes all sessions, and cannot be undone.
              Please confirm your password to proceed.
            </p>
            <input
              type="password"
              placeholder="Enter your current password"
              value={deletePassword}
              onChange={(e) => setDeletePassword(e.target.value)}
              className="w-full text-xs px-3 py-2 border border-slate-300 rounded-brand outline-none focus:border-red-500"
            />
            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowDeleteModal(false)}
                className="flex-1 py-2 bg-slate-100 text-slate-700 rounded-brand text-xs font-medium"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDeleteAccount}
                className="flex-1 py-2 bg-red-600 text-white rounded-brand text-xs font-semibold"
              >
                Permanently Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default ProfileScreen;
