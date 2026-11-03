import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { Mail, Lock, AlertCircle } from 'lucide-react';

export function LoginScreen({ onNavigate }) {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await login(email, password);
      if (res.requiresPhoto) {
        onNavigate('photo-step');
      } else {
        onNavigate('home');
      }
    } catch (err) {
      // Uniform generic error for security
      setError(err.message || 'Invalid email or password');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-md mx-auto p-4 space-y-5 pt-8">
      <div className="text-center">
        <h1 className="text-xl font-heading font-bold text-slate-900">Welcome Back</h1>
        <p className="text-xs text-text-muted mt-1">Log in to your BorrowLoop account</p>
      </div>

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-brand text-xs flex items-start gap-2">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <form
        onSubmit={handleSubmit}
        className="space-y-4 bg-surface p-5 rounded-brand border border-slate-200 shadow-sm"
      >
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

        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs font-semibold text-slate-700">Password</label>
            <button
              type="button"
              onClick={() => onNavigate('forgot-password')}
              className="text-[11px] text-primary hover:underline"
            >
              Forgot password?
            </button>
          </div>
          <div className="relative">
            <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full text-xs pl-9 pr-3 py-2 border border-slate-300 rounded-brand outline-none focus:border-primary"
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full py-2.5 bg-primary hover:bg-primary-dark text-white rounded-brand text-xs font-semibold transition mt-2 disabled:opacity-50"
        >
          {loading ? 'Authenticating...' : 'Log In'}
        </button>
      </form>

      <div className="text-center">
        <button
          type="button"
          onClick={() => onNavigate('signup')}
          className="text-xs text-primary hover:underline font-medium"
        >
          Don&apos;t have an account? Sign Up
        </button>
      </div>
    </div>
  );
}

export default LoginScreen;
