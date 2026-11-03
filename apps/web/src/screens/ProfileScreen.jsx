import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { apiRequest } from '../api/client.js';
import {
  User,
  ShieldCheck,
  Wallet,
  LogOut,
  Edit2,
  Lock,
  Trash2,
  UserX,
  AlertCircle,
  CheckCircle,
} from 'lucide-react';
import { formatPaise } from '@borrowloop/shared';

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
              <span className="text-[10px] text-text-muted font-medium capitalize">
                Role: {user.role}
              </span>
            </div>
          </div>
        </div>

        {/* Badges Bar: Trust Score & Demo Wallet */}
        <div className="grid grid-cols-2 gap-2 pt-3 border-t border-slate-100">
          <div className="p-2.5 rounded-brand bg-slate-50 border border-slate-100 flex items-center gap-2.5">
            <ShieldCheck className="w-5 h-5 text-teal-600 shrink-0" />
            <div>
              <span className="block text-[10px] text-text-muted font-medium">Trust Score</span>
              <span className="text-xs font-bold text-slate-900">{user.trustScore} / 100</span>
            </div>
          </div>

          <div className="p-2.5 rounded-brand bg-slate-50 border border-slate-100 flex items-center gap-2.5">
            <Wallet className="w-5 h-5 text-amber-600 shrink-0" />
            <div>
              <span className="block text-[10px] text-text-muted font-medium">Demo Wallet</span>
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
