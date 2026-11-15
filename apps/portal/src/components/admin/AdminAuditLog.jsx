import React, { useState, useEffect, useCallback } from 'react';
import { ChevronDown, ChevronRight, AlertTriangle, RefreshCw } from 'lucide-react';

export function AdminAuditLog({ token }) {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [nextCursor, setNextCursor] = useState(null);

  // Filters
  const [actionFilter, setActionFilter] = useState('');
  const [targetTypeFilter, setTargetTypeFilter] = useState('');
  const [expandedId, setExpandedId] = useState(null);

  const fetchLogs = useCallback(
    async (cursor = null) => {
      setLoading(true);
      setError('');
      try {
        const params = new URLSearchParams();
        if (actionFilter.trim()) params.append('action', actionFilter.trim());
        if (targetTypeFilter.trim()) params.append('targetType', targetTypeFilter.trim());
        if (cursor) params.append('cursor', cursor);
        params.append('limit', '25');

        const res = await fetch(`/v1/admin/audit-log?${params.toString()}`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data?.message || data?.error?.message || 'Failed to load audit logs');
        }
        setLogs(data.logs || []);
        setNextCursor(data.nextCursor || null);
      } catch (err) {
        setError(err.message || 'Error fetching audit logs');
      } finally {
        setLoading(false);
      }
    },
    [actionFilter, targetTypeFilter, token],
  );

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  const toggleExpand = (id) => {
    setExpandedId((prev) => (prev === id ? null : id));
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-slate-900">Immutable Audit Trail</h2>
          <p className="text-xs text-slate-500">
            Append-only security log tracking administrative and care operations with masked PII
          </p>
        </div>
        <button
          type="button"
          onClick={() => fetchLogs()}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded text-xs font-medium shadow-sm"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>Refresh</span>
        </button>
      </div>

      {/* Filters Toolbar */}
      <div className="bg-white p-4 rounded-lg border border-slate-200 shadow-sm flex flex-col sm:flex-row gap-3">
        <div className="flex-1">
          <input
            type="text"
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            placeholder="Filter by Action (e.g. user_banned, ad_master_enabled)..."
            className="w-full text-xs px-3 py-2 border border-slate-300 rounded outline-none focus:border-teal-600 font-mono"
          />
        </div>
        <div className="sm:w-64">
          <input
            type="text"
            value={targetTypeFilter}
            onChange={(e) => setTargetTypeFilter(e.target.value)}
            placeholder="Filter by Target Type (e.g. user, dispute)..."
            className="w-full text-xs px-3 py-2 border border-slate-300 rounded outline-none focus:border-teal-600 font-mono"
          />
        </div>
      </div>

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded text-xs flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Audit Log Table */}
      <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                <th className="p-3 w-8"></th>
                <th className="p-3">Timestamp</th>
                <th className="p-3">Actor Role</th>
                <th className="p-3">Action</th>
                <th className="p-3">Target Type</th>
                <th className="p-3 font-mono">Target ID</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {logs.map((row) => (
                <React.Fragment key={row._id}>
                  <tr
                    onClick={() => toggleExpand(row._id)}
                    className="hover:bg-slate-50 cursor-pointer transition select-none"
                  >
                    <td className="p-3 text-slate-400">
                      {expandedId === row._id ? (
                        <ChevronDown className="w-4 h-4 text-teal-600" />
                      ) : (
                        <ChevronRight className="w-4 h-4" />
                      )}
                    </td>
                    <td className="p-3 text-slate-500 font-mono text-[11px]">
                      {new Date(row.createdAt).toLocaleString()}
                    </td>
                    <td className="p-3">
                      <span className="px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider bg-slate-100 text-slate-700">
                        {row.actorRole}
                      </span>
                    </td>
                    <td className="p-3 font-mono font-bold text-slate-900">{row.action}</td>
                    <td className="p-3 font-mono text-slate-600">{row.targetType}</td>
                    <td className="p-3 font-mono text-slate-500 text-[11px] truncate max-w-xs">
                      {row.targetId}
                    </td>
                  </tr>

                  {expandedId === row._id && (
                    <tr className="bg-slate-50/70 border-b border-slate-200">
                      <td colSpan={6} className="p-4 space-y-3">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                          <div className="bg-white p-3 rounded border border-slate-200 space-y-1">
                            <span className="font-semibold text-slate-700 block">Before State</span>
                            <pre className="text-[11px] font-mono text-slate-800 overflow-x-auto max-h-40">
                              {JSON.stringify(row.before, null, 2) || 'null'}
                            </pre>
                          </div>

                          <div className="bg-white p-3 rounded border border-slate-200 space-y-1">
                            <span className="font-semibold text-slate-700 block">After State</span>
                            <pre className="text-[11px] font-mono text-slate-800 overflow-x-auto max-h-40">
                              {JSON.stringify(row.after, null, 2) || 'null'}
                            </pre>
                          </div>
                        </div>

                        {row.after?.reason && (
                          <div className="bg-white p-2.5 rounded border border-slate-200 text-xs">
                            <span className="font-semibold text-slate-700">
                              Audit Justification:{' '}
                            </span>
                            <span className="italic text-slate-800">
                              &ldquo;{row.after.reason}&rdquo;
                            </span>
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
              {logs.length === 0 && !loading && (
                <tr>
                  <td colSpan={6} className="p-6 text-center text-slate-500">
                    No audit records matching criteria.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {nextCursor && (
          <div className="p-3 bg-slate-50 border-t border-slate-200 flex justify-center">
            <button
              type="button"
              onClick={() => fetchLogs(nextCursor)}
              disabled={loading}
              className="px-4 py-1.5 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded text-xs font-medium"
            >
              {loading ? 'Loading...' : 'Load Next Page'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default AdminAuditLog;
