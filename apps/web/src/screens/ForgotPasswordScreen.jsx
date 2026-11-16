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
      setError(err.message || 'Unable to process password reset request. Please try again.');
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
          Forgot password?
        </h1>
        <p className="text-sm text-neutral-500 mt-1">
          Enter your registered email and we&apos;ll send you a password reset link.
        </p>
      </div>

      {submitted ? (
        <div className="p-6 bg-white border border-neutral-200 rounded-3xl text-sm space-y-4 shadow-sm">
          <div className="flex items-start gap-3">
            <CheckCircle className="w-5 h-5 mt-0.5 shrink-0 text-emerald-600" />
            <div>
              <p className="font-bold text-black">Reset instructions sent</p>
              <p className="mt-1 text-neutral-600 text-xs">
                If an account exists for <strong className="text-black">{email}</strong>, you will
                receive an email shortly with instructions to reset your password.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('login')}
            className="w-full py-3 bg-black hover:bg-neutral-800 text-white rounded-full font-bold text-sm transition"
          >
            Return to log in
          </button>
        </div>
      ) : (
        <form
          onSubmit={handleSubmit}
          className="space-y-5 bg-white p-6 sm:p-8 rounded-3xl border border-neutral-200 shadow-sm"
        >
          {error && (
            <div className="p-4 bg-red-50 border border-red-200 text-red-700 rounded-2xl text-xs flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0 text-red-600" />
              <span className="font-medium">{error}</span>
            </div>
          )}

          <div>
            <label className="block text-xs font-bold text-neutral-800 uppercase tracking-wider mb-1.5">
              Email address
            </label>
            <div className="relative">
              <Mail className="w-4 h-4 text-neutral-400 absolute left-3.5 top-3.5" />
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@example.com"
                className="w-full text-sm pl-10 pr-3.5 py-3 bg-neutral-100 hover:bg-neutral-100/80 focus:bg-white border border-transparent focus:border-black rounded-xl outline-none transition"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3.5 bg-black hover:bg-neutral-800 active:bg-neutral-900 text-white rounded-full text-sm font-bold transition shadow-xs disabled:opacity-50"
          >
            {loading ? 'Sending link...' : 'Send reset link'}
          </button>
        </form>
      )}
    </div>
  );
}

export default ForgotPasswordScreen;
