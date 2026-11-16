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
    <div className="max-w-md mx-auto p-4 space-y-6 pt-10 text-center">
      <div className="inline-flex p-4 rounded-full bg-neutral-100 text-black border border-neutral-200">
        <Mail className="w-8 h-8" />
      </div>

      <div>
        <h1 className="text-3xl font-heading font-black tracking-tight text-black">
          Verify your email
        </h1>
        <p className="text-sm text-neutral-500 mt-1">
          Confirm your email address to unlock your account.
        </p>
      </div>

      {status === 'success' ? (
        <div className="bg-white border border-neutral-200 p-6 rounded-3xl space-y-4 shadow-sm text-center">
          <div className="flex items-center justify-center gap-2 text-emerald-700 font-bold text-sm">
            <CheckCircle2 className="w-5 h-5" />
            <span>{message}</span>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('login')}
            className="w-full py-3.5 bg-black hover:bg-neutral-800 text-white rounded-full text-sm font-bold flex items-center justify-center gap-2 transition"
          >
            <span>Proceed to log in</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      ) : (
        <div className="bg-white rounded-3xl border border-neutral-200 p-6 sm:p-8 space-y-5 shadow-sm text-left">
          {status === 'error' && (
            <div className="p-4 bg-red-50 border border-red-200 text-red-700 rounded-2xl text-xs flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0 text-red-600" />
              <span className="font-medium">{message}</span>
            </div>
          )}

          <div>
            <label className="block text-xs font-bold text-neutral-800 uppercase tracking-wider mb-1.5">
              Verification token
            </label>
            <input
              type="text"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Paste token from email link"
              className="w-full text-sm px-4 py-3 bg-neutral-100 hover:bg-neutral-100/80 focus:bg-white border border-transparent focus:border-black rounded-xl outline-none font-mono transition"
            />
          </div>

          <button
            type="button"
            onClick={() => handleVerify()}
            disabled={status === 'loading'}
            className="w-full py-3.5 bg-black hover:bg-neutral-800 active:bg-neutral-900 text-white rounded-full text-sm font-bold transition shadow-xs disabled:opacity-50"
          >
            {status === 'loading' ? 'Verifying...' : 'Verify email'}
          </button>

          <div className="pt-4 border-t border-neutral-100 space-y-2">
            <p className="text-xs font-semibold text-neutral-600">Need a new link?</p>
            <div className="flex gap-2">
              <input
                type="email"
                placeholder="Your email address"
                value={emailForResend}
                onChange={(e) => setEmailForResend(e.target.value)}
                className="flex-1 text-sm px-3.5 py-2.5 bg-neutral-100 focus:bg-white border border-transparent focus:border-black rounded-xl outline-none transition"
              />
              <button
                type="button"
                onClick={handleResend}
                className="px-4 py-2.5 bg-neutral-100 hover:bg-neutral-200 text-black text-xs rounded-xl font-bold transition"
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
