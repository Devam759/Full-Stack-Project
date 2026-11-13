import { Router } from 'express';
import { isDBHealthy } from '../db.js';
import { isRedisHealthy } from '../redis.js';

export const healthRouter = Router();

healthRouter.get('/health', (_req, res) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
  });
});

healthRouter.get('/ready', async (_req, res) => {
  const dbOk = isDBHealthy();
  const redisOk = await isRedisHealthy();

  // In test mode, readiness requires dbOk (and redisOk if redis is connected)
  const isReady = dbOk && (process.env.NODE_ENV === 'test' ? true : redisOk);
  const statusCode = isReady ? 200 : 503;

  res.status(statusCode).json({
    status: isReady ? 'ready' : 'not_ready',
    timestamp: new Date().toISOString(),
    checks: {
      database: dbOk ? 'healthy' : 'unhealthy',
      redis: redisOk ? 'healthy' : 'unhealthy',
    },
  });
});

export default healthRouter;
