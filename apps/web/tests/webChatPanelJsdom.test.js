// @vitest-environment jsdom
/**
 * @file apps/web/tests/webChatPanelJsdom.test.js
 * Verification of Web UI ChatPanel with jsdom:
 * 1. Loads newest page on initial mount (direction=before)
 * 2. "Load older messages" fetches previous messages and prepends without gaps
 * 3. Reconnect event fetches after the last seen id, de-duplicates by id, no gaps
 */

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ChatPanel } from '../src/components/ChatPanel.jsx';
import * as apiClient from '../src/api/client.js';
import * as socketContext from '../src/context/SocketContext.jsx';

// Mock scrollIntoView
window.HTMLElement.prototype.scrollIntoView = vi.fn();
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('Web UI ChatPanel (jsdom environment)', () => {
  let container;
  let root;
  let mockSocket;
  let socketEventHandlers;
  let apiCalls;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    socketEventHandlers = {};
    mockSocket = {
      emit: vi.fn(),
      on: vi.fn((event, handler) => {
        socketEventHandlers[event] = handler;
      }),
      off: vi.fn((event) => {
        delete socketEventHandlers[event];
      }),
    };

    vi.spyOn(socketContext, 'useSocket').mockReturnValue({ socket: mockSocket });
    apiCalls = [];
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.restoreAllMocks();
  });

  it('loads newest page initially, loads older messages on click, and handles reconnect after last seen id without duplicate gaps', async () => {
    // 1. Setup mock API responses
    vi.spyOn(apiClient, 'apiRequest').mockImplementation(async (endpoint) => {
      apiCalls.push(endpoint);

      if (endpoint.includes('/messages/read')) {
        return { success: true };
      }

      // Initial load: returns newest page (messages 21 to 30)
      if (endpoint.includes('direction=before') && !endpoint.includes('cursor=')) {
        return {
          messages: Array.from({ length: 10 }, (_, i) => ({
            id: `msg-${i + 21}`,
            conversationId: 'conv-123',
            bookingId: 'book-123',
            senderId: 'user-other',
            clientMessageId: `cmsg-${i + 21}`,
            type: 'text',
            text: `Message ${i + 21}`,
            cursor: `cursor-${i + 21}`,
            createdAt: new Date(1700000000000 + (i + 21) * 1000).toISOString(),
            readBy: ['user-other'],
          })),
          nextCursor: 'cursor-21',
          conversation: { id: 'conv-123', confirmedPin: null },
        };
      }

      // Older page (messages 11 to 20)
      if (endpoint.includes('direction=before') && endpoint.includes('cursor=cursor-21')) {
        return {
          messages: Array.from({ length: 10 }, (_, i) => ({
            id: `msg-${i + 11}`,
            conversationId: 'conv-123',
            bookingId: 'book-123',
            senderId: 'user-other',
            clientMessageId: `cmsg-${i + 11}`,
            type: 'text',
            text: `Message ${i + 11}`,
            cursor: `cursor-${i + 11}`,
            createdAt: new Date(1700000000000 + (i + 11) * 1000).toISOString(),
            readBy: ['user-other'],
          })),
          nextCursor: null,
          conversation: { id: 'conv-123', confirmedPin: null },
        };
      }

      // Reconnect query (after last seen id cursor-30): returns message 30 (duplicate edge) + message 31 (new)
      if (endpoint.includes('direction=after') && endpoint.includes('cursor=cursor-30')) {
        return {
          messages: [
            {
              id: 'msg-30', // duplicate edge
              conversationId: 'conv-123',
              bookingId: 'book-123',
              senderId: 'user-other',
              clientMessageId: 'cmsg-30',
              type: 'text',
              text: 'Message 30',
              cursor: 'cursor-30',
              createdAt: new Date(1700000000000 + 30 * 1000).toISOString(),
              readBy: ['user-other'],
            },
            {
              id: 'msg-31', // new message while disconnected
              conversationId: 'conv-123',
              bookingId: 'book-123',
              senderId: 'user-other',
              clientMessageId: 'cmsg-31',
              type: 'text',
              text: 'Message 31',
              cursor: 'cursor-31',
              createdAt: new Date(1700000000000 + 31 * 1000).toISOString(),
              readBy: ['user-other'],
            },
          ],
          nextCursor: null,
          conversation: { id: 'conv-123', confirmedPin: null },
        };
      }

      return { messages: [] };
    });

    // 2. Mount ChatPanel component
    await act(async () => {
      root.render(
        React.createElement(ChatPanel, {
          bookingId: 'book-123',
          currentUserId: 'user-me',
          bookingStatus: 'accepted',
        }),
      );
    });

    // Verify initial load called direction=before for newest page
    expect(apiCalls.some((c) => c.includes('direction=before') && !c.includes('cursor='))).toBe(
      true,
    );

    // Verify rendered messages: contains Message 21 to Message 30
    expect(container.textContent).toContain('Message 21');
    expect(container.textContent).toContain('Message 30');

    // Verify "Load older messages" button is present
    const loadOlderBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent.includes('Load older messages'),
    );
    expect(loadOlderBtn).toBeDefined();

    // 3. Click "Load older messages"
    await act(async () => {
      loadOlderBtn.click();
    });

    // Verify load older called with cursor-21
    expect(
      apiCalls.some((c) => c.includes('direction=before') && c.includes('cursor=cursor-21')),
    ).toBe(true);

    // Verify older messages are prepended: Message 11 is now present along with Message 30
    expect(container.textContent).toContain('Message 11');
    expect(container.textContent).toContain('Message 21');
    expect(container.textContent).toContain('Message 30');

    // 4. Trigger Socket Reconnect
    expect(socketEventHandlers['connect']).toBeDefined();
    await act(async () => {
      socketEventHandlers['connect']();
    });

    // Verify reconnect queried after cursor-30
    expect(
      apiCalls.some((c) => c.includes('direction=after') && c.includes('cursor=cursor-30')),
    ).toBe(true);

    // Verify Message 31 is now present, and Message 30 was de-duplicated (appears exactly once in message list)
    expect(container.textContent).toContain('Message 31');
    const msg30Elements = Array.from(container.querySelectorAll('*')).filter(
      (el) => el.textContent === 'Message 30',
    );
    expect(msg30Elements.length).toBe(1);
  });
});
