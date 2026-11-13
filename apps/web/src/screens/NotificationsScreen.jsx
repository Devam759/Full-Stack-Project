/**
 * @file apps/web/src/screens/NotificationsScreen.jsx
 * Full notifications center screen with pagination, filters, and read actions.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Bell, Check, ExternalLink } from 'lucide-react';
import { apiRequest } from '../api/client.js';
import { useSocket } from '../context/SocketContext.jsx';

export function NotificationsScreen({ onNavigate }) {
  const { unreadCount, setUnreadCount } = useSocket();
  const [notifications, setNotifications] = useState([]);
  const [filter, setFilter] = useState('all'); // 'all' | 'unread'
  const [loading, setLoading] = useState(true);

  const fetchNotifications = useCallback(async () => {
    setLoading(true);
    try {
      const query = filter === 'unread' ? '?unreadOnly=true&limit=50' : '?limit=50';
      const res = await apiRequest(`/notifications${query}`);
      setNotifications(res.notifications || []);
      if (res.unreadCount !== undefined) {
        setUnreadCount(res.unreadCount);
      }
    } catch {
      // Ignore
    } finally {
      setLoading(false);
    }
  }, [filter, setUnreadCount]);

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  const handleMarkAllRead = async () => {
    try {
      await apiRequest('/notifications/read-all', { method: 'POST' });
      setUnreadCount(0);
      setNotifications((prev) => prev.map((n) => ({ ...n, readAt: new Date().toISOString() })));
    } catch {
      // Ignore
    }
  };

  const handleMarkOneRead = async (id, link) => {
    try {
      await apiRequest(`/notifications/${id}/read`, { method: 'POST' });
      setUnreadCount((c) => Math.max(0, c - 1));
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, readAt: new Date().toISOString() } : n)),
      );
      if (link && onNavigate) {
        onNavigate(link);
      }
    } catch {
      // Ignore
    }
  };

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <Bell className="w-6 h-6 text-brand-600" />
            Notifications
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Stay updated on booking requests, approvals, meeting places, and reminders.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {unreadCount > 0 && (
            <button
              type="button"
              onClick={handleMarkAllRead}
              className="px-3 py-1.5 text-xs font-semibold text-brand-700 bg-brand-50 hover:bg-brand-100 rounded-lg flex items-center gap-1.5 transition-colors"
            >
              <Check className="w-4 h-4" />
              Mark all as read
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 border-b border-slate-200 mb-4 pb-2 text-xs font-semibold">
        <button
          type="button"
          onClick={() => setFilter('all')}
          className={`px-3 py-1.5 rounded-lg transition-colors ${
            filter === 'all'
              ? 'bg-slate-900 text-white'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
          }`}
        >
          All
        </button>
        <button
          type="button"
          onClick={() => setFilter('unread')}
          className={`px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5 ${
            filter === 'unread'
              ? 'bg-slate-900 text-white'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
          }`}
        >
          Unread
          {unreadCount > 0 && (
            <span className="bg-red-500 text-white text-[10px] px-1.5 py-0.2 rounded-full">
              {unreadCount}
            </span>
          )}
        </button>
      </div>

      {/* List */}
      <div className="bg-white rounded-2xl border border-slate-200 divide-y divide-slate-100 overflow-hidden shadow-xs">
        {loading ? (
          <div className="py-12 text-center text-xs text-slate-400">Loading notifications...</div>
        ) : notifications.length === 0 ? (
          <div className="py-12 text-center text-xs text-slate-400">
            {filter === 'unread' ? 'No unread notifications' : 'No notifications yet'}
          </div>
        ) : (
          notifications.map((n) => (
            <div
              key={n.id}
              onClick={() => handleMarkOneRead(n.id, n.link)}
              className={`p-4 cursor-pointer hover:bg-slate-50 transition-colors flex items-start justify-between gap-4 ${
                !n.readAt ? 'bg-brand-50/30' : ''
              }`}
            >
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="text-xs font-bold text-slate-900">{n.title}</h3>
                  {!n.readAt && <span className="w-2 h-2 rounded-full bg-brand-600 inline-block" />}
                </div>
                <p className="text-xs text-slate-600 mt-1 leading-relaxed">{n.body}</p>
                <span className="text-[10px] text-slate-400 mt-2 block">
                  {new Date(n.createdAt).toLocaleDateString([], {
                    month: 'short',
                    day: 'numeric',
                  })}{' '}
                  at{' '}
                  {new Date(n.createdAt).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
              </div>

              {n.link && (
                <div className="text-slate-400 hover:text-slate-600 p-1 flex-shrink-0">
                  <ExternalLink className="w-4 h-4" />
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default NotificationsScreen;
