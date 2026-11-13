import React, { useState } from 'react';
import {
  ShieldAlert,
  Users,
  Scale,
  Settings,
  Lock,
  Mail,
  KeyRound,
  AlertCircle,
  LogOut,
} from 'lucide-react';

export function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [step, setStep] = useState('credentials'); // 'credentials' | 'totp'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);

  const handleCredentialsSubmit = (e) => {
    e.preventDefault();
    setError('');

    if (!email || !password) {
      setError('Email and password are required');
      return;
    }

    setLoading(true);
    // Simulate auth credential validation step
    setTimeout(() => {
      setLoading(false);
      setStep('totp');
    }, 400);
  };

  const handleTotpSubmit = (e) => {
    e.preventDefault();
    setError('');

    const cleanTotp = totpCode.trim().replace(/\s+/g, '');
    if (!cleanTotp || cleanTotp.length !== 6 || !/^\d{6}$/.test(cleanTotp)) {
      setError('Please enter a valid 6-digit authenticator code');
      return;
    }

    setLoading(true);
    setTimeout(() => {
      setLoading(false);
      setIsAuthenticated(true);
      setCurrentUser({
        email,
        role: 'admin',
        name: 'Care Agent Admin',
      });
    }, 400);
  };

  const handleLogout = () => {
    setIsAuthenticated(false);
    setStep('credentials');
    setEmail('');
    setPassword('');
    setTotpCode('');
    setCurrentUser(null);
    setError('');
  };

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-100 p-4">
        <div className="max-w-md w-full bg-white rounded-lg border border-slate-200 shadow-sm p-6 space-y-6">
          <div className="flex items-center justify-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-teal-600 flex items-center justify-center text-white font-bold text-base">
              BL
            </div>
            <div>
              <h1 className="font-bold text-lg text-slate-900">BorrowLoop Operations</h1>
              <p className="text-xs text-slate-500">Care Agent & Admin Portal</p>
            </div>
          </div>

          {error && (
            <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded text-xs flex items-start gap-2">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {step === 'credentials' ? (
            <form onSubmit={handleCredentialsSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Admin Email
                </label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="admin@borrowloop.test"
                    className="w-full text-xs pl-9 pr-3 py-2 border border-slate-300 rounded outline-none focus:border-teal-600"
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
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••••••"
                    className="w-full text-xs pl-9 pr-3 py-2 border border-slate-300 rounded outline-none focus:border-teal-600"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-2 bg-teal-600 hover:bg-teal-700 text-white font-semibold rounded text-xs transition disabled:opacity-50"
              >
                {loading ? 'Verifying...' : 'Next: 2FA Authentication'}
              </button>
            </form>
          ) : (
            <form onSubmit={handleTotpSubmit} className="space-y-4">
              <div className="p-3 bg-teal-50 border border-teal-200 rounded text-xs text-teal-800">
                <p className="font-semibold">Two-Factor Authentication Required</p>
                <p className="mt-0.5 text-teal-700">
                  Enter the 6-digit verification code from your authenticator app (TOTP).
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">TOTP Code</label>
                <div className="relative">
                  <KeyRound className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                  <input
                    type="text"
                    required
                    maxLength={6}
                    autoFocus
                    value={totpCode}
                    onChange={(e) => setTotpCode(e.target.value)}
                    placeholder="123456"
                    className="w-full text-center text-sm tracking-widest pl-9 pr-3 py-2 border border-slate-300 rounded outline-none focus:border-teal-600 font-mono"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-2 bg-teal-600 hover:bg-teal-700 text-white font-semibold rounded text-xs transition disabled:opacity-50"
              >
                {loading ? 'Validating Token...' : 'Verify & Log In'}
              </button>

              <button
                type="button"
                onClick={() => setStep('credentials')}
                className="w-full text-center text-xs text-slate-500 hover:text-slate-800 py-1"
              >
                Back to credentials
              </button>
            </form>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-slate-100 text-slate-900">
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-teal-600 flex items-center justify-center text-white font-bold text-sm">
            BL
          </div>
          <div>
            <h1 className="font-bold text-base text-slate-900">BorrowLoop Operations Portal</h1>
            <p className="text-xs text-slate-500">Customer Care & Administration</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800">
            {currentUser?.email || 'Care Agent / Admin'} (2FA Verified)
          </span>
          <button
            type="button"
            onClick={handleLogout}
            className="flex items-center gap-1 px-2.5 py-1 text-xs text-slate-600 hover:text-red-700 border border-slate-300 rounded hover:bg-slate-50 transition"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Log out</span>
          </button>
        </div>
      </header>

      <div className="flex-1 max-w-7xl w-full mx-auto p-6 grid grid-cols-1 md:grid-cols-4 gap-6">
        <aside className="bg-white rounded-lg p-4 border border-slate-200 shadow-sm space-y-2">
          <button
            type="button"
            className="w-full flex items-center gap-3 px-3 py-2 rounded text-sm font-medium text-teal-700 bg-teal-50"
          >
            <Scale className="w-4 h-4" />
            <span>Disputes Queue</span>
          </button>
          <button
            type="button"
            className="w-full flex items-center gap-3 px-3 py-2 rounded text-sm font-medium text-slate-600 hover:bg-slate-50"
          >
            <ShieldAlert className="w-4 h-4" />
            <span>Reports</span>
          </button>
          <button
            type="button"
            className="w-full flex items-center gap-3 px-3 py-2 rounded text-sm font-medium text-slate-600 hover:bg-slate-50"
          >
            <Users className="w-4 h-4" />
            <span>User Lookup</span>
          </button>
          <button
            type="button"
            className="w-full flex items-center gap-3 px-3 py-2 rounded text-sm font-medium text-slate-600 hover:bg-slate-50"
          >
            <Settings className="w-4 h-4" />
            <span>Admin Settings</span>
          </button>
        </aside>

        <main className="md:col-span-3 bg-white rounded-lg p-6 border border-slate-200 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900 mb-2">Operations Dashboard</h2>
          <p className="text-sm text-slate-600">
            Care portal initialized for Phase 0. Case management and decision tools will be active
            upon completion of Phase 8.
          </p>
        </main>
      </div>
    </div>
  );
}

export default App;
