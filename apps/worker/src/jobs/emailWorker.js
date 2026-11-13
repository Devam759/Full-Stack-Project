/**
 * @file apps/worker/src/jobs/emailWorker.js
 * BullMQ Worker consuming email jobs from 'email_queue' and delivering via nodemailer SMTP.
 * Strictly adheres to PII logging rules: never logs recipient email addresses, passwords, or tokens.
 */

import { Worker } from 'bullmq';
import nodemailer from 'nodemailer';
import config from '../config/index.js';
import logger from '../logger.js';

export const EMAIL_QUEUE_NAME = 'email_queue';

let emailWorker = null;
let activeTransporter = null;
let testTransporter = null;

/**
 * Allows injecting a test transporter for simulating SMTP failures.
 * Strictly active when process.env.NODE_ENV === 'test'.
 */
export function __setTestTransporter(transporter) {
  if (process.env.NODE_ENV === 'test') {
    testTransporter = transporter;
  }
}

/**
 * Gets or creates the nodemailer SMTP transport instance.
 *
 * @returns {import('nodemailer').Transporter}
 */
export function getTransporter() {
  if (process.env.NODE_ENV === 'test' && testTransporter) {
    return testTransporter;
  }
  if (!activeTransporter) {
    const transportOptions = {
      host: config.SMTP_HOST || '127.0.0.1',
      port: config.SMTP_PORT || 1025,
      secure: Boolean(config.SMTP_SECURE),
    };

    if (config.SMTP_USER && config.SMTP_PASS) {
      transportOptions.auth = {
        user: config.SMTP_USER,
        pass: config.SMTP_PASS,
      };
    }

    activeTransporter = nodemailer.createTransport(transportOptions);
  }
  return activeTransporter;
}

/**
 * Starts the BullMQ worker for the email queue.
 *
 * @param {import('ioredis').Redis} redisClient
 * @returns {Worker}
 */
export function startEmailWorker(redisClient) {
  if (emailWorker) {
    return emailWorker;
  }

  emailWorker = new Worker(
    EMAIL_QUEUE_NAME,
    async (job) => {
      const { to, subject, text, html } = job.data;
      const redactedTo = to ? to.replace(/(?<=.{2}).(?=.*@)/g, '*') : 'unknown';

      logger.info({ jobId: job.id, recipient: redactedTo, subject }, 'Processing email dispatch');

      const transporter = getTransporter();
      const sendResult = await transporter.sendMail({
        from: config.EMAIL_FROM || 'BorrowLoop <noreply@borrowloop.test>',
        to,
        subject,
        text,
        html,
      });

      logger.info(
        { jobId: job.id, recipient: redactedTo, messageId: sendResult?.messageId },
        'Email delivered successfully via SMTP',
      );

      return { success: true, messageId: sendResult?.messageId };
    },
    { connection: redisClient },
  );

  emailWorker.on('failed', (job, err) => {
    const redactedTo = job?.data?.to ? job.data.to.replace(/(?<=.{2}).(?=.*@)/g, '*') : 'unknown';
    logger.error(
      { jobId: job?.id, recipient: redactedTo, attemptsMade: job?.attemptsMade, err: err.message },
      'Email dispatch failed, awaiting retry/backoff',
    );
  });

  logger.info({ queue: EMAIL_QUEUE_NAME }, 'Email BullMQ worker initialized and listening');
  return emailWorker;
}

/**
 * Closes the email BullMQ worker.
 */
export async function closeEmailWorker() {
  if (emailWorker) {
    await emailWorker.close().catch(() => {});
    emailWorker = null;
  }
  activeTransporter = null;
  testTransporter = null;
}

export default {
  startEmailWorker,
  closeEmailWorker,
  getTransporter,
  __setTestTransporter,
  EMAIL_QUEUE_NAME,
};
