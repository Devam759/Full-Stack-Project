import React, { useState } from 'react';
import { Mail, AlertCircle, CheckCircle, ArrowLeft } from 'lucide-react';
import { apiRequest } from '../api/client.js';

export function ForgotPasswordScreen({ onNavigate }) {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await apiRequest('/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      });
      setSubmitted(true);
    } catch (err) {
      // Even on error, show safe message to prevent email enumeration
      setError(err.message || 'Unable to process password reset request. Please try again.');
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
        <h1 className="text-xl font-heading font-bold text-slate-900">Forgot Password</h1>
        <p className="text-xs text-text-muted mt-1">
          Enter your registered email address and we&apos;ll send you a password reset link.
        </p>
      </div>

      {submitted ? (
        <div className="p-4 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-brand text-xs space-y-3">
          <div className="flex items-start gap-2">
            <CheckCircle className="w-4 h-4 mt-0.5 shrink-0 text-emerald-600" />
            <div>
              <p className="font-semibold">Reset link sent</p>
              <p className="mt-1">
                If an account exists for <strong>{email}</strong>, you will receive an email with
                instructions to reset your password.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('login')}
            className="w-full py-2 bg-emerald-700 hover:bg-emerald-800 text-white rounded-brand font-semibold text-xs transition"
          >
            Return to Log In
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

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Email</label>
            <div className="relative">
              <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full text-xs pl-9 pr-3 py-2 border border-slate-300 rounded-brand outline-none focus:border-primary"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 bg-primary hover:bg-primary-dark text-white rounded-brand text-xs font-semibold transition mt-2 disabled:opacity-50"
          >
            {loading ? 'Sending link...' : 'Send Reset Link'}
          </button>
        </form>
      )}
    </div>
  );
}

export default ForgotPasswordScreen;
