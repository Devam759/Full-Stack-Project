import React, { useState, useEffect, useCallback } from 'react';
import {
  TrendingUp,
  DollarSign,
  AlertTriangle,
  Users,
  Package,
  Calendar,
  RefreshCw,
  Clock,
  ShieldAlert,
} from 'lucide-react';
import { formatPaise } from '../../utils.js';

export function AdminOverview({ token }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchOverview = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/v1/admin/analytics/overview', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(
          json?.message || json?.error?.message || 'Failed to load analytics overview',
        );
      }
      setData(json);
    } catch (err) {
      setError(err.message || 'Network error loading analytics overview');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchOverview();
  }, [fetchOverview]);

  if (loading && !data) {
    return (
      <div className="bg-white rounded-lg p-8 border border-slate-200 shadow-sm flex items-center justify-center gap-2 text-slate-500 text-sm">
        <RefreshCw className="w-4 h-4 animate-spin text-teal-600" />
        <span>Loading executive analytics...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-lg flex items-center justify-between text-sm">
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
        <button
          type="button"
          onClick={fetchOverview}
          className="px-3 py-1 bg-red-100 hover:bg-red-200 text-red-800 rounded font-medium text-xs"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-slate-900">Executive Analytics Overview</h2>
          <p className="text-xs text-slate-500">
            Live platform performance and operational metrics
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="px-2.5 py-1 bg-amber-100 text-amber-800 border border-amber-200 rounded-full text-xs font-bold">
            Demo money
          </span>
          <button
            type="button"
            onClick={fetchOverview}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded text-xs font-medium transition shadow-sm disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Primary Financial Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-lg border border-slate-200 shadow-sm space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500">Completed Volume</span>
            <DollarSign className="w-4 h-4 text-teal-600" />
          </div>
          <div className="text-xl font-bold text-slate-900">
            {formatPaise(data?.volumePaise || 0)}
          </div>
          <div className="text-xs text-amber-700 font-medium">Demo money • Excludes deposits</div>
        </div>

        <div className="bg-white p-4 rounded-lg border border-slate-200 shadow-sm space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500">Deposits Held</span>
            <ShieldAlert className="w-4 h-4 text-indigo-600" />
          </div>
          <div className="text-xl font-bold text-slate-900">
            {formatPaise(data?.depositsHeldPaise || 0)}
          </div>
          <div className="text-xs text-amber-700 font-medium">Demo money • Frozen in escrow</div>
        </div>

        <div className="bg-white p-4 rounded-lg border border-slate-200 shadow-sm space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500">Commission Earned</span>
            <TrendingUp className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="text-xl font-bold text-slate-900">
            {formatPaise(data?.commissionEarnedPaise || 0)}
          </div>
          <div className="text-xs text-amber-700 font-medium">Demo money • Net ledger revenue</div>
        </div>

        <div className="bg-white p-4 rounded-lg border border-slate-200 shadow-sm space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500">Dispute Ratio</span>
            <AlertTriangle className="w-4 h-4 text-amber-600" />
          </div>
          <div className="text-xl font-bold text-slate-900">
            {data?.disputeRatioPct !== undefined ? `${data.disputeRatioPct}%` : '0%'}
          </div>
          <div className="text-xs text-slate-500">
            {data?.openDisputesCount || 0} open • {data?.pendingAppealsCount || 0} pending appeals
          </div>
        </div>
      </div>

      {/* Operational Breakdown Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Users */}
        <div className="bg-white p-4 rounded-lg border border-slate-200 shadow-sm space-y-3">
          <div className="flex items-center justify-between border-b border-slate-100 pb-2">
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-slate-600" />
              <span className="font-semibold text-sm text-slate-900">Users</span>
            </div>
            <span className="text-sm font-bold text-slate-900">{data?.users?.total || 0}</span>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center text-xs">
            <div className="bg-slate-50 p-2 rounded">
              <span className="block text-slate-500">Active</span>
              <span className="font-bold text-emerald-700">{data?.users?.active || 0}</span>
            </div>
            <div className="bg-slate-50 p-2 rounded">
              <span className="block text-slate-500">Frozen</span>
              <span className="font-bold text-amber-700">{data?.users?.frozen || 0}</span>
            </div>
            <div className="bg-slate-50 p-2 rounded">
              <span className="block text-slate-500">Banned</span>
              <span className="font-bold text-red-700">{data?.users?.banned || 0}</span>
            </div>
          </div>
        </div>

        {/* Items */}
        <div className="bg-white p-4 rounded-lg border border-slate-200 shadow-sm space-y-3">
          <div className="flex items-center justify-between border-b border-slate-100 pb-2">
            <div className="flex items-center gap-2">
              <Package className="w-4 h-4 text-slate-600" />
              <span className="font-semibold text-sm text-slate-900">Items Catalog</span>
            </div>
            <span className="text-sm font-bold text-slate-900">{data?.items?.total || 0}</span>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center text-xs">
            <div className="bg-slate-50 p-2 rounded">
              <span className="block text-slate-500">Active</span>
              <span className="font-bold text-emerald-700">{data?.items?.active || 0}</span>
            </div>
            <div className="bg-slate-50 p-2 rounded">
              <span className="block text-slate-500">Paused</span>
              <span className="font-bold text-slate-700">{data?.items?.paused || 0}</span>
            </div>
            <div className="bg-slate-50 p-2 rounded">
              <span className="block text-slate-500">Hidden</span>
              <span className="font-bold text-amber-700">{data?.items?.hidden || 0}</span>
            </div>
          </div>
        </div>

        {/* Bookings & Active Rentals */}
        <div className="bg-white p-4 rounded-lg border border-slate-200 shadow-sm space-y-3">
          <div className="flex items-center justify-between border-b border-slate-100 pb-2">
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-slate-600" />
              <span className="font-semibold text-sm text-slate-900">Bookings</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-teal-600" />
              <span className="text-xs font-bold text-teal-700">
                {data?.rentedNow || 0} rented now
              </span>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center text-xs">
            <div className="bg-slate-50 p-2 rounded">
              <span className="block text-slate-500">Requested</span>
              <span className="font-bold text-slate-700">
                {data?.bookings?.byStatus?.requested || 0}
              </span>
            </div>
            <div className="bg-slate-50 p-2 rounded">
              <span className="block text-slate-500">Active</span>
              <span className="font-bold text-teal-700">{data?.rentedNow || 0}</span>
            </div>
            <div className="bg-slate-50 p-2 rounded">
              <span className="block text-slate-500">Completed</span>
              <span className="font-bold text-emerald-700">
                {data?.bookings?.byStatus?.completed || 0}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default AdminOverview;
