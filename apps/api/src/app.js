import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { pinoHttp } from 'pino-http';
import { AppError, ERROR_CODES } from '@borrowloop/shared';

import config from './config/index.js';
import logger, { REDACTED_PATHS } from './common/logger.js';
import requestIdMiddleware from './common/requestId.js';
import errorHandler from './common/errorHandler.js';
import createRateLimiter from './common/rateLimiter.js';
import { getRedisClient } from './redis.js';
import healthRouter from './routes/health.js';

export function createApp() {
  const app = express();

  // Basic security headers
  app.use(helmet());

  // CORS configuration
  const allowedOrigins = [...config.CLIENT_ORIGINS, config.PORTAL_ORIGIN].filter(Boolean);
  app.use(
    cors({
      origin: (origin, callback) => {
        // Allow requests with no origin (e.g. mobile apps, curl, server-to-server) or allowed origins
        if (!origin || allowedOrigins.includes(origin)) {
          return callback(null, true);
        }
        return callback(new AppError(ERROR_CODES.FORBIDDEN, 'CORS origin not allowed', 403));
      },
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key', 'X-Request-Id'],
      exposedHeaders: ['X-Request-Id', 'RateLimit-Limit', 'RateLimit-Remaining', 'RateLimit-Reset'],
    }),
  );

  // Request ID
  app.use(requestIdMiddleware);

  // Body parser with 1MB limit (Requirement 11)
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));

  // HTTP access logger (Pino)
  if (process.env.NODE_ENV !== 'test') {
    app.use(
      pinoHttp({
        logger,
        genReqId: (req) => req.id,
        redact: REDACTED_PATHS,
      }),
    );
  }

  // Redis-backed rate limiting base (Requirement 11)
  const redis = getRedisClient();
  app.use(
    createRateLimiter({
      redis,
      windowSeconds: 60,
      maxRequests: 120, // default global baseline
      keyPrefix: 'rl:global',
    }),
  );

  // Health and readiness routes (both at root and /v1 for convenience)
  app.use('/v1', healthRouter);
  app.use('/', healthRouter);

  // 404 handler
  app.use((req, _res, next) => {
    next(
      new AppError(ERROR_CODES.NOT_FOUND, `Route not found: ${req.method} ${req.originalUrl}`, 404),
    );
  });

  // Global error handler
  app.use(errorHandler);

  return app;
}

export const app = createApp();
export default app;
