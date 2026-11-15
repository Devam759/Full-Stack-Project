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
  TrendingUp,
  Building,
  UserCheck,
  FileSpreadsheet,
  FileText,
  Megaphone,
} from 'lucide-react';
import DisputeQueue from './components/DisputeQueue.jsx';
import CaseFileView from './components/CaseFileView.jsx';
import ModerationQueue from './components/ModerationQueue.jsx';
import UserLookup from './components/UserLookup.jsx';

// Phase 9 Admin Portal Components
import AdminOverview from './components/admin/AdminOverview.jsx';
import AdminUsers from './components/admin/AdminUsers.jsx';
import AdminCommunities from './components/admin/AdminCommunities.jsx';
import AdminStaff from './components/admin/AdminStaff.jsx';
import AdminAppeals from './components/admin/AdminAppeals.jsx';
import AdminReconciliation from './components/admin/AdminReconciliation.jsx';
import AdminAuditLog from './components/admin/AdminAuditLog.jsx';
import AdminAds from './components/admin/AdminAds.jsx';

import { maskEmail } from './utils.js';

export function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [step, setStep] = useState('credentials'); // 'credentials' | 'totp'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const [tempToken, setTempToken] = useState('');
  const [token, setToken] = useState('');

  // Portal Navigation State
  const [activeNav, setActiveNav] = useState('disputes');
  const [selectedDisputeId, setSelectedDisputeId] = useState(null);

  const handleCredentialsSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!email || !password) {
      setError('Email and password are required');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/v1/portal/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.message || data?.error?.message || 'Invalid credentials');
      }
      setTempToken(data.tempToken);
      setStep('totp');
    } catch (err) {
      setError(err.message || 'Network error: failed to connect to portal service');
    } finally {
      setLoading(false);
    }
  };

  const handleTotpSubmit = async (e) => {
    e.preventDefault();
    setError('');

    const cleanTotp = totpCode.trim().replace(/\s+/g, '');
    if (!cleanTotp || cleanTotp.length !== 6 || !/^\d{6}$/.test(cleanTotp)) {
      setError('Please enter a valid 6-digit authenticator code');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/v1/portal/auth/totp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tempToken, totpCode: cleanTotp }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.message || data?.error?.message || 'Invalid authenticator code');
      }
      setIsAuthenticated(true);
      const user = data.user || { email, role: 'admin', name: 'Operations Team' };
      setCurrentUser(user);
      setToken(data.accessToken || '');

      // Admins land on Overview; Care agents land on Disputes
      if (user.role === 'admin') {
        setActiveNav('admin-overview');
      } else {
        setActiveNav('disputes');
      }
    } catch (err) {
      setError(err.message || 'Network error: failed to verify authenticator code');
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    setIsAuthenticated(false);
    setStep('credentials');
    setEmail('');
    setPassword('');
    setTotpCode('');
    setTempToken('');
    setToken('');
    setCurrentUser(null);
    setError('');
    setActiveNav('disputes');
    setSelectedDisputeId(null);
  };

  const isAdmin = currentUser?.role === 'admin';

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
                  Portal Email
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
            <p className="text-xs text-slate-500">
              {isAdmin ? 'Full Administrative Control' : 'Customer Care Workspace'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-amber-100 text-amber-800 border border-amber-200">
            Demo money
          </span>

          {isAdmin ? (
            <span className="px-2 py-0.5 rounded text-xs font-bold bg-purple-100 text-purple-800 border border-purple-200 uppercase tracking-wider">
              Admin
            </span>
          ) : (
            <span className="px-2 py-0.5 rounded text-xs font-semibold bg-blue-100 text-blue-800">
              Care Agent
            </span>
          )}

          <span className="text-xs font-mono font-medium text-slate-700">
            {maskEmail(currentUser?.email)}
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
        <aside className="bg-white rounded-lg p-4 border border-slate-200 shadow-sm space-y-4 h-fit">
          {/* Admin Navigation Section (ONLY rendered for Admin users) */}
          {isAdmin && (
            <div className="space-y-1">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider px-3 block mb-1">
                Administration
              </span>
              <button
                type="button"
                onClick={() => {
                  setActiveNav('admin-overview');
                  setSelectedDisputeId(null);
                }}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded text-xs font-medium transition ${
                  activeNav === 'admin-overview'
                    ? 'text-teal-700 bg-teal-50'
                    : 'text-slate-600 hover:bg-slate-50'
                }`}
              >
                <TrendingUp className="w-4 h-4" />
                <span>Overview & Analytics</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setActiveNav('admin-users');
                  setSelectedDisputeId(null);
                }}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded text-xs font-medium transition ${
                  activeNav === 'admin-users'
                    ? 'text-teal-700 bg-teal-50'
                    : 'text-slate-600 hover:bg-slate-50'
                }`}
              >
                <Users className="w-4 h-4" />
                <span>User Moderation</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setActiveNav('admin-communities');
                  setSelectedDisputeId(null);
                }}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded text-xs font-medium transition ${
                  activeNav === 'admin-communities'
                    ? 'text-teal-700 bg-teal-50'
                    : 'text-slate-600 hover:bg-slate-50'
                }`}
              >
                <Building className="w-4 h-4" />
                <span>Communities</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setActiveNav('admin-staff');
                  setSelectedDisputeId(null);
                }}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded text-xs font-medium transition ${
                  activeNav === 'admin-staff'
                    ? 'text-teal-700 bg-teal-50'
                    : 'text-slate-600 hover:bg-slate-50'
                }`}
              >
                <UserCheck className="w-4 h-4" />
                <span>Staff Management</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setActiveNav('admin-appeals');
                  setSelectedDisputeId(null);
                }}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded text-xs font-medium transition ${
                  activeNav === 'admin-appeals'
                    ? 'text-teal-700 bg-teal-50'
                    : 'text-slate-600 hover:bg-slate-50'
                }`}
              >
                <Scale className="w-4 h-4" />
                <span>Dispute Appeals</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setActiveNav('admin-reconciliation');
                  setSelectedDisputeId(null);
                }}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded text-xs font-medium transition ${
                  activeNav === 'admin-reconciliation'
                    ? 'text-teal-700 bg-teal-50'
                    : 'text-slate-600 hover:bg-slate-50'
                }`}
              >
                <FileSpreadsheet className="w-4 h-4" />
                <span>Ledger Reconciliation</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setActiveNav('admin-audit');
                  setSelectedDisputeId(null);
                }}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded text-xs font-medium transition ${
                  activeNav === 'admin-audit'
                    ? 'text-teal-700 bg-teal-50'
                    : 'text-slate-600 hover:bg-slate-50'
                }`}
              >
                <FileText className="w-4 h-4" />
                <span>Audit Trail</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setActiveNav('admin-ads');
                  setSelectedDisputeId(null);
                }}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded text-xs font-medium transition ${
                  activeNav === 'admin-ads'
                    ? 'text-teal-700 bg-teal-50'
                    : 'text-slate-600 hover:bg-slate-50'
                }`}
              >
                <Megaphone className="w-4 h-4" />
                <span>Ads & Monetization</span>
              </button>
            </div>
          )}

          {/* Operations Section (Visible to both Care Agent & Admin) */}
          <div className="space-y-1">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider px-3 block mb-1">
              Operations Care
            </span>
            <button
              type="button"
              onClick={() => {
                setActiveNav('disputes');
                setSelectedDisputeId(null);
              }}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded text-xs font-medium transition ${
                activeNav === 'disputes'
                  ? 'text-teal-700 bg-teal-50'
                  : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              <Scale className="w-4 h-4" />
              <span>Disputes Queue</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setActiveNav('moderation');
                setSelectedDisputeId(null);
              }}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded text-xs font-medium transition ${
                activeNav === 'moderation'
                  ? 'text-teal-700 bg-teal-50'
                  : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              <ShieldAlert className="w-4 h-4" />
              <span>Reports & Moderation</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setActiveNav('users');
                setSelectedDisputeId(null);
              }}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded text-xs font-medium transition ${
                activeNav === 'users'
                  ? 'text-teal-700 bg-teal-50'
                  : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              <Users className="w-4 h-4" />
              <span>User Lookup</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setActiveNav('settings');
                setSelectedDisputeId(null);
              }}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded text-xs font-medium transition ${
                activeNav === 'settings'
                  ? 'text-teal-700 bg-teal-50'
                  : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              <Settings className="w-4 h-4" />
              <span>System Status</span>
            </button>
          </div>
        </aside>

        <main className="md:col-span-3">
          {/* Admin Routes (Guarded: Only rendered if isAdmin) */}
          {isAdmin && activeNav === 'admin-overview' && <AdminOverview token={token} />}
          {isAdmin && activeNav === 'admin-users' && <AdminUsers token={token} />}
          {isAdmin && activeNav === 'admin-communities' && <AdminCommunities token={token} />}
          {isAdmin && activeNav === 'admin-staff' && <AdminStaff token={token} />}
          {isAdmin && activeNav === 'admin-appeals' && <AdminAppeals token={token} />}
          {isAdmin && activeNav === 'admin-reconciliation' && <AdminReconciliation token={token} />}
          {isAdmin && activeNav === 'admin-audit' && <AdminAuditLog token={token} />}
          {isAdmin && activeNav === 'admin-ads' && <AdminAds token={token} />}

          {/* Care Agent Routes */}
          {activeNav === 'disputes' && (
            <>
              {selectedDisputeId ? (
                <CaseFileView
                  disputeId={selectedDisputeId}
                  token={token}
                  currentUser={currentUser}
                  onBack={() => setSelectedDisputeId(null)}
                />
              ) : (
                <DisputeQueue token={token} onSelectDispute={(id) => setSelectedDisputeId(id)} />
              )}
            </>
          )}

          {activeNav === 'moderation' && <ModerationQueue token={token} />}

          {activeNav === 'users' && <UserLookup token={token} />}

          {activeNav === 'settings' && (
            <div className="bg-white rounded-lg p-6 border border-slate-200 shadow-sm space-y-4">
              <h2 className="text-lg font-bold text-slate-900">System Operations & Status</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                <div className="p-3 bg-slate-50 rounded border border-slate-200 space-y-1">
                  <span className="font-semibold text-slate-700">Environment</span>
                  <p className="text-slate-900 font-mono">BorrowLoop v0.1.0 • Phase 9 Active</p>
                </div>
                <div className="p-3 bg-slate-50 rounded border border-slate-200 space-y-1">
                  <span className="font-semibold text-slate-700">Audit Trail Enforcement</span>
                  <p className="text-emerald-700 font-bold">Enabled (writeAuditLogTx Strict)</p>
                </div>
                <div className="p-3 bg-slate-50 rounded border border-slate-200 space-y-1">
                  <span className="font-semibold text-slate-700">Ledger Monetary Integrity</span>
                  <p className="text-emerald-700 font-bold">Double-Entry Zero-Sum Guarded</p>
                </div>
                <div className="p-3 bg-slate-50 rounded border border-slate-200 space-y-1">
                  <span className="font-semibold text-slate-700">Security & Privacy Mode</span>
                  <p className="text-slate-900 font-mono">Masked Emails • No Coordinates Logged</p>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

export default App;
