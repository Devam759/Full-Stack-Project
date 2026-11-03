import app from './app.js';
import config from './config/index.js';
import logger from './common/logger.js';
import { connectDB, disconnectDB } from './db.js';
import { closeRedis } from './redis.js';

let server = null;

async function startServer() {
  try {
    await connectDB();

    server = app.listen(config.PORT, () => {
      logger.info({ port: config.PORT, env: config.NODE_ENV }, 'BorrowLoop API server running');
    });
  } catch (error) {
    logger.error({ err: error }, 'Failed to start BorrowLoop API server');
    process.exit(1);
  }
}

async function shutdown(signal) {
  logger.info({ signal }, 'Graceful shutdown initiated');

  if (server) {
    server.close(async () => {
      logger.info('HTTP server closed');
      await disconnectDB();
      await closeRedis();
      logger.info('Graceful shutdown complete');
      process.exit(0);
    });

    // Force exit if not completed within 10s
    setTimeout(() => {
      logger.error('Forced shutdown after timeout');
      process.exit(1);
    }, 10_000).unref();
  } else {
    process.exit(0);
  }
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

if (process.env.NODE_ENV !== 'test') {
  startServer();
}

export { server, startServer, shutdown };
