/**
 * @file apps/api/src/jobs/reconciliationQueue.js
 * Producer queue for on-demand ledger reconciliation BullMQ jobs.
 */

import { Queue } from 'bullmq';
import { getRedisClient } from '../redis.js';
import logger from '../common/logger.js';

let reconciliationQueue = null;

export const RECONCILIATION_QUEUE_NAME = 'ledger_reconciliation_queue';

export function setReconciliationQueue(queue) {
  reconciliationQueue = queue;
}

export function getReconciliationQueue() {
  if (
    !reconciliationQueue &&
    (process.env.NODE_ENV !== 'test' || process.env.ENABLE_TEST_RECONCILIATION_QUEUE === 'true')
  ) {
    try {
      const redis = getRedisClient();
      if (redis) {
        reconciliationQueue = new Queue(RECONCILIATION_QUEUE_NAME, {
          connection: redis,
          defaultJobOptions: {
            attempts: 1,
            removeOnComplete: true,
          },
        });
      }
    } catch (err) {
      logger.warn({ err: err.message }, 'Failed to initialize BullMQ reconciliation queue in API');
    }
  }
  return reconciliationQueue;
}

/**
 * Enqueues an on-demand reconciliation run to the BullMQ worker queue.
 */
export async function enqueueOnDemandReconciliation({
  runId,
  trigger = 'admin_on_demand',
  reason = '',
}) {
  const queue = getReconciliationQueue();
  if (queue) {
    await queue.add(
      'run_on_demand_reconciliation',
      { runId, trigger, reason },
      {
        jobId: `on_demand_reconciliation_${runId}`,
      },
    );
    logger.info({ runId, trigger }, 'Enqueued on-demand reconciliation job to BullMQ');
  } else {
    logger.info(
      { runId, trigger },
      'BullMQ queue not connected in this environment, job not enqueued',
    );
  }
}

export default {
  RECONCILIATION_QUEUE_NAME,
  setReconciliationQueue,
  getReconciliationQueue,
  enqueueOnDemandReconciliation,
};
