import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { pinoHttp } from 'pino-http';
import { AppError, ERROR_CODES } from '@borrowloop/shared';

import config from './config/index.js';
import logger, { REDACTED_PATHS } from './common/logger.js';
import requestIdMiddleware from './common/requestId.js';
import errorHandler from './common/errorHandler.js';
import createRateLimiter from './common/rateLimiter.js';
import { getRedisClient } from './redis.js';

import healthRouter from './routes/health.js';
import authRouter from './modules/auth/authRoutes.js';
import portalAuthRouter from './modules/portal/portalAuthRoutes.js';
import userRouter from './modules/users/userRoutes.js';
import uploadRouter from './modules/uploads/uploadRoutes.js';
import communityRouter from './modules/communities/communityRoutes.js';
import adminCommunityRouter from './modules/admin/adminCommunityRoutes.js';
import adminUserRouter from './modules/admin/adminUserRoutes.js';
import adminAgentRouter from './modules/admin/adminAgentRoutes.js';
import adminAppealRouter from './modules/admin/adminAppealRoutes.js';
import adminAnalyticsRouter from './modules/admin/adminAnalyticsRoutes.js';
import adminAuditRouter from './modules/admin/adminAuditRoutes.js';
import adminReconciliationRouter from './modules/admin/adminReconciliationRoutes.js';
import adminAdRouter from './modules/admin/adminAdRoutes.js';
import adRouter from './modules/ads/adRoutes.js';
import locationRouter from './modules/locations/locationRoutes.js';
import itemRouter from './modules/items/itemRoutes.js';
import walletRouter from './modules/wallet/walletRoutes.js';
import bookingRouter from './modules/bookings/bookingRoutes.js';
import notificationRouter from './modules/notifications/notificationRoutes.js';
import disputeRouter from './modules/disputes/disputeRoutes.js';
import careDisputeRouter from './modules/disputes/careDisputeRoutes.js';
import reportRouter from './modules/reports/reportRoutes.js';
import careReportRouter from './modules/reports/careReportRoutes.js';
import careUserRouter from './modules/care/careUserRoutes.js';

export function createApp() {
  const app = express();

  // Basic security headers
  app.use(helmet());

  // CORS configuration
  const allowedOrigins = [...config.CLIENT_ORIGINS, config.PORTAL_ORIGIN].filter(Boolean);
  app.use(
    cors({
      origin: (origin, callback) => {
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

  // Cookie parser
  app.use(cookieParser());

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
      maxRequests: () => (process.env.NODE_ENV === 'test' ? 10_000 : 120), // High ceiling in test environment for concurrency stress testing
      keyPrefix: 'rl:global',
    }),
  );

  // Health and readiness routes
  app.use('/v1', healthRouter);
  app.use('/', healthRouter);

  // Module routes
  app.use('/v1/auth', authRouter);
  app.use('/v1/portal/auth', portalAuthRouter);
  app.use('/v1/users', userRouter);
  app.use('/v1/uploads', uploadRouter);
  app.use('/v1/communities', communityRouter);
  app.use('/v1/admin/communities', adminCommunityRouter);
  app.use('/v1/admin/users', adminUserRouter);
  app.use('/v1/admin/agents', adminAgentRouter);
  app.use('/v1/admin/appeals', adminAppealRouter);
  app.use('/v1/admin/analytics', adminAnalyticsRouter);
  app.use('/v1/admin/audit-log', adminAuditRouter);
  app.use('/v1/admin/ledger/reconciliation', adminReconciliationRouter);
  app.use('/v1/admin/ads', adminAdRouter);
  app.use('/v1/ads', adRouter);
  app.use('/v1/locations', locationRouter);
  app.use('/v1/items', itemRouter);
  app.use('/v1/wallet', walletRouter);
  app.use('/v1/bookings', bookingRouter);
  app.use('/v1/notifications', notificationRouter);
  app.use('/v1/disputes', disputeRouter);
  app.use('/v1/care/disputes', careDisputeRouter);
  app.use('/v1/reports', reportRouter);
  app.use('/v1/care/reports', careReportRouter);
  app.use('/v1/care/users', careUserRouter);

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
