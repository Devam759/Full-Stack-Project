import React, { useState, useEffect, useCallback } from 'react';
import {
  AlertTriangle,
  Clock,
  User,
  Filter,
  CheckCircle,
  FileText,
  ChevronRight,
  RefreshCw,
} from 'lucide-react';

export function DisputeQueue({ token, onSelectDispute }) {
  const [activeTab, setActiveTab] = useState('unassigned'); // 'my_disputes' | 'unassigned' | 'all'
  const [reasonFilter, setReasonFilter] = useState('all');
  const [disputes, setDisputes] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const fetchDisputes = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (activeTab === 'my_disputes') {
        params.append('assignedToMe', 'true');
      } else if (activeTab === 'unassigned') {
        params.append('status', 'opened');
      }

      if (reasonFilter !== 'all') {
        params.append('reason', reasonFilter);
      }

      params.append('limit', '50');

      const res = await fetch(`/v1/care/disputes?${params.toString()}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.message || data?.error?.message || 'Failed to load disputes');
      }

      // Sort by oldest first (createdAt ascending)
      const list = (data.disputes || []).sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      );
      setDisputes(list);
    } catch (err) {
      setError(err.message || 'Error fetching dispute queue');
    } finally {
      setLoading(false);
    }
  }, [activeTab, reasonFilter, token]);

  useEffect(() => {
    fetchDisputes();
  }, [fetchDisputes]);

  const isEscalated = (d) => {
    if (d.isEscalated) return true;
    if (d.status === 'opened' && !d.assignedAgentId) {
      const ageHours = (Date.now() - new Date(d.createdAt).getTime()) / (1000 * 3600);
      return ageHours >= 24;
    }
    return false;
  };

  const getReasonLabel = (reason) => {
    switch (reason) {
      case 'damage':
        return 'Item Damage';
      case 'not_returned':
        return 'Not Returned';
      case 'condition_mismatch':
        return 'Condition Mismatch';
      case 'no_show':
        return 'No Show';
      default:
        return reason;
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Dispute Resolution Queue</h2>
          <p className="text-xs text-slate-500 mt-1">
            Review cases, audit evidence, and execute binding double-entry settlements.
          </p>
        </div>
        <button
          type="button"
          onClick={fetchDisputes}
          disabled={loading}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-white border border-slate-300 rounded hover:bg-slate-50 transition text-slate-700 disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>Refresh</span>
        </button>
      </div>

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded text-xs flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Tabs and Reason Filter Bar */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex border-b border-slate-200 w-full md:w-auto">
          <button
            type="button"
            onClick={() => setActiveTab('unassigned')}
            className={`px-4 py-2 text-xs font-bold border-b-2 transition -mb-px ${
              activeTab === 'unassigned'
                ? 'border-teal-600 text-teal-700'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            Unassigned Queue
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('my_disputes')}
            className={`px-4 py-2 text-xs font-bold border-b-2 transition -mb-px ${
              activeTab === 'my_disputes'
                ? 'border-teal-600 text-teal-700'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            My Assigned Disputes
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('all')}
            className={`px-4 py-2 text-xs font-bold border-b-2 transition -mb-px ${
              activeTab === 'all'
                ? 'border-teal-600 text-teal-700'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            All Disputes
          </button>
        </div>

        <div className="flex items-center gap-2 w-full md:w-auto">
          <Filter className="w-3.5 h-3.5 text-slate-400" />
          <span className="text-xs text-slate-600 font-semibold">Reason:</span>
          <select
            value={reasonFilter}
            onChange={(e) => setReasonFilter(e.target.value)}
            className="text-xs border border-slate-300 rounded px-2.5 py-1.5 bg-white outline-none focus:border-teal-600"
          >
            <option value="all">All Reasons</option>
            <option value="damage">Damage Claim</option>
            <option value="not_returned">Item Not Returned</option>
            <option value="condition_mismatch">Condition Mismatch</option>
            <option value="no_show">No Show</option>
          </select>
        </div>
      </div>

      {/* Disputes List */}
      <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
        {loading && (
          <div className="p-8 text-center text-xs text-slate-500">
            <RefreshCw className="w-5 h-5 mx-auto mb-2 animate-spin text-teal-600" />
            Loading queue...
          </div>
        )}

        {!loading && disputes.length === 0 && (
          <div className="p-8 text-center text-slate-500 space-y-2">
            <CheckCircle className="w-8 h-8 mx-auto text-emerald-500" />
            <p className="text-sm font-semibold text-slate-700">No disputes found</p>
            <p className="text-xs">There are currently no active disputes matching this filter.</p>
          </div>
        )}

        {!loading && disputes.length > 0 && (
          <div className="divide-y divide-slate-200">
            {disputes.map((d) => {
              const escalated = isEscalated(d);
              return (
                <div
                  key={d._id}
                  onClick={() => onSelectDispute(d._id)}
                  className="p-4 hover:bg-slate-50 transition cursor-pointer flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                >
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-xs text-slate-900">
                        Dispute #{d._id.substring(d._id.length - 8)}
                      </span>
                      <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-slate-100 text-slate-700">
                        {getReasonLabel(d.disputeReason)}
                      </span>
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full font-semibold ${
                          d.status === 'opened'
                            ? 'bg-amber-100 text-amber-800'
                            : d.status === 'assigned'
                              ? 'bg-blue-100 text-blue-800'
                              : d.status === 'decided'
                                ? 'bg-emerald-100 text-emerald-800'
                                : d.status === 'appealed'
                                  ? 'bg-purple-100 text-purple-800'
                                  : 'bg-slate-200 text-slate-800'
                        }`}
                      >
                        {d.status.toUpperCase()}
                      </span>
                      {escalated && (
                        <span className="text-xs px-2 py-0.5 rounded-full font-bold bg-red-100 text-red-800 flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3" />
                          Escalated (&gt;24h)
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-4 text-xs text-slate-500 flex-wrap">
                      <span className="flex items-center gap-1">
                        <FileText className="w-3.5 h-3.5 text-slate-400" />
                        Booking: {d.bookingId?.substring?.(d.bookingId.length - 8) || d.bookingId}
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5 text-slate-400" />
                        Opened {new Date(d.createdAt).toLocaleString()} (Oldest First)
                      </span>
                      <span className="flex items-center gap-1">
                        <User className="w-3.5 h-3.5 text-slate-400" />
                        Agent:{' '}
                        {d.assignedAgentId ? `#${d.assignedAgentId.substring(18)}` : 'Unassigned'}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-teal-700 bg-teal-50 hover:bg-teal-100 rounded transition"
                    >
                      <span>Open Case File</span>
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export default DisputeQueue;
