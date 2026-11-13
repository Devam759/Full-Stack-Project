import React, { useState } from 'react';
import { Lock, AlertCircle, CheckCircle, ArrowLeft } from 'lucide-react';
import { apiRequest } from '../api/client.js';

export function ResetPasswordScreen({ onNavigate, initialToken = '' }) {
  const [token, setToken] = useState(initialToken);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters long');
      return;
    }

    if (newPassword !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (!token.trim()) {
      setError('Reset token is required');
      return;
    }

    setLoading(true);

    try {
      await apiRequest('/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({
          token: token.trim(),
          newPassword,
        }),
      });
      setSuccess(true);
    } catch (err) {
      setError(err.message || 'Invalid or expired password reset token');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-md mx-auto p-4 space-y-5 pt-8">
      <div className="flex items-center gap-2 mb-2">
        <button
          type="button"
          onClick={() => onNavigate('login')}
          className="text-text-muted hover:text-slate-900 p-1 -ml-1 rounded focus:outline-none"
          aria-label="Back to login"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <span className="text-xs font-medium text-text-muted">Back to login</span>
      </div>

      <div className="text-center">
        <h1 className="text-xl font-heading font-bold text-slate-900">Reset Password</h1>
        <p className="text-xs text-text-muted mt-1">Enter your new password below</p>
      </div>

      {success ? (
        <div className="p-4 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-brand text-xs space-y-3">
          <div className="flex items-start gap-2">
            <CheckCircle className="w-4 h-4 mt-0.5 shrink-0 text-emerald-600" />
            <div>
              <p className="font-semibold">Password updated successfully</p>
              <p className="mt-1">
                Your password has been reset. You can now log in with your new password.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('login')}
            className="w-full py-2 bg-emerald-700 hover:bg-emerald-800 text-white rounded-brand font-semibold text-xs transition"
          >
            Log In Now
          </button>
        </div>
      ) : (
        <form
          onSubmit={handleSubmit}
          className="space-y-4 bg-surface p-5 rounded-brand border border-slate-200 shadow-sm"
        >
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-brand text-xs flex items-start gap-2">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {!initialToken && (
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Reset Token</label>
              <input
                type="text"
                required
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="Paste token from email"
                className="w-full text-xs px-3 py-2 border border-slate-300 rounded-brand outline-none focus:border-primary"
              />
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">New Password</label>
            <div className="relative">
              <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="password"
                required
                minLength={8}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="At least 8 characters"
                className="w-full text-xs pl-9 pr-3 py-2 border border-slate-300 rounded-brand outline-none focus:border-primary"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Confirm New Password
            </label>
            <div className="relative">
              <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="password"
                required
                minLength={8}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Re-enter new password"
                className="w-full text-xs pl-9 pr-3 py-2 border border-slate-300 rounded-brand outline-none focus:border-primary"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 bg-primary hover:bg-primary-dark text-white rounded-brand text-xs font-semibold transition mt-2 disabled:opacity-50"
          >
            {loading ? 'Resetting password...' : 'Update Password'}
          </button>
        </form>
      )}
    </div>
  );
}

export default ResetPasswordScreen;
