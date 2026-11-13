/**
 * @file apps/web/src/components/ChatPanel.jsx
 * Real-time per-booking chat component with Socket.IO, map pin proposals,
 * confirmation, read state receipts, and auto-scroll.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Send, MapPin, Check, CheckCheck, MapPinned } from 'lucide-react';
import { apiRequest } from '../api/client.js';
import { useSocket } from '../context/SocketContext.jsx';
import { MapPinPicker } from './MapPinPicker.jsx';

const TERMINAL_STATUSES = ['completed', 'cancelled', 'expired'];

export function ChatPanel({ bookingId, currentUserId, bookingStatus }) {
  const { socket } = useSocket();
  const [messages, setMessages] = useState([]);
  const [conversation, setConversation] = useState(null);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [showPinPicker, setShowPinPicker] = useState(false);
  const [error, setError] = useState('');
  const [hasOlder, setHasOlder] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const oldestCursorRef = useRef(null);
  const lastSeenCursorRef = useRef(null);
  const messagesEndRef = useRef(null);
  const isTerminal = TERMINAL_STATUSES.includes(bookingStatus);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  const fetchMessages = useCallback(async () => {
    try {
      const res = await apiRequest(`/bookings/${bookingId}/messages?limit=30&direction=before`);
      const msgs = res.messages || [];
      setMessages(msgs);
      setConversation(res.conversation || null);
      if (msgs.length > 0) {
        oldestCursorRef.current = msgs[0].cursor;
        lastSeenCursorRef.current = msgs[msgs.length - 1].cursor;
      }
      setHasOlder(Boolean(res.nextCursor));
      // Mark unread as read
      await apiRequest(`/bookings/${bookingId}/messages/read`, { method: 'POST' });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
      setTimeout(scrollToBottom, 100);
    }
  }, [bookingId, scrollToBottom]);

  const handleLoadOlder = async () => {
    if (!oldestCursorRef.current || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const res = await apiRequest(
        `/bookings/${bookingId}/messages?limit=30&direction=before&cursor=${oldestCursorRef.current}`,
      );
      const older = res.messages || [];
      if (older.length > 0) {
        oldestCursorRef.current = older[0].cursor;
        setMessages((prev) => {
          const existingIds = new Set(prev.map((m) => m.id));
          const dedupedOlder = older.filter((m) => !existingIds.has(m.id));
          return [...dedupedOlder, ...prev];
        });
      }
      setHasOlder(Boolean(res.nextCursor && older.length === 30));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingOlder(false);
    }
  };

  useEffect(() => {
    fetchMessages();
  }, [fetchMessages]);

  // Socket.IO Room & Event Subscription
  useEffect(() => {
    if (!socket || !conversation?.id) return;

    socket.emit('conversation:join', { conversationId: conversation.id });

    const handleNewMessage = ({ message }) => {
      setMessages((prev) => {
        if (prev.some((m) => m.id === message.id)) return prev;
        return [...prev, message];
      });
      setTimeout(scrollToBottom, 50);
      // Mark read if from other party
      if (message.senderId !== currentUserId) {
        apiRequest(`/bookings/${bookingId}/messages/read`, { method: 'POST' }).catch(() => {});
      }
    };

    const handlePinProposed = ({ message }) => {
      handleNewMessage({ message });
    };

    const handlePinConfirmed = ({ confirmedPin }) => {
      setConversation((prev) => (prev ? { ...prev, confirmedPin } : prev));
      setMessages((prev) =>
        prev.map((m) => {
          if (m.type === 'pin' && m.pin) {
            return { ...m, pin: { ...m.pin, status: 'confirmed' } };
          }
          return m;
        }),
      );
    };

    const handleMessageRead = ({ userId }) => {
      setMessages((prev) =>
        prev.map((m) => {
          if (!m.readBy.includes(userId)) {
            return { ...m, readBy: [...m.readBy, userId] };
          }
          return m;
        }),
      );
    };

    // Item 8: Fetch after last seen id on reconnect with deduplication
    const handleReconnect = () => {
      if (!lastSeenCursorRef.current) return;
      apiRequest(
        `/bookings/${bookingId}/messages?limit=50&direction=after&cursor=${lastSeenCursorRef.current}`,
      )
        .then((res) => {
          const newer = res.messages || [];
          if (newer.length > 0) {
            setMessages((prev) => {
              const existingIds = new Set(prev.map((m) => m.id));
              const dedupedNewer = newer.filter((m) => !existingIds.has(m.id));
              if (dedupedNewer.length > 0) {
                lastSeenCursorRef.current = dedupedNewer[dedupedNewer.length - 1].cursor;
              }
              return [...prev, ...dedupedNewer];
            });
            setTimeout(scrollToBottom, 50);
          }
        })
        .catch(() => {});
    };

    socket.on('connect', handleReconnect);
    socket.on('message:new', handleNewMessage);
    socket.on('pin:proposed', handlePinProposed);
    socket.on('pin:confirmed', handlePinConfirmed);
    socket.on('message:read', handleMessageRead);

    return () => {
      socket.emit('conversation:leave', { conversationId: conversation.id });
      socket.off('connect', handleReconnect);
      socket.off('message:new', handleNewMessage);
      socket.off('pin:proposed', handlePinProposed);
      socket.off('pin:confirmed', handlePinConfirmed);
      socket.off('message:read', handleMessageRead);
    };
  }, [socket, conversation?.id, currentUserId, bookingId, scrollToBottom]);

  const handleSendText = async (e, retryClientMessageId = null) => {
    if (e && e.preventDefault) e.preventDefault();
    if (!text.trim() || sending || isTerminal) return;

    const clientMessageId =
      retryClientMessageId ||
      (typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `cmsg-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`);

    setSending(true);
    setError('');
    try {
      const res = await apiRequest(`/bookings/${bookingId}/messages`, {
        method: 'POST',
        body: JSON.stringify({
          clientMessageId,
          type: 'text',
          text: text.trim(),
        }),
      });
      setText('');
      setMessages((prev) => {
        if (prev.some((m) => m.id === res.message.id)) return prev;
        return [...prev, res.message];
      });
      setTimeout(scrollToBottom, 50);
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  };

  const handleSendPin = async (pin, retryClientMessageId = null) => {
    setShowPinPicker(false);
    setError('');

    const clientMessageId =
      retryClientMessageId ||
      (typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `cmsg-pin-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`);

    try {
      const res = await apiRequest(`/bookings/${bookingId}/messages`, {
        method: 'POST',
        body: JSON.stringify({
          clientMessageId,
          type: 'pin',
          pin,
        }),
      });
      setMessages((prev) => {
        if (prev.some((m) => m.id === res.message.id)) return prev;
        return [...prev, res.message];
      });
      setTimeout(scrollToBottom, 50);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleConfirmPin = async () => {
    setError('');
    try {
      const res = await apiRequest(`/bookings/${bookingId}/pin/confirm`, { method: 'POST' });
      setConversation((prev) => (prev ? { ...prev, confirmedPin: res.confirmedPin } : prev));
      setMessages((prev) =>
        prev.map((m) => {
          if (m.type === 'pin' && m.pin) {
            return { ...m, pin: { ...m.pin, status: 'confirmed' } };
          }
          return m;
        }),
      );
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div
      data-testid="chat-panel"
      className="flex flex-col h-[520px] bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-xs"
    >
      {/* Top Banner: Confirmed Meeting Pin */}
      {conversation?.confirmedPin ? (
        <div
          data-testid="confirmed-pin-banner"
          className="bg-emerald-50 border-b border-emerald-200 px-4 py-2.5 flex items-center justify-between text-xs text-emerald-900"
        >
          <div className="flex items-center gap-2">
            <MapPinned className="w-4 h-4 text-emerald-600 flex-shrink-0" />
            <div>
              <span className="font-semibold">Confirmed Meeting Place: </span>
              <span>{conversation.confirmedPin.label}</span>
              <span className="text-[10px] text-emerald-700 ml-1 font-mono">
                ({conversation.confirmedPin.lat.toFixed(4)},{' '}
                {conversation.confirmedPin.lng.toFixed(4)})
              </span>
            </div>
          </div>
          <span className="bg-emerald-200 text-emerald-800 text-[10px] font-bold px-2 py-0.5 rounded-full">
            Agreed
          </span>
        </div>
      ) : null}

      {/* Messages Stream */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-50/50">
        {hasOlder && (
          <div className="flex justify-center mb-2">
            <button
              type="button"
              onClick={handleLoadOlder}
              disabled={loadingOlder}
              className="text-xs text-brand-600 hover:text-brand-700 bg-white border border-slate-200 px-3 py-1 rounded-full shadow-xs disabled:opacity-50"
            >
              {loadingOlder ? 'Loading older...' : 'Load older messages'}
            </button>
          </div>
        )}
        {loading ? (
          <div className="flex items-center justify-center h-full text-xs text-slate-400">
            Loading chat history...
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-slate-400 text-xs gap-1">
            <p>No messages yet.</p>
            <p className="text-[11px]">Coordinate pickup location and details here.</p>
          </div>
        ) : (
          messages.map((m) => {
            const isMe = m.senderId === currentUserId;
            const isRead = m.readBy && m.readBy.length > 1;

            if (m.type === 'system') {
              return (
                <div key={m.id} className="text-center my-2">
                  <span className="text-[11px] text-slate-500 bg-slate-200/60 px-3 py-1 rounded-full font-medium">
                    {m.text}
                  </span>
                </div>
              );
            }

            if (m.type === 'pin') {
              const isConfirmed =
                m.pin?.status === 'confirmed' || conversation?.confirmedPin?.label === m.pin?.label;
              return (
                <div key={m.id} className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
                  <div
                    data-testid="pin-message-card"
                    className={`max-w-xs sm:max-w-sm rounded-2xl p-3 shadow-xs border ${
                      isMe
                        ? 'bg-brand-50 border-brand-200 text-slate-800'
                        : 'bg-white border-slate-200 text-slate-800'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1.5">
                      <MapPin className="w-4 h-4 text-brand-600" />
                      <span className="text-xs font-bold text-slate-900">
                        {isConfirmed ? 'Agreed Handover Pin' : 'Proposed Handover Pin'}
                      </span>
                    </div>
                    <p className="text-xs font-medium text-slate-800 mb-1">{m.pin?.label}</p>
                    <div className="text-[10px] text-slate-500 font-mono bg-slate-100/80 px-2 py-0.5 rounded">
                      {m.pin?.lat?.toFixed(5)}, {m.pin?.lng?.toFixed(5)}
                    </div>

                    {!isConfirmed && !isMe && !isTerminal && (
                      <button
                        type="button"
                        data-testid="confirm-pin-btn"
                        onClick={handleConfirmPin}
                        className="mt-2.5 w-full text-xs font-semibold py-1.5 px-3 bg-brand-600 hover:bg-brand-700 text-white rounded-lg transition-colors flex items-center justify-center gap-1.5 shadow-xs"
                      >
                        <Check className="w-3.5 h-3.5" />
                        Confirm Meeting Place
                      </button>
                    )}

                    {isConfirmed && (
                      <div className="mt-2 text-[10px] font-bold text-emerald-700 flex items-center gap-1">
                        <Check className="w-3 h-3 text-emerald-600" />
                        Confirmed by both parties
                      </div>
                    )}

                    <div className="flex items-center justify-end gap-1 mt-1.5 text-[10px] text-slate-400">
                      <span>
                        {new Date(m.createdAt).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                      {isMe &&
                        (isRead ? (
                          <CheckCheck className="w-3 h-3 text-brand-600" />
                        ) : (
                          <Check className="w-3 h-3 text-slate-400" />
                        ))}
                    </div>
                  </div>
                </div>
              );
            }

            // Normal text message
            return (
              <div key={m.id} className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
                <div
                  className={`max-w-xs sm:max-w-md rounded-2xl px-4 py-2 text-xs leading-relaxed shadow-xs ${
                    isMe
                      ? 'bg-brand-600 text-white rounded-br-xs'
                      : 'bg-white border border-slate-200 text-slate-800 rounded-bl-xs'
                  }`}
                >
                  <p className="whitespace-pre-wrap break-words">{m.text}</p>
                  <div
                    className={`flex items-center justify-end gap-1 mt-1 text-[9px] ${
                      isMe ? 'text-brand-100' : 'text-slate-400'
                    }`}
                  >
                    <span>
                      {new Date(m.createdAt).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                    {isMe &&
                      (isRead ? (
                        <CheckCheck className="w-3 h-3 text-white" />
                      ) : (
                        <Check className="w-3 h-3 text-brand-200" />
                      ))}
                  </div>
                </div>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {error && (
        <div className="px-4 py-1.5 bg-red-50 text-red-600 text-xs border-t border-red-100">
          {error}
        </div>
      )}

      {/* Terminal Closed Banner */}
      {isTerminal ? (
        <div
          data-testid="terminal-chat-banner"
          className="p-3 bg-slate-100 border-t border-slate-200 text-center text-xs text-slate-600 font-medium"
        >
          This booking is {bookingStatus}. Chat history is read-only.
        </div>
      ) : (
        /* Message Input & Action Bar */
        <form
          onSubmit={handleSendText}
          className="p-3 bg-white border-t border-slate-200 flex items-center gap-2"
        >
          <button
            type="button"
            data-testid="propose-pin-btn"
            onClick={() => setShowPinPicker(true)}
            className="p-2 text-slate-500 hover:text-brand-600 hover:bg-brand-50 rounded-lg transition-colors flex-shrink-0"
            title="Propose Handover Meeting Pin"
          >
            <MapPin className="w-5 h-5" />
          </button>

          <div className="relative flex-1">
            <input
              type="text"
              data-testid="chat-text-input"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Type a message (max 1,000 chars)..."
              maxLength={1000}
              className="w-full text-xs px-3 py-2 border border-slate-200 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-brand-500 pr-12"
            />
            {text.length > 800 && (
              <span className="absolute right-2 top-2 text-[10px] text-slate-400 font-mono">
                {1000 - text.length}
              </span>
            )}
          </div>

          <button
            type="submit"
            data-testid="chat-send-btn"
            disabled={!text.trim() || sending}
            className="p-2 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white rounded-lg transition-colors flex-shrink-0"
          >
            <Send className="w-4 h-4" />
          </button>
        </form>
      )}

      {/* Map Pin Picker Modal */}
      {showPinPicker && (
        <MapPinPicker onSelectPin={handleSendPin} onCancel={() => setShowPinPicker(false)} />
      )}
    </div>
  );
}

export default ChatPanel;
