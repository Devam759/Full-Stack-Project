import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { Mail, Lock, User, CheckCircle2, AlertCircle } from 'lucide-react';

export function SignUpScreen({ onNavigate }) {
  const { register } = useAuth();

  const [formData, setFormData] = useState({
    name: '',
    email: '',
    password: '',
    confirmAge: false,
    acceptTerms: false,
  });

  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (formData.password.length < 8) {
      setError('Password must be at least 8 characters long');
      return;
    }
    if (formData.password.length > 128) {
      setError('Password cannot exceed 128 characters');
      return;
    }
    if (!formData.confirmAge) {
      setError('You must confirm that you are at least 18 years old');
      return;
    }
    if (!formData.acceptTerms) {
      setError('You must accept the terms of service');
      return;
    }

    setLoading(true);
    try {
      await register(formData);
      setSuccess(true);
    } catch (err) {
      setError(err.message || 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="max-w-md mx-auto p-4 pt-10 text-center space-y-4">
        <div className="inline-flex p-3 rounded-full bg-emerald-100 text-emerald-600">
          <CheckCircle2 className="w-8 h-8" />
        </div>
        <h2 className="text-xl font-heading font-bold text-slate-900">Check Your Email</h2>
        <p className="text-xs text-text-muted">
          We sent a verification link to{' '}
          <span className="font-semibold text-slate-800">{formData.email}</span>. Please click the
          link in your email to activate your account.
        </p>

        <div className="pt-4 space-y-2">
          <button
            type="button"
            onClick={() => onNavigate('login')}
            className="w-full py-2.5 bg-primary text-white text-xs font-medium rounded-brand"
          >
            Continue to Log In
          </button>
          <button
            type="button"
            onClick={() => onNavigate('verify-email')}
            className="w-full py-2 bg-slate-100 text-slate-700 text-xs font-medium rounded-brand"
          >
            Enter Token Manually
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto p-4 space-y-5">
      <div className="text-center pt-4">
        <h1 className="text-xl font-heading font-bold text-slate-900">Create an Account</h1>
        <p className="text-xs text-text-muted mt-1">
          Step 1: Account credentials. Profile photo is required next.
        </p>
      </div>

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-brand text-xs flex items-start gap-2">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <form
        onSubmit={handleSubmit}
        className="space-y-3.5 bg-surface p-5 rounded-brand border border-slate-200 shadow-sm"
      >
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">Full Name</label>
          <div className="relative">
            <User className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              required
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="e.g. Rahul Sharma"
              className="w-full text-xs pl-9 pr-3 py-2 border border-slate-300 rounded-brand outline-none focus:border-primary"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">Email Address</label>
          <div className="relative">
            <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="email"
              required
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              placeholder="you@example.com"
              className="w-full text-xs pl-9 pr-3 py-2 border border-slate-300 rounded-brand outline-none focus:border-primary"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">Password</label>
          <div className="relative">
            <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="password"
              required
              minLength={8}
              maxLength={128}
              value={formData.password}
              onChange={(e) => setFormData({ ...formData, password: e.target.value })}
              placeholder="At least 8 characters"
              className="w-full text-xs pl-9 pr-3 py-2 border border-slate-300 rounded-brand outline-none focus:border-primary"
            />
          </div>
        </div>

        <div className="pt-2 space-y-2 border-t border-slate-100">
          <label className="flex items-start gap-2 cursor-pointer text-xs text-slate-700">
            <input
              type="checkbox"
              checked={formData.confirmAge}
              onChange={(e) => setFormData({ ...formData, confirmAge: e.target.checked })}
              className="mt-0.5 rounded text-primary focus:ring-0"
            />
            <span>I confirm that I am at least 18 years of age.</span>
          </label>

          <label className="flex items-start gap-2 cursor-pointer text-xs text-slate-700">
            <input
              type="checkbox"
              checked={formData.acceptTerms}
              onChange={(e) => setFormData({ ...formData, acceptTerms: e.target.checked })}
              className="mt-0.5 rounded text-primary focus:ring-0"
            />
            <span>I accept the Terms of Service & Privacy Policy.</span>
          </label>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full py-2.5 bg-primary hover:bg-primary-dark text-white rounded-brand text-xs font-semibold transition mt-2 disabled:opacity-50"
        >
          {loading ? 'Creating Account...' : 'Continue to Step 2'}
        </button>
      </form>

      <div className="text-center">
        <button
          type="button"
          onClick={() => onNavigate('login')}
          className="text-xs text-primary hover:underline font-medium"
        >
          Already have an account? Log In
        </button>
      </div>
    </div>
  );
}

export default SignUpScreen;
