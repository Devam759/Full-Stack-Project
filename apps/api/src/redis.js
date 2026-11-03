import Redis from 'ioredis';
import config from './config/index.js';
import logger from './common/logger.js';

let redisClient = null;

export function getRedisClient() {
  if (!redisClient && config.REDIS_URL) {
    redisClient = new Redis(config.REDIS_URL, {
      maxRetriesPerRequest: 3,
      lazyConnect: true,
      enableOfflineQueue: false,
    });

    redisClient.on('error', (err) => {
      logger.warn({ err: err.message }, 'Redis client connection warning');
    });

    redisClient.on('connect', () => {
      logger.info('Connected to Redis');
    });
  }
  return redisClient;
}

export async function isRedisHealthy() {
  const client = getRedisClient();
  if (!client) return false;
  try {
    if (client.status !== 'ready' && client.status !== 'connecting') {
      await client.connect();
    }
    const pong = await client.ping();
    return pong === 'PONG';
  } catch {
    return false;
  }
}

export async function closeRedis() {
  if (redisClient) {
    try {
      await redisClient.quit();
    } catch {
      redisClient.disconnect();
    } finally {
      redisClient = null;
    }
  }
}

export default {
  getRedisClient,
  isRedisHealthy,
  closeRedis,
};
