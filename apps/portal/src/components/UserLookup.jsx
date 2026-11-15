import React, { useState } from 'react';
import { Search, Shield, AlertTriangle, Clock, AlertOctagon, RefreshCw } from 'lucide-react';

export function UserLookup({ token }) {
  const [userIdInput, setUserIdInput] = useState('');
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleLookup = async (e) => {
    e?.preventDefault();
    const cleanId = userIdInput.trim();
    if (!cleanId) {
      setError('Please enter a valid User ID to lookup.');
      return;
    }

    setLoading(true);
    setError('');
    setProfile(null);
    try {
      const res = await fetch(`/v1/care/users/${cleanId}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.message || data?.error?.message || 'User not found');
      }

      setProfile(data.user);
    } catch (err) {
      setError(err.message || 'Error looking up user profile');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="pb-4 border-b border-slate-200">
        <h2 className="text-xl font-bold text-slate-900">Care Agent User Lookup</h2>
        <p className="text-xs text-slate-500 mt-1">
          Inspect user account status, trust metrics, strikes, and activity. Masked emails only.
        </p>
      </div>

      {/* Search Bar */}
      <form onSubmit={handleLookup} className="flex gap-2 max-w-xl">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
          <input
            type="text"
            required
            value={userIdInput}
            onChange={(e) => setUserIdInput(e.target.value)}
            placeholder="Enter MongoDB User ID (e.g. 6af9...)"
            className="w-full text-xs pl-9 pr-3 py-2 border border-slate-300 rounded outline-none focus:border-teal-600 font-mono"
          />
        </div>
        <button
          type="submit"
          disabled={loading}
          className="px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white font-semibold text-xs rounded transition disabled:opacity-50 flex items-center gap-1.5"
        >
          {loading ? (
            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Search className="w-3.5 h-3.5" />
          )}
          <span>Lookup</span>
        </button>
      </form>

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded text-xs flex items-center gap-2 max-w-xl">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* User Profile Card */}
      {profile && (
        <div className="bg-white rounded-lg border border-slate-200 shadow-sm p-6 space-y-6 max-w-3xl">
          {/* Top Banner */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-full bg-teal-100 text-teal-800 flex items-center justify-center font-bold text-lg">
                {profile.name ? profile.name[0].toUpperCase() : 'U'}
              </div>
              <div>
                <h3 className="font-bold text-base text-slate-900">{profile.name}</h3>
                <p className="text-xs text-slate-500 font-mono">
                  Masked Email:{' '}
                  <span className="font-semibold text-slate-700">{profile.email}</span>
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <span
                className={`text-xs px-2.5 py-1 rounded-full font-bold ${
                  profile.status === 'active'
                    ? 'bg-emerald-100 text-emerald-800'
                    : profile.status === 'frozen'
                      ? 'bg-amber-100 text-amber-800'
                      : 'bg-red-100 text-red-800'
                }`}
              >
                Status: {profile.status.toUpperCase()}
              </span>
              <span className="text-xs px-2 py-1 rounded bg-slate-100 text-slate-600 font-mono">
                Role: {profile.role}
              </span>
            </div>
          </div>

          {/* Metrics Grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
            <div className="p-3 bg-slate-50 rounded border border-slate-200 space-y-1">
              <span className="text-slate-500 font-semibold flex items-center gap-1">
                <Shield className="w-3.5 h-3.5 text-teal-600" />
                Trust Score
              </span>
              <p className="text-lg font-bold text-slate-900">{profile.trustScore ?? 50} / 100</p>
            </div>

            <div className="p-3 bg-slate-50 rounded border border-slate-200 space-y-1">
              <span className="text-slate-500 font-semibold flex items-center gap-1">
                <AlertOctagon className="w-3.5 h-3.5 text-red-600" />
                Strikes
              </span>
              <p className="text-lg font-bold text-slate-900">{profile.strikesCount ?? 0} / 3</p>
            </div>

            <div className="p-3 bg-slate-50 rounded border border-slate-200 space-y-1">
              <span className="text-slate-500 font-semibold flex items-center gap-1">
                <Clock className="w-3.5 h-3.5 text-blue-600" />
                Recent Bookings
              </span>
              <p className="text-lg font-bold text-slate-900">{profile.bookingStats?.total ?? 0}</p>
            </div>

            <div className="p-3 bg-slate-50 rounded border border-slate-200 space-y-1">
              <span className="text-slate-500 font-semibold flex items-center gap-1">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
                Reports Against
              </span>
              <p className="text-lg font-bold text-slate-900">{profile.reportCount ?? 0}</p>
            </div>
          </div>

          {/* Account Metadata */}
          <div className="pt-2 border-t border-slate-100 text-xs text-slate-500 space-y-1">
            <p>
              <strong>User ID:</strong> <span className="font-mono">{profile._id}</span>
            </p>
            <p>
              <strong>Member Since:</strong> {new Date(profile.createdAt).toLocaleDateString()}
            </p>
            <p className="text-slate-400 italic mt-2">
              Note: Full email, plain coordinates, and payment secrets are redacted for privacy and
              security.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

export default UserLookup;
