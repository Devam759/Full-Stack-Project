import { Queue } from 'bullmq';
import { getRedisClient } from '../redis.js';
import logger from '../common/logger.js';

let emailQueue = null;

export function getEmailQueue() {
  if (!emailQueue && process.env.NODE_ENV !== 'test') {
    try {
      const redis = getRedisClient();
      if (redis) {
        emailQueue = new Queue('email_queue', {
          connection: redis,
          defaultJobOptions: {
            attempts: 3,
            backoff: {
              type: 'exponential',
              delay: 2000,
            },
            removeOnComplete: true,
          },
        });
      }
    } catch (err) {
      logger.warn({ err: err.message }, 'Failed to initialize BullMQ email queue');
    }
  }
  return emailQueue;
}

/**
 * Queues an email for background sending.
 * @param {object} emailData
 * @param {string} emailData.to
 * @param {string} emailData.subject
 * @param {string} emailData.text
 * @param {string} emailData.html
 */
export async function queueEmail(emailData) {
  const queue = getEmailQueue();
  if (queue) {
    await queue.add('send_email', emailData);
    logger.info(
      { to: emailData.to.replace(/(?<=.{2}).(?=.*@)/g, '*') },
      'Email queued for sending',
    );
  } else {
    // In test environment or fallback, log email event
    logger.info(
      { to: emailData.to.replace(/(?<=.{2}).(?=.*@)/g, '*'), subject: emailData.subject },
      'Email dispatch recorded (mock/queue disabled)',
    );
  }
}

export default {
  getEmailQueue,
  queueEmail,
};
