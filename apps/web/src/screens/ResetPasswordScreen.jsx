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
    <div className="max-w-md mx-auto p-4 space-y-6 pt-10">
      <div className="flex items-center gap-2 mb-1">
        <button
          type="button"
          onClick={() => onNavigate('login')}
          className="text-neutral-500 hover:text-black p-1.5 -ml-2 rounded-full hover:bg-neutral-100 transition focus:outline-none"
          aria-label="Back to login"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <span className="text-xs font-semibold text-neutral-600">Back to log in</span>
      </div>

      <div>
        <h1 className="text-3xl font-heading font-black tracking-tight text-black">
          Reset password
        </h1>
        <p className="text-sm text-neutral-500 mt-1">Enter your new secure password below.</p>
      </div>

      {success ? (
        <div className="p-6 bg-white border border-neutral-200 rounded-3xl text-sm space-y-4 shadow-sm">
          <div className="flex items-start gap-3">
            <CheckCircle className="w-5 h-5 mt-0.5 shrink-0 text-emerald-600" />
            <div>
              <p className="font-bold text-black">Password updated successfully</p>
              <p className="mt-1 text-neutral-600 text-xs">
                Your password has been changed. You can now log in with your new password.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('login')}
            className="w-full py-3.5 bg-black hover:bg-neutral-800 text-white rounded-full font-bold text-sm transition"
          >
            Log in now
          </button>
        </div>
      ) : (
        <form
          onSubmit={handleSubmit}
          className="space-y-4 bg-white p-6 sm:p-8 rounded-3xl border border-neutral-200 shadow-sm"
        >
          {error && (
            <div className="p-4 bg-red-50 border border-red-200 text-red-700 rounded-2xl text-xs flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0 text-red-600" />
              <span className="font-medium">{error}</span>
            </div>
          )}

          {!initialToken && (
            <div>
              <label className="block text-xs font-bold text-neutral-800 uppercase tracking-wider mb-1.5">
                Reset token
              </label>
              <input
                type="text"
                required
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="Paste token from email"
                className="w-full text-sm px-4 py-3 bg-neutral-100 hover:bg-neutral-100/80 focus:bg-white border border-transparent focus:border-black rounded-xl outline-none transition"
              />
            </div>
          )}

          <div>
            <label className="block text-xs font-bold text-neutral-800 uppercase tracking-wider mb-1.5">
              New password
            </label>
            <div className="relative">
              <Lock className="w-4 h-4 text-neutral-400 absolute left-3.5 top-3.5" />
              <input
                type="password"
                required
                minLength={8}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="At least 8 characters"
                className="w-full text-sm pl-10 pr-3.5 py-3 bg-neutral-100 hover:bg-neutral-100/80 focus:bg-white border border-transparent focus:border-black rounded-xl outline-none transition"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-neutral-800 uppercase tracking-wider mb-1.5">
              Confirm new password
            </label>
            <div className="relative">
              <Lock className="w-4 h-4 text-neutral-400 absolute left-3.5 top-3.5" />
              <input
                type="password"
                required
                minLength={8}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Re-enter new password"
                className="w-full text-sm pl-10 pr-3.5 py-3 bg-neutral-100 hover:bg-neutral-100/80 focus:bg-white border border-transparent focus:border-black rounded-xl outline-none transition"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3.5 bg-black hover:bg-neutral-800 active:bg-neutral-900 text-white rounded-full text-sm font-bold transition shadow-xs mt-2 disabled:opacity-50"
          >
            {loading ? 'Updating password...' : 'Update Password'}
          </button>
        </form>
      )}
    </div>
  );
}

export default ResetPasswordScreen;
