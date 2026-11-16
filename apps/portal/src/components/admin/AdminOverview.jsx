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
  BarChart2,
  PieChart as PieIcon,
} from 'lucide-react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Cell,
  PieChart,
  Pie,
  Legend,
  CartesianGrid,
} from 'recharts';
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

  const financialChartData = [
    {
      name: 'Volume',
      amount: Math.round((data?.volumePaise || 0) / 100),
      color: '#0d9488',
    },
    {
      name: 'Escrow Held',
      amount: Math.round((data?.depositsHeldPaise || 0) / 100),
      color: '#6366f1',
    },
    {
      name: 'Commission',
      amount: Math.round((data?.commissionEarnedPaise || 0) / 100),
      color: '#10b981',
    },
  ];

  const bookingStatusData = [
    { name: 'Completed', value: data?.bookings?.byStatus?.completed || 0, color: '#10b981' },
    { name: 'Rented Now', value: data?.rentedNow || 0, color: '#0d9488' },
    { name: 'Requested', value: data?.bookings?.byStatus?.requested || 0, color: '#64748b' },
    { name: 'Disputed', value: data?.openDisputesCount || 0, color: '#f59e0b' },
  ].filter((item) => item.value > 0);

  // Fallback if no bookings exist yet in demo
  const displayStatusData =
    bookingStatusData.length > 0
      ? bookingStatusData
      : [{ name: 'No Bookings Yet', value: 1, color: '#cbd5e1' }];

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

      {/* Visual Analytics Charts (Part C Advanced Feature) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Financial Flow Bar Chart */}
        <div className="bg-white p-5 rounded-lg border border-slate-200 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <BarChart2 className="w-4 h-4 text-teal-600" />
              <h3 className="font-semibold text-sm text-slate-900">
                Financial Liquidity & Revenue
              </h3>
            </div>
            <span className="text-xs text-slate-400 font-medium">Amount in ₹</span>
          </div>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%" minWidth={100} minHeight={100}>
              <BarChart
                data={financialChartData}
                margin={{ top: 20, right: 20, left: -10, bottom: 5 }}
              >
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis
                  dataKey="name"
                  tick={{ fontSize: 12, fill: '#64748b' }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                <Tooltip
                  formatter={(val) => [`₹${Number(val).toLocaleString('en-IN')}`, 'Amount']}
                  contentStyle={{
                    backgroundColor: '#ffffff',
                    borderRadius: '8px',
                    border: '1px solid #e2e8f0',
                    fontSize: '12px',
                  }}
                />
                <Bar dataKey="amount" radius={[4, 4, 0, 0]}>
                  {financialChartData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="text-[11px] text-slate-400 text-center">
            Computed in real-time from double-entry ledger transactions
          </div>
        </div>

        {/* Booking Status Distribution Donut Chart */}
        <div className="bg-white p-5 rounded-lg border border-slate-200 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <PieIcon className="w-4 h-4 text-indigo-600" />
              <h3 className="font-semibold text-sm text-slate-900">Booking Status Breakdown</h3>
            </div>
            <span className="text-xs text-slate-400 font-medium">Lifecycle States</span>
          </div>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%" minWidth={100} minHeight={100}>
              <PieChart>
                <Pie
                  data={displayStatusData}
                  cx="50%"
                  cy="50%"
                  innerRadius={55}
                  outerRadius={80}
                  paddingAngle={4}
                  dataKey="value"
                >
                  {displayStatusData.map((entry, index) => (
                    <Cell key={`status-cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(val, name) => [val, name]}
                  contentStyle={{
                    backgroundColor: '#ffffff',
                    borderRadius: '8px',
                    border: '1px solid #e2e8f0',
                    fontSize: '12px',
                  }}
                />
                <Legend
                  verticalAlign="bottom"
                  height={36}
                  iconType="circle"
                  formatter={(value) => <span className="text-xs text-slate-600">{value}</span>}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="text-[11px] text-slate-400 text-center">
            MongoDB $facet aggregation across all booking state machine records
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
