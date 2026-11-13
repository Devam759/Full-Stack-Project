/**
 * @file apps/web/src/context/SocketContext.jsx
 * Socket.IO React context providing real-time connection and notification counts.
 */

import React, { createContext, useContext, useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import { getAccessToken, apiRequest } from '../api/client.js';
import { useAuth } from './AuthContext.jsx';

const SocketContext = createContext(null);

export function SocketProvider({ children }) {
  const { user } = useAuth();
  const [socket, setSocket] = useState(null);
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    if (!user) {
      setSocket(null);
      setUnreadCount(0);
      return;
    }

    const token = getAccessToken();
    const serverUrl =
      import.meta.env.VITE_WS_URL ||
      import.meta.env.VITE_API_URL?.replace('/v1', '') ||
      'http://localhost:4000';

    const s = io(serverUrl, {
      auth: { token },
      transports: ['websocket', 'polling'],
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
    });

    s.on('connect', () => {
      // Fetch initial unread notifications count
      apiRequest('/notifications?limit=1')
        .then((res) => {
          if (res?.unreadCount !== undefined) {
            setUnreadCount(res.unreadCount);
          }
        })
        .catch(() => {});
    });

    s.on('notification:new', () => {
      setUnreadCount((prev) => prev + 1);
    });

    setSocket(s);

    return () => {
      s.disconnect();
    };
  }, [user]);

  return (
    <SocketContext.Provider value={{ socket, unreadCount, setUnreadCount }}>
      {children}
    </SocketContext.Provider>
  );
}

export function useSocket() {
  const context = useContext(SocketContext);
  return context || { socket: null, unreadCount: 0, setUnreadCount: () => {} };
}
