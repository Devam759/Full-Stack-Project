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
      <div className="max-w-md mx-auto p-4 pt-10 text-center space-y-5">
        <div className="inline-flex p-4 rounded-full bg-emerald-50 text-emerald-600 border border-emerald-100">
          <CheckCircle2 className="w-10 h-10" />
        </div>
        <h2 className="text-2xl font-heading font-black text-black tracking-tight">
          Check your email
        </h2>
        <p className="text-sm text-neutral-600 max-w-sm mx-auto">
          We sent a verification link to{' '}
          <span className="font-semibold text-black">{formData.email}</span>. Click the link to
          activate your account.
        </p>

        <div className="pt-4 space-y-3">
          <button
            type="button"
            onClick={() => onNavigate('login')}
            className="w-full py-3.5 bg-black hover:bg-neutral-800 text-white text-sm font-bold rounded-full transition shadow-xs"
          >
            Continue to log in
          </button>
          <button
            type="button"
            onClick={() => onNavigate('verify-email')}
            className="w-full py-3 bg-neutral-100 hover:bg-neutral-200 text-neutral-800 text-sm font-semibold rounded-full transition"
          >
            Enter token manually
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto p-4 space-y-6 pt-10">
      <div>
        <h1 className="text-3xl font-heading font-black tracking-tight text-black">
          Create an account
        </h1>
        <p className="text-sm text-neutral-500 mt-1">
          Step 1: Account credentials. Profile photo is required in Step 2.
        </p>
      </div>

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 text-red-700 rounded-2xl text-xs flex items-start gap-2.5">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0 text-red-600" />
          <span className="font-medium">{error}</span>
        </div>
      )}

      <form
        onSubmit={handleSubmit}
        className="space-y-4 bg-white p-6 sm:p-8 rounded-3xl border border-neutral-200 shadow-sm"
      >
        <div>
          <label className="block text-xs font-bold text-neutral-800 uppercase tracking-wider mb-1.5">
            Full name
          </label>
          <div className="relative">
            <User className="w-4 h-4 text-neutral-400 absolute left-3.5 top-3.5" />
            <input
              type="text"
              required
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="e.g. Rahul Sharma"
              className="w-full text-sm pl-10 pr-3.5 py-3 bg-neutral-100 hover:bg-neutral-100/80 focus:bg-white border border-transparent focus:border-black rounded-xl outline-none transition"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-bold text-neutral-800 uppercase tracking-wider mb-1.5">
            Email address
          </label>
          <div className="relative">
            <Mail className="w-4 h-4 text-neutral-400 absolute left-3.5 top-3.5" />
            <input
              type="email"
              required
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              placeholder="you@example.com"
              className="w-full text-sm pl-10 pr-3.5 py-3 bg-neutral-100 hover:bg-neutral-100/80 focus:bg-white border border-transparent focus:border-black rounded-xl outline-none transition"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-bold text-neutral-800 uppercase tracking-wider mb-1.5">
            Password
          </label>
          <div className="relative">
            <Lock className="w-4 h-4 text-neutral-400 absolute left-3.5 top-3.5" />
            <input
              type="password"
              required
              minLength={8}
              maxLength={128}
              value={formData.password}
              onChange={(e) => setFormData({ ...formData, password: e.target.value })}
              placeholder="At least 8 characters"
              className="w-full text-sm pl-10 pr-3.5 py-3 bg-neutral-100 hover:bg-neutral-100/80 focus:bg-white border border-transparent focus:border-black rounded-xl outline-none transition"
            />
          </div>
        </div>

        <div className="pt-2 space-y-2.5 border-t border-neutral-100">
          <label className="flex items-start gap-2.5 cursor-pointer text-xs text-neutral-700">
            <input
              type="checkbox"
              checked={formData.confirmAge}
              onChange={(e) => setFormData({ ...formData, confirmAge: e.target.checked })}
              className="mt-0.5 rounded accent-black focus:ring-0"
            />
            <span>I confirm that I am at least 18 years of age.</span>
          </label>

          <label className="flex items-start gap-2.5 cursor-pointer text-xs text-neutral-700">
            <input
              type="checkbox"
              checked={formData.acceptTerms}
              onChange={(e) => setFormData({ ...formData, acceptTerms: e.target.checked })}
              className="mt-0.5 rounded accent-black focus:ring-0"
            />
            <span>I accept the Terms of Service &amp; Privacy Policy.</span>
          </label>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full py-3.5 bg-black hover:bg-neutral-800 active:bg-neutral-900 text-white rounded-full text-sm font-bold transition shadow-xs mt-3 disabled:opacity-50"
        >
          {loading ? 'Creating account...' : 'Continue to photo verification'}
        </button>
      </form>

      <div className="text-center pt-2">
        <p className="text-sm text-neutral-600">
          Already have an account?{' '}
          <button
            type="button"
            onClick={() => onNavigate('login')}
            className="text-black hover:underline font-bold"
          >
            Log in
          </button>
        </p>
      </div>
    </div>
  );
}

export default SignUpScreen;
