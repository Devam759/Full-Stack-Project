/**
 * @file apps/api/src/sockets/socketServer.js
 * Socket.IO server with Redis adapter for distributed real-time messaging,
 * JWT authentication, and room-based routing.
 */

import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import jwt from 'jsonwebtoken';
import config from '../config/index.js';
import logger from '../common/logger.js';
import { getRedisClient } from '../redis.js';
import { User, Conversation, Block } from '@borrowloop/server-core';
import { BUSINESS_CONFIG, createMessageSchema } from '@borrowloop/shared';
import * as chatService from '../modules/chat/chatService.js';

let io = null;
let pubClient = null;
let subClient = null;

// Fallback in-memory tracking for socket count per user
const userSocketCounts = new Map();

async function checkRateLimit(redis, key, windowSeconds, maxRequests) {
  if (!redis || redis.status !== 'ready') return true;
  try {
    const pipeline = redis.pipeline();
    pipeline.incr(key);
    pipeline.ttl(key);
    const results = await pipeline.exec();
    const count = results[0][1];
    let ttl = results[1][1];
    if (ttl === -1) {
      await redis.expire(key, windowSeconds);
    }
    return count <= maxRequests;
  } catch {
    return true;
  }
}

/**
 * Initializes Socket.IO with HTTP server and Redis adapter.
 *
 * @param {import('http').Server} httpServer
 * @returns {Server}
 */
export function initSocketServer(httpServer) {
  if (io) return io;

  const allowedOrigins = [...config.CLIENT_ORIGINS, config.PORTAL_ORIGIN].filter(Boolean);

  io = new Server(httpServer, {
    cors: {
      origin: allowedOrigins.length > 0 ? allowedOrigins : '*',
      credentials: true,
    },
    transports: ['websocket', 'polling'],
  });

  // Attach Redis adapter if Redis is available
  try {
    const redis = getRedisClient();
    if (redis && redis.status === 'ready') {
      pubClient = redis.duplicate({
        lazyConnect: true,
        enableOfflineQueue: false,
        maxRetriesPerRequest: null,
      });
      subClient = redis.duplicate({
        lazyConnect: true,
        enableOfflineQueue: false,
        maxRetriesPerRequest: null,
      });
      pubClient.on('error', () => {});
      subClient.on('error', () => {});
      pubClient
        .connect()
        .catch((err) => logger.warn({ err: err.message }, 'pubClient connect error'));
      subClient
        .connect()
        .catch((err) => logger.warn({ err: err.message }, 'subClient connect error'));
      io.adapter(createAdapter(pubClient, subClient));
      logger.info('Socket.IO Redis adapter initialized successfully');
    }
  } catch (err) {
    logger.warn({ err: err.message }, 'Socket.IO running without Redis adapter');
  }

  // Authentication & Connection Middleware
  io.use(async (socket, next) => {
    try {
      const token =
        socket.handshake.auth?.token ||
        socket.handshake.headers?.authorization?.replace(/^Bearer\s+/i, '');

      if (!token) {
        return next(new Error('Authentication token required'));
      }

      let decoded;
      try {
        decoded = jwt.verify(token, config.JWT_ACCESS_SECRET);
      } catch (jwtErr) {
        if (jwtErr.name === 'TokenExpiredError') {
          return next(new Error('Authentication token expired'));
        }
        return next(new Error('Authentication failed'));
      }

      if (decoded.aud && config.JWT_AUDIENCE && decoded.aud !== config.JWT_AUDIENCE) {
        return next(new Error('Invalid token audience'));
      }

      const user = await User.findById(decoded.sub).lean();

      if (!user) {
        return next(new Error('User not found'));
      }

      if (['banned', 'frozen', 'deleted'].includes(user.status)) {
        return next(new Error(`Account is ${user.status}`));
      }

      // Per-user connection limit check (max 5 sockets) with crash-safe TTL
      const userIdStr = user._id.toString();
      const redis = getRedisClient();
      const maxSockets = BUSINESS_CONFIG.CHAT.SOCKET_MAX_CONNECTIONS_PER_USER;
      const HEARTBEAT_TTL_MS = 5000;

      if (redis && redis.status === 'ready') {
        const cutoff = Date.now() - HEARTBEAT_TTL_MS;
        await redis.zremrangebyscore(`user_sockets:${userIdStr}`, 0, cutoff).catch(() => {});
        const socketCount = await redis.zcard(`user_sockets:${userIdStr}`);
        if (socketCount >= maxSockets) {
          return next(new Error('TOO_MANY_CONNECTIONS'));
        }
      } else {
        const memCount = userSocketCounts.get(userIdStr) || 0;
        if (memCount >= maxSockets) {
          return next(new Error('TOO_MANY_CONNECTIONS'));
        }
      }

      socket.user = {
        id: userIdStr,
        email: user.email,
        role: user.role,
        status: user.status,
        exp: decoded.exp,
      };

      next();
    } catch (err) {
      logger.warn({ err: err.message }, 'Socket connection authentication failed');
      next(new Error(err.message || 'Authentication failed'));
    }
  });

  // Connection Lifecycle
  io.on('connection', async (socket) => {
    const userId = socket.user.id;
    const redis = getRedisClient();

    // Item 11: Disconnect socket when access token expires
    if (socket.user.exp) {
      const expiresInMs = socket.user.exp * 1000 - Date.now();
      if (expiresInMs > 0) {
        const tokenExpiryTimer = setTimeout(() => {
          logger.info({ userId }, 'Access token expired; forcefully disconnecting socket');
          socket.disconnect(true);
        }, expiresInMs);
        socket.on('disconnect', () => clearTimeout(tokenExpiryTimer));
      }
    }

    // Register socket connection with crash-safe heartbeat
    let heartbeatTimer = null;
    if (redis && redis.status === 'ready') {
      await redis.zadd(`user_sockets:${userId}`, Date.now(), socket.id);
      await redis.expire(`user_sockets:${userId}`, 60);

      heartbeatTimer = setInterval(async () => {
        try {
          await redis.zadd(`user_sockets:${userId}`, Date.now(), socket.id);
        } catch {
          // Ignore transient Redis errors during periodic heartbeat
        }
      }, 2000);
    } else {
      userSocketCounts.set(userId, (userSocketCounts.get(userId) || 0) + 1);
    }

    socket.join(`user:${userId}`);
    logger.info({ userId, socketId: socket.id }, 'User connected to real-time socket');

    socket.on('conversation:join', async ({ conversationId }, callback) => {
      try {
        if (!conversationId) {
          if (typeof callback === 'function')
            callback({ status: 'error', error: 'conversationId required' });
          return;
        }
        const conv = await Conversation.findById(conversationId).lean();
        if (!conv) {
          if (typeof callback === 'function')
            callback({ status: 'error', error: 'CONVERSATION_NOT_FOUND' });
          return;
        }

        const isParticipant = conv.participantIds.some((p) => p.toString() === userId);
        const isStaff = socket.user.role === 'care_agent' || socket.user.role === 'admin';
        if (!isParticipant && !isStaff) {
          if (typeof callback === 'function')
            callback({ status: 'error', error: 'FORBIDDEN_NOT_PARTICIPANT' });
          return;
        }

        // Block check: Verify neither user has blocked the other
        const otherParticipantIds = conv.participantIds.filter((p) => p.toString() !== userId);
        const isBlocked = await Block.exists({
          $or: [
            { blockerId: userId, blockedId: { $in: otherParticipantIds } },
            { blockerId: { $in: otherParticipantIds }, blockedId: userId },
          ],
        });

        if (isBlocked) {
          if (typeof callback === 'function') callback({ status: 'error', error: 'BLOCKED' });
          return;
        }

        socket.join(`conversation:${conversationId}`);
        logger.debug({ userId, conversationId }, 'User joined conversation room');
        if (typeof callback === 'function') callback({ status: 'ok' });
      } catch (err) {
        logger.error({ err: err.message }, 'Error joining conversation room');
        if (typeof callback === 'function') callback({ status: 'error', error: err.message });
      }
    });

    socket.on('conversation:leave', ({ conversationId }) => {
      if (conversationId) {
        socket.leave(`conversation:${conversationId}`);
        logger.debug({ userId, conversationId }, 'User left conversation room');
      }
    });

    // Per-event validated message sending via WebSocket
    socket.on('message:send', async ({ bookingId, data }, callback) => {
      try {
        // Payload size guard (10KB limit)
        const payloadSize = JSON.stringify(data || {}).length;
        if (payloadSize > BUSINESS_CONFIG.CHAT.SOCKET_MAX_PAYLOAD_BYTES) {
          if (typeof callback === 'function')
            callback({ status: 'error', error: 'PAYLOAD_TOO_LARGE' });
          return;
        }

        // Rate limit guard
        const allowed = await checkRateLimit(
          redis,
          `rl:socket:msg:${userId}`,
          BUSINESS_CONFIG.CHAT.RATE_LIMITS.SEND_MESSAGE_USER.windowSeconds,
          BUSINESS_CONFIG.CHAT.RATE_LIMITS.SEND_MESSAGE_USER.maxRequests,
        );
        if (!allowed) {
          if (typeof callback === 'function')
            callback({ status: 'error', error: 'RATE_LIMITED', retryAfterSeconds: 60 });
          return;
        }

        // Zod validation
        const parsed = createMessageSchema.parse(data);
        const message = await chatService.sendMessage(bookingId, userId, parsed, socket.user.role);
        if (typeof callback === 'function') callback({ status: 'ok', data: message });
      } catch (err) {
        if (typeof callback === 'function') {
          callback({
            status: 'error',
            error: err.code || err.name || 'INVALID_MESSAGE',
            message: err.message,
          });
        }
      }
    });

    // Per-event validated message read receipt via WebSocket
    socket.on('message:read', async ({ bookingId, messageIds }, callback) => {
      try {
        const result = await chatService.markMessagesAsRead(
          bookingId,
          userId,
          messageIds,
          socket.user.role,
        );
        if (typeof callback === 'function') callback({ status: 'ok', data: result });
      } catch (err) {
        if (typeof callback === 'function') {
          callback({ status: 'error', error: err.code || 'READ_FAILED', message: err.message });
        }
      }
    });

    socket.on('disconnect', async () => {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      if (redis && redis.status === 'ready') {
        await redis.zrem(`user_sockets:${userId}`, socket.id).catch(() => {});
      } else {
        const current = userSocketCounts.get(userId) || 1;
        if (current <= 1) userSocketCounts.delete(userId);
        else userSocketCounts.set(userId, current - 1);
      }
      logger.debug({ userId, socketId: socket.id }, 'Socket disconnected');
    });
  });

  return io;
}

/**
 * Returns active Socket.IO server instance.
 */
export function getIO() {
  return io;
}

/**
 * Emits an event to a user's private room.
 */
export function emitToUser(userId, event, data) {
  if (!io) return;
  io.to(`user:${userId}`).emit(event, data);
}

/**
 * Emits an event to a conversation room.
 */
export function emitToConversation(conversationId, event, data) {
  if (!io) return;
  io.to(`conversation:${conversationId}`).emit(event, data);
}

/**
 * Forcefully disconnects all active sockets for a specific user.
 * Used for immediate mid-session cutoff when a user is banned, frozen, or blocked.
 *
 * @param {string} userId
 * @param {string} [reason='Account status changed']
 */
export function disconnectUser(userId, reason = 'Account status changed') {
  if (!io) return;
  io.in(`user:${userId}`).disconnectSockets(true);
  logger.info({ userId, reason }, 'Forcefully disconnected user sockets mid-session');
}

/**
 * Gracefully closes Socket.IO and adapter clients.
 */
export async function closeSocketServer() {
  if (io) {
    io.close();
    io = null;
  }
  if (pubClient) {
    pubClient.disconnect();
    pubClient = null;
  }
  if (subClient) {
    subClient.disconnect();
    subClient = null;
  }
}
