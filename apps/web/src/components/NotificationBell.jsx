/**
 * @file apps/web/src/components/NotificationBell.jsx
 * Real-time notification bell with unread badge counter, dropdown popover,
 * and mark-as-read integration.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Bell, Check, ExternalLink } from 'lucide-react';
import { apiRequest } from '../api/client.js';
import { useSocket } from '../context/SocketContext.jsx';

export function NotificationBell({ onNavigate }) {
  const { unreadCount, setUnreadCount } = useSocket();
  const [isOpen, setIsOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(false);
  const dropdownRef = useRef(null);

  const fetchRecent = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiRequest('/notifications?limit=5');
      setNotifications(res.notifications || []);
      if (res.unreadCount !== undefined) {
        setUnreadCount(res.unreadCount);
      }
    } catch {
      // Ignore
    } finally {
      setLoading(false);
    }
  }, [setUnreadCount]);

  useEffect(() => {
    if (isOpen) {
      fetchRecent();
    }
  }, [isOpen, fetchRecent]);

  // Click outside to close
  useEffect(() => {
    function handleClickOutside(e) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleMarkAllRead = async () => {
    try {
      await apiRequest('/notifications/read-all', { method: 'POST' });
      setUnreadCount(0);
      setNotifications((prev) => prev.map((n) => ({ ...n, readAt: new Date().toISOString() })));
    } catch {
      // Ignore
    }
  };

  const handleClickItem = async (notif) => {
    if (!notif.readAt) {
      try {
        await apiRequest(`/notifications/${notif.id}/read`, { method: 'POST' });
        setUnreadCount((c) => Math.max(0, c - 1));
        setNotifications((prev) =>
          prev.map((n) => (n.id === notif.id ? { ...n, readAt: new Date().toISOString() } : n)),
        );
      } catch {
        // Ignore
      }
    }
    setIsOpen(false);
    if (notif.link && onNavigate) {
      onNavigate(notif.link);
    }
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        data-testid="notification-bell-btn"
        onClick={() => setIsOpen(!isOpen)}
        className="relative p-2 text-slate-600 hover:text-slate-900 rounded-full hover:bg-slate-100 transition-colors"
        aria-label="Notifications"
      >
        <Bell className="w-5 h-5" />
        {unreadCount > 0 && (
          <span
            data-testid="notification-unread-badge"
            className="absolute top-1 right-1 flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-bold text-white bg-red-500 rounded-full ring-2 ring-white"
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div
          data-testid="notification-dropdown"
          className="absolute right-0 mt-2 w-80 sm:w-96 bg-white rounded-xl shadow-lg border border-slate-200 py-2 z-50 text-sm"
        >
          <div className="flex items-center justify-between px-4 py-2 border-b border-slate-100">
            <span className="font-semibold text-slate-800">Notifications</span>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={handleMarkAllRead}
                className="text-xs text-brand-600 hover:text-brand-700 flex items-center gap-1 font-medium"
              >
                <Check className="w-3.5 h-3.5" />
                Mark all read
              </button>
            )}
          </div>

          <div className="max-h-80 overflow-y-auto divide-y divide-slate-100">
            {loading ? (
              <div className="py-6 text-center text-slate-400">Loading...</div>
            ) : notifications.length === 0 ? (
              <div className="py-6 text-center text-slate-400">No notifications yet</div>
            ) : (
              notifications.map((n) => (
                <div
                  key={n.id}
                  onClick={() => handleClickItem(n)}
                  className={`px-4 py-3 cursor-pointer hover:bg-slate-50 transition-colors ${
                    !n.readAt ? 'bg-brand-50/40 font-medium' : ''
                  }`}
                >
                  <div className="flex justify-between items-start gap-2">
                    <p className="text-slate-800 text-xs font-semibold">{n.title}</p>
                    {n.link && <ExternalLink className="w-3 h-3 text-slate-400 flex-shrink-0" />}
                  </div>
                  <p className="text-slate-600 text-xs mt-0.5 line-clamp-2">{n.body}</p>
                  <span className="text-[10px] text-slate-400 mt-1 block">
                    {new Date(n.createdAt).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </div>
              ))
            )}
          </div>

          <div className="border-t border-slate-100 pt-2 px-4 text-center">
            <button
              type="button"
              onClick={() => {
                setIsOpen(false);
                if (onNavigate) onNavigate('/notifications');
              }}
              className="text-xs text-brand-600 hover:text-brand-700 font-medium"
            >
              View all notifications
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default NotificationBell;
