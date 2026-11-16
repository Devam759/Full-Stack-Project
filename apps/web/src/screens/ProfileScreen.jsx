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
    <div className="max-w-2xl mx-auto space-y-6 pb-20">
      {/* Header */}
      <div>
        <h1 className="font-heading font-black text-3xl sm:text-4xl tracking-tight text-black">
          Profile &amp; Settings
        </h1>
        <p className="text-sm text-neutral-500 mt-1">
          Manage your account credentials, security settings, and member trust reputation.
        </p>
      </div>

      {/* Suspension / Ban Warning Banner */}
      <SuspensionBanner user={user} />

      {statusMessage.text && (
        <div
          className={`p-4 rounded-2xl text-xs flex items-center gap-2.5 font-medium ${
            statusMessage.type === 'error'
              ? 'bg-red-50 text-red-700 border border-red-200'
              : 'bg-emerald-50 text-emerald-800 border border-emerald-200'
          }`}
        >
          {statusMessage.type === 'error' ? (
            <AlertCircle className="w-4 h-4 shrink-0 text-red-600" />
          ) : (
            <CheckCircle className="w-4 h-4 shrink-0 text-emerald-600" />
          )}
          <span>{statusMessage.text}</span>
        </div>
      )}

      {/* User Card */}
      <div className="bg-white rounded-3xl border border-neutral-200 p-6 sm:p-8 shadow-xs space-y-5">
        <div className="flex items-center gap-5">
          <div className="w-18 h-18 rounded-full border border-neutral-200 overflow-hidden bg-neutral-100 flex items-center justify-center shrink-0">
            {user.photoUrl ? (
              <img src={user.photoUrl} alt={user.name} className="w-full h-full object-cover" />
            ) : (
              <User className="w-9 h-9 text-neutral-400" />
            )}
          </div>

          <div className="flex-1 min-w-0">
            <h2 className="text-xl font-heading font-black text-black truncate">{user.name}</h2>
            <p className="text-xs text-neutral-500 truncate mt-0.5">{user.email}</p>
            <div className="flex items-center gap-2 mt-2">
              <span
                className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold ${
                  user.emailVerified ? 'bg-neutral-100 text-black' : 'bg-amber-100 text-amber-800'
                }`}
              >
                {user.emailVerified ? 'Email Verified' : 'Unverified'}
              </span>
              <span
                className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold ${
                  user.status === 'banned'
                    ? 'bg-red-100 text-red-800'
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
        <div className="flex items-center justify-between pt-4 border-t border-neutral-100">
          <TrustBadge
            trustScore={user.trustScore}
            ratingAvg={user.ratingAvg}
            ratingCount={user.ratingCount}
            size="md"
          />

          <div className="px-3.5 py-2 rounded-2xl bg-neutral-50 border border-neutral-200 flex items-center gap-2.5">
            <Wallet className="w-4 h-4 text-black shrink-0" />
            <div className="text-right">
              <span className="block text-[10px] text-neutral-500 font-bold uppercase tracking-wider">
                Demo Wallet
              </span>
              <span className="text-xs font-black text-black font-mono">
                {formatPaise(0, { showDemoTag: true })}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Edit Profile Form / Trigger */}
      <div className="bg-white rounded-3xl border border-neutral-200 p-6 sm:p-8 shadow-xs space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-black uppercase tracking-wider">
            Personal Information
          </h3>
          <button
            type="button"
            onClick={() => setIsEditing(!isEditing)}
            className="text-xs text-black font-bold flex items-center gap-1.5 hover:underline"
          >
            <Edit2 className="w-3.5 h-3.5" />
            <span>{isEditing ? 'Cancel' : 'Edit profile'}</span>
          </button>
        </div>

        {isEditing ? (
          <form onSubmit={handleUpdate} className="space-y-4 pt-2">
            <div>
              <label className="block text-xs font-bold text-neutral-800 uppercase tracking-wider mb-1.5">
                Full name
              </label>
              <input
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="w-full text-sm px-4 py-3 bg-neutral-100 hover:bg-neutral-100/80 focus:bg-white border border-transparent focus:border-black rounded-xl outline-none transition"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-neutral-800 uppercase tracking-wider mb-1.5">
                Phone number
              </label>
              <input
                type="text"
                value={editPhone}
                placeholder="+91 9876543210"
                onChange={(e) => setEditPhone(e.target.value)}
                className="w-full text-sm px-4 py-3 bg-neutral-100 hover:bg-neutral-100/80 focus:bg-white border border-transparent focus:border-black rounded-xl outline-none transition"
              />
            </div>
            <button
              type="submit"
              className="w-full py-3.5 bg-black hover:bg-neutral-800 text-white text-xs font-bold rounded-full transition shadow-xs"
            >
              Save changes
            </button>
          </form>
        ) : (
          <div className="text-sm space-y-2 text-neutral-700">
            <div className="flex items-center justify-between py-2 border-b border-neutral-100">
              <span className="text-neutral-500 text-xs">Registered Phone:</span>
              <span className="font-semibold text-black">{user.phone || 'Not added'}</span>
            </div>
            <div className="flex items-center justify-between py-2">
              <span className="text-neutral-500 text-xs">Primary Email:</span>
              <span className="font-semibold text-black">{user.email}</span>
            </div>
          </div>
        )}
      </div>

      {/* Blocked Users Section */}
      {blockedUsers.length > 0 && (
        <div className="bg-white rounded-3xl border border-neutral-200 p-6 sm:p-8 shadow-xs space-y-3">
          <h3 className="text-sm font-bold text-black uppercase tracking-wider flex items-center gap-2">
            <UserX className="w-4 h-4 text-neutral-500" />
            <span>Blocked Users ({blockedUsers.length})</span>
          </h3>
          <div className="divide-y divide-neutral-100">
            {blockedUsers.map((b) => (
              <div key={b.blockId} className="py-3 flex items-center justify-between text-xs">
                <span className="font-bold text-black">{b.blockedUser?.name || 'User'}</span>
                <button
                  type="button"
                  onClick={() => handleUnblock(b.blockedUser._id)}
                  className="text-black font-bold hover:underline"
                >
                  Unblock
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Revealed Reviews Section (Phase 7) */}
      <div className="bg-white rounded-3xl border border-neutral-200 p-6 sm:p-8 shadow-xs space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-black uppercase tracking-wider flex items-center gap-2">
            <Star className="w-4 h-4 text-black fill-black" />
            <span>Public Reviews ({ratings.length})</span>
          </h3>
          <span className="text-xs text-neutral-400 font-semibold">Verified Feedback</span>
        </div>

        {ratingsLoading ? (
          <div className="text-xs text-neutral-400 py-3 text-center">Loading reviews...</div>
        ) : ratings.length === 0 ? (
          <p className="text-xs text-neutral-500 py-2">
            No public reviews yet. Reviews are revealed once both parties submit ratings or after 7
            days.
          </p>
        ) : (
          <div className="space-y-3 divide-y divide-neutral-100">
            {ratings.map((r) => (
              <div key={r._id} className="pt-3 first:pt-0 space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-1.5">
                    {[1, 2, 3, 4, 5].map((s) => (
                      <Star
                        key={s}
                        className={`w-3.5 h-3.5 ${
                          s <= r.stars
                            ? 'text-black fill-black'
                            : 'text-neutral-200 fill-neutral-200'
                        }`}
                      />
                    ))}
                    <span className="font-bold text-black ml-1.5">
                      {r.raterId?.name || 'Borrower'}
                    </span>
                  </div>
                  <span className="text-[11px] text-neutral-400">
                    {new Date(r.revealedAt || r.createdAt).toLocaleDateString()}
                  </span>
                </div>
                {r.comment && (
                  <p className="text-xs text-neutral-700 italic leading-relaxed">
                    &ldquo;{r.comment}&rdquo;
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Security Actions */}
      <div className="space-y-3">
        <button
          type="button"
          onClick={() => setShowPasswordModal(true)}
          className="w-full py-3.5 bg-neutral-100 hover:bg-neutral-200 text-black rounded-full text-xs font-bold flex items-center justify-center gap-2 transition"
        >
          <Lock className="w-4 h-4 text-black" />
          <span>Change password</span>
        </button>

        <button
          type="button"
          onClick={logout}
          className="w-full py-3.5 bg-black hover:bg-neutral-800 text-white rounded-full text-xs font-bold flex items-center justify-center gap-2 transition shadow-xs"
        >
          <LogOut className="w-4 h-4" />
          <span>Log out</span>
        </button>

        <button
          type="button"
          onClick={() => setShowDeleteModal(true)}
          className="w-full py-2.5 text-neutral-400 hover:text-red-600 text-xs font-semibold flex items-center justify-center gap-1.5 transition"
        >
          <Trash2 className="w-3.5 h-3.5" />
          <span>Permanently delete account</span>
        </button>
      </div>

      {/* Change Password Modal */}
      {showPasswordModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 backdrop-blur-xs">
          <div className="bg-white rounded-3xl max-w-sm w-full p-6 sm:p-8 space-y-4 shadow-xl border border-neutral-200">
            <h3 className="text-base font-bold text-black">Change password</h3>
            <form onSubmit={handleChangePassword} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-neutral-800 uppercase tracking-wider mb-1.5">
                  Current password
                </label>
                <input
                  type="password"
                  required
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  className="w-full text-sm px-4 py-3 bg-neutral-100 hover:bg-neutral-100/80 focus:bg-white border border-transparent focus:border-black rounded-xl outline-none transition"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-neutral-800 uppercase tracking-wider mb-1.5">
                  New password
                </label>
                <input
                  type="password"
                  required
                  minLength={8}
                  maxLength={128}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full text-sm px-4 py-3 bg-neutral-100 hover:bg-neutral-100/80 focus:bg-white border border-transparent focus:border-black rounded-xl outline-none transition"
                />
              </div>
              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowPasswordModal(false)}
                  className="flex-1 py-3 bg-neutral-100 hover:bg-neutral-200 text-black rounded-full text-xs font-bold transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 py-3 bg-black hover:bg-neutral-800 text-white rounded-full text-xs font-bold transition shadow-xs"
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
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 backdrop-blur-xs">
          <div className="bg-white rounded-3xl max-w-sm w-full p-6 sm:p-8 space-y-4 shadow-xl border border-neutral-200">
            <h3 className="text-base font-bold text-red-600 flex items-center gap-2">
              <AlertCircle className="w-5 h-5" />
              <span>Delete Account</span>
            </h3>
            <p className="text-xs text-neutral-600 leading-relaxed">
              This action clears your personal data, revokes all sessions, and cannot be undone.
              Enter your current password to proceed.
            </p>
            <input
              type="password"
              placeholder="Enter your current password"
              value={deletePassword}
              onChange={(e) => setDeletePassword(e.target.value)}
              className="w-full text-sm px-4 py-3 bg-neutral-100 hover:bg-neutral-100/80 focus:bg-white border border-transparent focus:border-red-600 rounded-xl outline-none transition"
            />
            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowDeleteModal(false)}
                className="flex-1 py-3 bg-neutral-100 hover:bg-neutral-200 text-black rounded-full text-xs font-bold transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDeleteAccount}
                className="flex-1 py-3 bg-red-600 hover:bg-red-700 text-white rounded-full text-xs font-bold transition"
              >
                Permanently delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default ProfileScreen;
