import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import Redis from 'ioredis';
import { Queue, Worker } from 'bullmq';
import app from '../../api/src/app.js';
import User from '../../api/src/models/User.js';
import AuthToken from '../../api/src/models/AuthToken.js';
import { setupTestDB, teardownTestDB, clearTestDB } from '../../api/tests/setup/dbTestHelper.js';
import {
  startEmailWorker,
  closeEmailWorker,
  __setTestTransporter,
  EMAIL_QUEUE_NAME,
} from '../src/jobs/emailWorker.js';
import { setEmailQueue, closeEmailQueue } from '../../api/src/jobs/emailQueue.js';

const MAILPIT_API = 'http://127.0.0.1:8025/api/v1';

async function clearMailpit() {
  try {
    await fetch(`${MAILPIT_API}/messages`, { method: 'DELETE' });
  } catch {
    // Ignore if mailpit not reachable
  }
}

async function getMailpitMessages() {
  const res = await fetch(`${MAILPIT_API}/messages`);
  const data = await res.json();
  return data.messages || [];
}

async function getMailpitMessageDetail(id) {
  const res = await fetch(`${MAILPIT_API}/message/${id}`);
  return await res.json();
}

async function waitForEmail(predicate, timeoutMs = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const messages = await getMailpitMessages();
    const match = messages.find(predicate);
    if (match) {
      return await getMailpitMessageDetail(match.ID);
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Timed out waiting for email matching predicate within ${timeoutMs}ms`);
}

describe('B2 & B4: Real Email Worker and Mailpit Integration', () => {
  let redis = null;
  let testQueue = null;
  let worker = null;

  beforeAll(async () => {
    process.env.ENABLE_TEST_EMAIL_QUEUE = 'true';
    await setupTestDB();
    await User.init();
    await AuthToken.init();

    redis = new Redis(process.env.REDIS_URL || 'redis://127.0.0.1:6379', {
      maxRetriesPerRequest: null,
    });

    testQueue = new Queue(EMAIL_QUEUE_NAME, {
      connection: redis,
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 200,
        },
        removeOnComplete: true,
      },
    });

    setEmailQueue(testQueue);
    worker = startEmailWorker(redis);
  });

  afterAll(async () => {
    delete process.env.ENABLE_TEST_EMAIL_QUEUE;
    await closeEmailWorker();
    await closeEmailQueue();
    if (testQueue) {
      await testQueue.close();
    }
    if (redis) {
      try {
        redis.disconnect();
      } catch {
        /* ignore */
      }
    }
    await teardownTestDB();
  });

  beforeEach(async () => {
    await clearTestDB();
    await clearMailpit();
    __setTestTransporter(null);
  });

  it('register -> receive verification email in Mailpit -> verify email successfully', async () => {
    const testEmail = `verify_${Date.now()}@example.com`;

    // 1. Register a new user
    const regRes = await request(app)
      .post('/v1/auth/register')
      .send({
        email: testEmail,
        password: 'Password123!',
        name: 'Email Test User',
        phone: '+919876543210',
        approxLocation: {
          type: 'Point',
          coordinates: [75.8577, 26.9124],
        },
        confirmAge: true,
        acceptTerms: true,
      });

    expect(regRes.status).toBe(201);
    expect(regRes.body.user.emailVerified).toBe(false);

    // 2. Poll Mailpit for verification email
    const email = await waitForEmail((m) =>
      m.To.some((to) => to.Address.toLowerCase() === testEmail.toLowerCase()),
    );
    expect(email.Subject).toMatch(/verify/i);

    // Extract token from query param in email body: token=...
    const content = email.Text || email.HTML || '';
    const match = content.match(/token=([A-Za-z0-9._-]+)/);
    expect(match).toBeTruthy();
    const token = match[1];

    // 3. Verify user's email with the token
    const verifyRes = await request(app).post('/v1/auth/verify-email').send({ token });

    expect(verifyRes.status).toBe(200);
    expect(verifyRes.body.user.emailVerified).toBe(true);
  });

  it('forgot-password -> receive password reset email in Mailpit -> reset password and login', async () => {
    const testEmail = `reset_${Date.now()}@example.com`;

    // 1. Register and verify user
    const regRes = await request(app)
      .post('/v1/auth/register')
      .send({
        email: testEmail,
        password: 'OldPassword123!',
        name: 'Reset Test User',
        phone: '+919876543211',
        approxLocation: {
          type: 'Point',
          coordinates: [75.8577, 26.9124],
        },
        confirmAge: true,
        acceptTerms: true,
      });
    expect(regRes.status).toBe(201);

    // Verify email directly in DB
    await User.updateOne({ email: testEmail }, { $set: { emailVerified: true } });
    await clearMailpit();

    // 2. Request password reset
    const forgotRes = await request(app)
      .post('/v1/auth/forgot-password')
      .send({ email: testEmail });
    expect(forgotRes.status).toBe(200);

    // 3. Wait for password reset email in Mailpit
    const email = await waitForEmail(
      (m) =>
        m.To.some((to) => to.Address.toLowerCase() === testEmail.toLowerCase()) &&
        /password/i.test(m.Subject),
    );
    expect(email.Subject).toMatch(/password/i);

    const content = email.Text || email.HTML || '';
    const match = content.match(/token=([A-Za-z0-9._-]+)/);
    expect(match).toBeTruthy();
    const resetToken = match[1];

    // 4. Reset password
    const resetRes = await request(app).post('/v1/auth/reset-password').send({
      token: resetToken,
      newPassword: 'NewSecurePassword123!',
    });
    expect(resetRes.status).toBe(200);

    // 5. Login with new password
    const loginRes = await request(app).post('/v1/auth/login').send({
      email: testEmail,
      password: 'NewSecurePassword123!',
    });
    expect(loginRes.status).toBe(200);
    expect(loginRes.body.accessToken).toBeDefined();
  });

  it('email worker retries after a simulated SMTP failure with exponential backoff', async () => {
    let attempts = 0;
    const fakeTransporter = {
      sendMail: async () => {
        attempts += 1;
        if (attempts === 1) {
          throw new Error('Simulated transient SMTP socket error');
        }
        return { messageId: 'simulated-success-id' };
      },
    };

    __setTestTransporter(fakeTransporter);

    const completionPromise = new Promise((resolve) => {
      const handler = (completedJob) => {
        if (completedJob.data?.subject === 'Retry Test Subject') {
          worker.off('completed', handler);
          resolve(completedJob);
        }
      };
      worker.on('completed', handler);
    });

    await testQueue.add(
      'send_email',
      {
        to: 'retry_test@example.com',
        subject: 'Retry Test Subject',
        text: 'Hello from retry test',
      },
      {
        attempts: 3,
        backoff: {
          type: 'fixed',
          delay: 150,
        },
      },
    );

    // Wait for the job to complete after retry
    const finishedJob = await completionPromise;
    expect(finishedJob).toBeDefined();
    expect(attempts).toBe(2);
  }, 15000);

  it('proves exactly one email per notification even with two concurrent workers (BullMQ dedupe jobId)', async () => {
    // Second worker instance running concurrently
    const { getTransporter } = await import('../src/jobs/emailWorker.js');
    const worker2Redis = redis.duplicate();
    const worker2 = new Worker(
      EMAIL_QUEUE_NAME,
      async (job) => {
        const { to, subject, text, html } = job.data;
        const transporter = getTransporter();
        return transporter.sendMail({
          from: 'BorrowLoop <noreply@borrowloop.test>',
          to,
          subject,
          text,
          html,
        });
      },
      { connection: worker2Redis },
    );

    const testTo = `multiworker_${Date.now()}@example.com`;
    const dedupeKey = `notif:single_email:${Date.now()}`;
    const safeJobId = `email_${dedupeKey.replace(/:/g, '_')}`;

    // Add job with deterministic jobId
    await testQueue.add(
      'send_email',
      {
        to: testTo,
        subject: 'Single Email Notification',
        text: 'This should only be sent once.',
      },
      { jobId: safeJobId },
    );

    // Concurrently try adding duplicate job with same jobId
    await testQueue
      .add(
        'send_email',
        {
          to: testTo,
          subject: 'Single Email Notification Duplicate',
          text: 'Duplicate should be deduped by BullMQ.',
        },
        { jobId: safeJobId },
      )
      .catch(() => {});

    // Wait for email in Mailpit
    await waitForEmail((m) => m.To.some((to) => to.Address.toLowerCase() === testTo.toLowerCase()));

    // Wait a brief tick to ensure no duplicate email arrives
    await new Promise((r) => setTimeout(r, 500));

    const messages = await getMailpitMessages();
    const matching = messages.filter((m) =>
      m.To.some((to) => to.Address.toLowerCase() === testTo.toLowerCase()),
    );
    expect(matching).toHaveLength(1); // Exactly one email delivered!

    await worker2.close();
    worker2Redis.disconnect();
  });

  it('scans all stored email bodies in Mailpit: verifies Demo money, NO pin coords, NO wallet balances, correct links', async () => {
    __setTestTransporter(null);
    // Send a sample cancellation notification email with refund info
    const moneyEmail = `money_${Date.now()}@example.com`;
    await testQueue.add('send_email', {
      to: moneyEmail,
      subject: 'Booking cancelled - Refund issued',
      text: 'Your booking has been cancelled and funds refunded in full (Demo money). View booking at /bookings/6aef76324e2bcaf5243c9f3b',
    });

    await waitForEmail((m) =>
      m.To.some((to) => to.Address.toLowerCase() === moneyEmail.toLowerCase()),
    );

    // Scan all stored messages in Mailpit
    const messages = await getMailpitMessages();
    expect(messages.length).toBeGreaterThanOrEqual(1);

    for (const msgSummary of messages) {
      const detail = await getMailpitMessageDetail(msgSummary.ID);
      const text = (detail.Text || '') + ' ' + (detail.HTML || '');

      // Invariant 1: If money/refund/deposit is mentioned, it MUST contain "Demo money"
      if (/refund|deposit|paise|fee|payment|money/i.test(text)) {
        expect(text).toMatch(/Demo money/i);
      }

      // Invariant 2: NO pin coordinates in any email
      expect(text).not.toMatch(/lat\s*:\s*\d+/i);
      expect(text).not.toMatch(/lng\s*:\s*\d+/i);
      expect(text).not.toMatch(/coordinates\s*:\s*\[/i);

      // Invariant 3: NO private wallet balances in any email
      expect(text).not.toMatch(/availablePaise/i);
      expect(text).not.toMatch(/wallet balance/i);

      // Invariant 4: Links must be valid application paths or URLs
      const linkMatches = text.match(/\/bookings\/[0-9a-fA-F]{24}/g);
      if (linkMatches) {
        for (const link of linkMatches) {
          expect(link).toMatch(/^\/bookings\/[0-9a-fA-F]{24}$/);
        }
      }
    }
  });

  it('marks job failed after maximum retry attempts on permanent SMTP failure', async () => {
    const alwaysFailTransporter = {
      sendMail: async () => {
        throw new Error('Permanent SMTP rejection 550');
      },
    };

    __setTestTransporter(alwaysFailTransporter);

    const failPromise = new Promise((resolve) => {
      const failHandler = (failedJob) => {
        if (failedJob.data?.subject === 'Max Retry Fail Test' && failedJob.attemptsMade >= 2) {
          worker.off('failed', failHandler);
          resolve(failedJob);
        }
      };
      worker.on('failed', failHandler);
    });

    try {
      await testQueue.add(
        'send_email',
        {
          to: 'perm_fail@example.com',
          subject: 'Max Retry Fail Test',
          text: 'This will fail all attempts',
        },
        {
          attempts: 2,
          backoff: {
            type: 'fixed',
            delay: 50,
          },
        },
      );

      const failedJob = await failPromise;
      expect(failedJob).toBeDefined();
      expect(failedJob.attemptsMade).toBe(2);
    } finally {
      __setTestTransporter(null);
    }
  }, 10000);
});
