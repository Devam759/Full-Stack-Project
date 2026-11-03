import config from './config/index.js';
import logger from './logger.js';
import { BUSINESS_CONFIG } from '@borrowloop/shared';

logger.info(
  {
    env: config.NODE_ENV,
    reconciliationCron: BUSINESS_CONFIG.BACKGROUND_JOBS.LEDGER_RECONCILIATION_CRON,
  },
  'BorrowLoop background worker initialized',
);

export function getWorkerStatus() {
  return {
    status: 'running',
    env: config.NODE_ENV,
    timestamp: new Date().toISOString(),
  };
}

async function shutdown(signal) {
  logger.info({ signal }, 'Worker received shutdown signal');
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
