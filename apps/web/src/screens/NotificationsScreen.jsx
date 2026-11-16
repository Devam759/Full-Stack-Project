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
    <div className="space-y-6 pb-20">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl sm:text-4xl font-heading font-black tracking-tight text-black flex items-center gap-3">
            <Bell className="w-8 h-8 text-black" />
            <span>Notifications</span>
          </h1>
          <p className="text-sm text-neutral-500 mt-1">
            Stay updated on booking requests, handover verifications, and community notices.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {unreadCount > 0 && (
            <button
              type="button"
              onClick={handleMarkAllRead}
              className="px-4 py-2 text-xs font-bold text-black bg-neutral-100 hover:bg-neutral-200 rounded-full flex items-center gap-2 transition"
            >
              <Check className="w-4 h-4" />
              <span>Mark all as read</span>
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 p-1.5 bg-neutral-100 rounded-2xl w-fit">
        <button
          type="button"
          onClick={() => setFilter('all')}
          className={`px-5 py-2 text-xs font-bold rounded-xl transition ${
            filter === 'all' ? 'bg-black text-white shadow-xs' : 'text-neutral-600 hover:text-black'
          }`}
        >
          All
        </button>
        <button
          type="button"
          onClick={() => setFilter('unread')}
          className={`px-5 py-2 text-xs font-bold rounded-xl transition flex items-center gap-2 ${
            filter === 'unread'
              ? 'bg-black text-white shadow-xs'
              : 'text-neutral-600 hover:text-black'
          }`}
        >
          <span>Unread</span>
          {unreadCount > 0 && (
            <span className="bg-white text-black text-[10px] px-1.5 py-0.2 rounded-full font-bold">
              {unreadCount}
            </span>
          )}
        </button>
      </div>

      {/* List */}
      <div className="bg-white rounded-3xl border border-neutral-200 divide-y divide-neutral-100 overflow-hidden shadow-xs">
        {loading ? (
          <div className="py-16 text-center text-xs text-neutral-400 font-semibold">
            Loading notifications...
          </div>
        ) : notifications.length === 0 ? (
          <div className="py-16 text-center text-xs text-neutral-400 font-medium">
            {filter === 'unread' ? 'No unread notifications' : 'No notifications yet'}
          </div>
        ) : (
          notifications.map((n) => (
            <div
              key={n.id}
              onClick={() => handleMarkOneRead(n.id, n.link)}
              className={`p-5 cursor-pointer hover:bg-neutral-50 transition-colors flex items-start justify-between gap-4 ${
                !n.readAt ? 'bg-neutral-50/60' : ''
              }`}
            >
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-bold text-black">{n.title}</h3>
                  {!n.readAt && <span className="w-2 h-2 rounded-full bg-black inline-block" />}
                </div>
                <p className="text-xs text-neutral-600 mt-1 leading-relaxed">{n.body}</p>
                <span className="text-[11px] text-neutral-400 mt-2 block font-medium">
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
                <div className="text-neutral-400 hover:text-black p-1 shrink-0 transition">
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
