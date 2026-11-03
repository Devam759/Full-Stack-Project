import React, { useState, useEffect } from 'react';
import { apiRequest } from '../api/client.js';
import { CheckCircle2, AlertCircle, Mail, ArrowRight } from 'lucide-react';

export function VerifyEmailScreen({ onNavigate }) {
  const [token, setToken] = useState('');
  const [emailForResend, setEmailForResend] = useState('');
  const [status, setStatus] = useState('idle'); // idle, loading, success, error
  const [message, setMessage] = useState('');

  useEffect(() => {
    // Check if token is in query string
    const urlParams = new URLSearchParams(window.location.search);
    const tokenParam = urlParams.get('token');
    if (tokenParam) {
      setToken(tokenParam);
      // Auto-trigger verification
      apiRequest('/auth/verify-email', {
        method: 'POST',
        body: JSON.stringify({ token: tokenParam.trim() }),
      })
        .then(() => {
          setStatus('success');
          setMessage('Your email has been verified successfully!');
        })
        .catch((err) => {
          setStatus('error');
          setMessage(err.message || 'Invalid or expired verification link');
        });
    }
  }, []);

  const handleVerify = async (tokenToUse) => {
    const rawToken = tokenToUse || token;
    if (!rawToken) {
      setStatus('error');
      setMessage('Please enter a verification token');
      return;
    }

    setStatus('loading');
    setMessage('');

    try {
      await apiRequest('/auth/verify-email', {
        method: 'POST',
        body: JSON.stringify({ token: rawToken.trim() }),
      });
      setStatus('success');
      setMessage('Your email has been verified successfully!');
    } catch (err) {
      setStatus('error');
      setMessage(err.message || 'Invalid or expired verification link');
    }
  };

  const handleResend = async () => {
    if (!emailForResend) {
      alert('Please enter your email to receive a new link');
      return;
    }

    try {
      await apiRequest('/auth/resend-verification', {
        method: 'POST',
        body: JSON.stringify({ email: emailForResend.trim() }),
      });
      alert('If your email is registered, a new link has been dispatched.');
    } catch {
      alert('Request received.');
    }
  };

  return (
    <div className="max-w-md mx-auto p-4 space-y-6 pt-8 text-center">
      <div className="inline-flex p-3 rounded-full bg-teal-50 text-primary border border-teal-100">
        <Mail className="w-8 h-8" />
      </div>

      <h1 className="text-xl font-heading font-bold text-slate-900">Email Verification</h1>

      {status === 'success' ? (
        <div className="bg-emerald-50 border border-emerald-200 p-4 rounded-brand space-y-3">
          <div className="flex items-center justify-center gap-2 text-emerald-800 font-semibold text-xs">
            <CheckCircle2 className="w-4 h-4" />
            <span>{message}</span>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('login')}
            className="w-full py-2 bg-primary text-white rounded-brand text-xs font-semibold flex items-center justify-center gap-2"
          >
            <span>Proceed to Log In</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      ) : (
        <div className="bg-surface rounded-brand border border-slate-200 p-5 space-y-4 shadow-sm text-left">
          {status === 'error' && (
            <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-brand text-xs flex items-start gap-2">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{message}</span>
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Enter Verification Token
            </label>
            <input
              type="text"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Paste token from email link"
              className="w-full text-xs px-3 py-2 border border-slate-300 rounded-brand outline-none focus:border-primary font-mono"
            />
          </div>

          <button
            type="button"
            onClick={() => handleVerify()}
            disabled={status === 'loading'}
            className="w-full py-2.5 bg-primary hover:bg-primary-dark text-white rounded-brand text-xs font-semibold transition disabled:opacity-50"
          >
            {status === 'loading' ? 'Verifying...' : 'Verify Email'}
          </button>

          <div className="pt-3 border-t border-slate-100 space-y-2">
            <p className="text-[11px] text-text-muted">Need a new link?</p>
            <div className="flex gap-2">
              <input
                type="email"
                placeholder="Your email address"
                value={emailForResend}
                onChange={(e) => setEmailForResend(e.target.value)}
                className="flex-1 text-xs px-2.5 py-1.5 border border-slate-300 rounded-brand outline-none focus:border-primary"
              />
              <button
                type="button"
                onClick={handleResend}
                className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs rounded-brand font-medium"
              >
                Resend
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default VerifyEmailScreen;
