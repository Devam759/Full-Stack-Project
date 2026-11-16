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
    <div className="max-w-md mx-auto p-4 space-y-6 pt-10">
      <div>
        <h1 className="text-3xl font-heading font-black tracking-tight text-black">Welcome back</h1>
        <p className="text-sm text-neutral-500 mt-1">
          Log in with your credentials to access your BorrowLoop account.
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
        className="space-y-5 bg-white p-6 sm:p-8 rounded-3xl border border-neutral-200 shadow-sm"
      >
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

        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-xs font-bold text-neutral-800 uppercase tracking-wider">
              Password
            </label>
            <button
              type="button"
              onClick={() => onNavigate('forgot-password')}
              className="text-xs text-neutral-600 hover:text-black hover:underline font-medium"
            >
              Forgot password?
            </button>
          </div>
          <div className="relative">
            <Lock className="w-4 h-4 text-neutral-400 absolute left-3.5 top-3.5" />
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter your password"
              className="w-full text-sm pl-10 pr-3.5 py-3 bg-neutral-100 hover:bg-neutral-100/80 focus:bg-white border border-transparent focus:border-black rounded-xl outline-none transition"
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full py-3.5 bg-black hover:bg-neutral-800 active:bg-neutral-900 text-white rounded-full text-sm font-bold transition shadow-xs disabled:opacity-50"
        >
          {loading ? 'Authenticating...' : 'Log in'}
        </button>
      </form>

      <div className="text-center pt-2">
        <p className="text-sm text-neutral-600">
          Don&apos;t have an account?{' '}
          <button
            type="button"
            onClick={() => onNavigate('signup')}
            className="text-black hover:underline font-bold"
          >
            Sign up
          </button>
        </p>
      </div>
    </div>
  );
}

export default LoginScreen;
