/**
 * @file apps/worker/src/jobs/outboxDispatcher.js
 * Outbox processor polling domain_events and reliably producing
 * in-app notifications and enqueuing email jobs.
 */

import { Queue } from 'bullmq';
import { Emitter } from '@socket.io/redis-emitter';
import { DomainEvent, Notification, User, runWithRedisLock } from '@borrowloop/server-core';
import { BUSINESS_CONFIG } from '@borrowloop/shared';
import logger from '../logger.js';
import { EMAIL_QUEUE_NAME } from './emailWorker.js';

let emailQueue = null;
let redisEmitter = null;

function getRedisEmitter(redisClient) {
  if (!redisEmitter && redisClient) {
    try {
      if (redisClient.status !== 'ready' && redisClient.status !== 'connecting') {
        redisClient.connect().catch(() => {});
      }
      redisEmitter = new Emitter(redisClient);
    } catch (err) {
      logger.warn({ err: err.message }, 'Failed to initialize Redis Emitter');
    }
  }
  return redisEmitter;
}

export const HANDLED_EVENT_TYPES = new Set([
  'booking.requested',
  'booking.accepted',
  'booking.rejected',
  'booking.cancelled',
  'booking.extension_requested',
  'booking.extension_accepted',
  'booking.extension_rejected',
  'booking.pickup_reminder',
  'booking.due_reminder',
  'booking.expired',
  'booking.extension_expired',
  'booking.auto_rejected_overlapping',
  'reconciliation.mismatch',
]);

export const NO_NOTIFICATION_EVENT_TYPES = new Set(['trust_score.penalty', 'trust_score.reward']);

function getEmailQueue(redisClient) {
  if (!emailQueue) {
    emailQueue = new Queue(EMAIL_QUEUE_NAME, {
      connection: redisClient.duplicate({ maxRetriesPerRequest: null }),
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5000,
        },
        removeOnComplete: 1000,
        removeOnFail: 5000,
      },
    });
  }
  return emailQueue;
}

async function getUserWithCache(userId, userCache) {
  if (!userId) return null;
  const idStr = userId.toString();
  if (userCache && userCache.has(idStr)) {
    return userCache.get(idStr);
  }
  const user = await User.findById(userId).lean();
  if (userCache && user) {
    userCache.set(idStr, user);
  }
  return user;
}

/**
 * Maps a domain event to in-app notifications and email payloads.
 *
 * @param {import('@borrowloop/server-core').DomainEvent} event
 * @param {import('ioredis').Redis} redisClient
 * @param {Map<string, object>} [userCache]
 */
async function dispatchSingleEvent(event, redisClient, userCache = null) {
  const { type, payload = {}, bookingId } = event;
  const eq = getEmailQueue(redisClient);

  // Helper to safely create notification with duplicate-key protection
  const createNotif = async ({ userId, notifType, title, body, link, dedupeKey }) => {
    try {
      const notif = await Notification.create({
        userId,
        type: notifType,
        title,
        body,
        link,
        dedupeKey,
      });

      // Item 12: Emit notification:new and booking:updated via Redis emitter
      const emitter = getRedisEmitter(redisClient);
      if (emitter) {
        try {
          emitter.to(`user:${userId}`).emit('notification:new', {
            notification: {
              id: notif._id.toString(),
              type: notifType,
              title,
              body,
              link,
              createdAt: notif.createdAt.toISOString(),
            },
          });
          if (bookingId) {
            emitter.to(`user:${userId}`).emit('booking:updated', {
              bookingId: bookingId.toString(),
              eventType: type,
            });
            emitter.to(`booking:${bookingId}`).emit('booking:updated', {
              bookingId: bookingId.toString(),
              eventType: type,
            });
          }
        } catch (emitErr) {
          logger.warn({ err: emitErr.message }, 'Redis Emitter emit failed');
        }
      }
    } catch (err) {
      if (err.code === 11000) {
        logger.debug({ dedupeKey }, 'Notification dedupe hit; skipping duplicate insert');
      } else {
        throw err;
      }
    }
  };

  // Helper to enqueue email with deterministic jobId
  const queueEmail = async ({ to, subject, text, html, dedupeKey }) => {
    if (!to) return;
    try {
      const safeJobId = `email_${dedupeKey.replace(/:/g, '_')}`;
      await eq.add('send_email', { to, subject, text, html }, { jobId: safeJobId });
    } catch (err) {
      logger.error({ err: err.message, dedupeKey }, 'Failed to enqueue email job');
    }
  };

  switch (type) {
    case 'booking.requested': {
      const lenderId = payload.lenderId;
      if (lenderId) {
        const dedupeKey = `notif:req:${bookingId}:${lenderId}`;
        await createNotif({
          userId: lenderId,
          notifType: 'booking_requested',
          title: 'New booking request',
          body: 'A borrower requested to borrow your item.',
          link: `/bookings/${bookingId}`,
          dedupeKey,
        });

        const lender = await getUserWithCache(lenderId, userCache);
        if (lender?.email) {
          await queueEmail({
            to: lender.email,
            subject: 'New booking request for your item',
            text: `You have received a new booking request. Visit your dashboard to accept or decline: /bookings/${bookingId}`,
            dedupeKey,
          });
        }
      }
      break;
    }

    case 'booking.accepted': {
      const borrowerId = payload.borrowerId;
      if (borrowerId) {
        const dedupeKey = `notif:acc:${bookingId}:${borrowerId}`;
        await createNotif({
          userId: borrowerId,
          notifType: 'booking_accepted',
          title: 'Booking accepted!',
          body: 'The lender accepted your request. Meet to pick it up!',
          link: `/bookings/${bookingId}`,
          dedupeKey,
        });

        const borrower = await getUserWithCache(borrowerId, userCache);
        if (borrower?.email) {
          await queueEmail({
            to: borrower.email,
            subject: 'Booking accepted!',
            text: `Your booking request was accepted! Coordinate pickup details via chat: /bookings/${bookingId}`,
            dedupeKey,
          });
        }
      }
      break;
    }

    case 'booking.rejected': {
      const borrowerId = payload.borrowerId;
      if (borrowerId) {
        const dedupeKey = `notif:rej:${bookingId}:${borrowerId}`;
        await createNotif({
          userId: borrowerId,
          notifType: 'booking_rejected',
          title: 'Booking declined',
          body: 'The lender was unable to accept your request.',
          link: `/bookings/${bookingId}`,
          dedupeKey,
        });

        const borrower = await getUserWithCache(borrowerId, userCache);
        if (borrower?.email) {
          await queueEmail({
            to: borrower.email,
            subject: 'Booking request declined',
            text: `Your booking request was declined. Any temporary locks have been released.`,
            dedupeKey,
          });
        }
      }
      break;
    }

    case 'booking.cancelled': {
      const recipientId =
        payload.recipientId ||
        (payload.cancelledByRole === 'borrower' ? payload.lenderId : payload.borrowerId);
      if (recipientId) {
        const dedupeKey = `notif:can:${bookingId}:${recipientId}`;
        await createNotif({
          userId: recipientId,
          notifType: 'booking_cancelled',
          title: 'Booking cancelled',
          body: 'The booking was cancelled. Any held funds have been refunded (Demo money).',
          link: `/bookings/${bookingId}`,
          dedupeKey,
        });

        const user = await getUserWithCache(recipientId, userCache);
        if (user?.email) {
          await queueEmail({
            to: user.email,
            subject: 'Booking cancelled',
            text: `A booking was cancelled. Any held funds have been refunded in full (Demo money). View details: /bookings/${bookingId}`,
            dedupeKey,
          });
        }
      }
      break;
    }

    case 'booking.extension_requested': {
      const lenderId = payload.lenderId;
      if (lenderId) {
        const dedupeKey = `notif:ext_req:${bookingId}:${payload.extensionId}`;
        await createNotif({
          userId: lenderId,
          notifType: 'extension_requested',
          title: 'Extension requested',
          body: 'The borrower requested extra days for this booking.',
          link: `/bookings/${bookingId}`,
          dedupeKey,
        });

        const lender = await getUserWithCache(lenderId, userCache);
        if (lender?.email) {
          await queueEmail({
            to: lender.email,
            subject: 'Extension requested for your item',
            text: `The borrower requested an extension. Visit your booking to review: /bookings/${bookingId}`,
            dedupeKey,
          });
        }
      }
      break;
    }

    case 'booking.extension_accepted': {
      const borrowerId = payload.borrowerId;
      if (borrowerId) {
        const dedupeKey = `notif:ext_acc:${bookingId}:${payload.extensionId}`;
        await createNotif({
          userId: borrowerId,
          notifType: 'extension_accepted',
          title: 'Extension approved!',
          body: 'Your booking extension was accepted by the lender.',
          link: `/bookings/${bookingId}`,
          dedupeKey,
        });

        const borrower = await getUserWithCache(borrowerId, userCache);
        if (borrower?.email) {
          await queueEmail({
            to: borrower.email,
            subject: 'Extension accepted!',
            text: `Your extension was accepted! Check your updated return due date: /bookings/${bookingId}`,
            dedupeKey,
          });
        }
      }
      break;
    }

    case 'booking.extension_rejected': {
      const borrowerId = payload.borrowerId;
      if (borrowerId) {
        const dedupeKey = `notif:ext_rej:${bookingId}:${payload.extensionId}`;
        await createNotif({
          userId: borrowerId,
          notifType: 'extension_rejected',
          title: 'Extension declined',
          body: 'Your booking extension request was declined.',
          link: `/bookings/${bookingId}`,
          dedupeKey,
        });

        const borrower = await getUserWithCache(borrowerId, userCache);
        if (borrower?.email) {
          await queueEmail({
            to: borrower.email,
            subject: 'Extension declined',
            text: `Your extension request was declined. Please ensure the item is returned by the original due date.`,
            dedupeKey,
          });
        }
      }
      break;
    }

    case 'booking.pickup_reminder': {
      const userId = payload.userId;
      if (userId) {
        const dedupeKey = `notif:pickup_rem:${bookingId}:${userId}:${payload.startDate}`;
        await createNotif({
          userId,
          notifType: 'pickup_reminder',
          title: 'Upcoming pickup today',
          body: 'Your booking starts today. Arrange handover with the other party.',
          link: `/bookings/${bookingId}`,
          dedupeKey,
        });

        const user = await getUserWithCache(userId, userCache);
        if (user?.email) {
          await queueEmail({
            to: user.email,
            subject: 'Reminder: Pickup scheduled today',
            text: `Your booking starts today. Coordinate handover via chat: /bookings/${bookingId}`,
            dedupeKey,
          });
        }
      }
      break;
    }

    case 'booking.due_reminder': {
      const userId = payload.userId;
      if (userId) {
        const dedupeKey = `notif:due_rem:${bookingId}:${userId}:${payload.endDate}`;
        await createNotif({
          userId,
          notifType: 'due_reminder',
          title: 'Item due soon',
          body: 'Your booking is due to end soon. Arrange return handover.',
          link: `/bookings/${bookingId}`,
          dedupeKey,
        });

        const user = await getUserWithCache(userId, userCache);
        if (user?.email) {
          await queueEmail({
            to: user.email,
            subject: 'Reminder: Item due soon',
            text: `Your booking is ending soon. Arrange return handover: /bookings/${bookingId}`,
            dedupeKey,
          });
        }
      }
      break;
    }

    case 'booking.expired': {
      const recipientIds = [payload.borrowerId, payload.lenderId].filter(Boolean);
      const isRequestTimeout = payload.reason === 'request_timeout_24h';
      for (const uid of recipientIds) {
        const dedupeKey = `notif:exp:${bookingId}:${uid}`;
        const isBorrower = payload.borrowerId && uid.toString() === payload.borrowerId.toString();

        const title = isRequestTimeout
          ? 'Booking request expired'
          : 'Booking expired (pickup deadline)';
        const body = isRequestTimeout
          ? isBorrower
            ? 'The lender did not respond within 24 hours. Any held funds are released.'
            : 'A booking request expired without a response.'
          : isBorrower
            ? 'Pickup deadline passed without handover. All funds refunded (Demo money).'
            : 'Pickup deadline passed without handover.';

        await createNotif({
          userId: uid,
          notifType: 'booking_expired',
          title,
          body,
          link: `/bookings/${bookingId}`,
          dedupeKey,
        });

        const user = await getUserWithCache(uid, userCache);
        if (user?.email) {
          await queueEmail({
            to: user.email,
            subject: title,
            text: `${body} View details: /bookings/${bookingId}`,
            dedupeKey,
          });
        }
      }
      break;
    }

    case 'booking.extension_expired': {
      const recipientIds = [payload.borrowerId, payload.lenderId].filter(Boolean);
      for (const uid of recipientIds) {
        const dedupeKey = `notif:ext_exp:${bookingId}:${payload.extensionId || 'ext'}:${uid}`;
        const isBorrower = payload.borrowerId && uid.toString() === payload.borrowerId.toString();
        const title = 'Extension request expired';
        const body = isBorrower
          ? 'Your extension request expired without a lender response. Any held funds have been refunded.'
          : 'An extension request expired without a response.';

        await createNotif({
          userId: uid,
          notifType: 'extension_expired',
          title,
          body,
          link: `/bookings/${bookingId}`,
          dedupeKey,
        });

        const user = await getUserWithCache(uid, userCache);
        if (user?.email) {
          await queueEmail({
            to: user.email,
            subject: title,
            text: `${body} View details: /bookings/${bookingId}`,
            dedupeKey,
          });
        }
      }
      break;
    }

    case 'booking.auto_rejected_overlapping': {
      const borrowerId = payload.borrowerId;
      if (borrowerId) {
        const dedupeKey = `notif:auto_rej:${bookingId}:${borrowerId}`;
        await createNotif({
          userId: borrowerId,
          notifType: 'booking_rejected',
          title: 'Booking request declined',
          body: 'Another booking was accepted for these dates. Your request has been cancelled.',
          link: `/bookings/${bookingId}`,
          dedupeKey,
        });

        const user = await getUserWithCache(borrowerId, userCache);
        if (user?.email) {
          await queueEmail({
            to: user.email,
            subject: 'Booking request declined',
            text: 'Another booking was accepted for these dates. Your request has been cancelled and any temporary locks released.',
            dedupeKey,
          });
        }
      }
      break;
    }

    case 'reconciliation.mismatch': {
      const admins = await User.find({ role: 'admin' }).lean();
      for (const admin of admins) {
        const dedupeKey = `notif:recon_mismatch:${payload.runId}:${admin._id}`;
        await createNotif({
          userId: admin._id,
          notifType: 'reconciliation_mismatch',
          title: 'Reconciliation mismatch detected',
          body: 'Nightly reconciliation detected an imbalance. Inspect run.',
          link: '/admin/ledger/reconciliation',
          dedupeKey,
        });

        if (admin.email) {
          await queueEmail({
            to: admin.email,
            subject: 'CRITICAL: Ledger reconciliation mismatch detected',
            text: `Nightly reconciliation detected a mismatch in run ${payload.runId}. Inspect admin portal immediately.`,
            dedupeKey,
          });
        }
      }
      break;
    }

    default:
      logger.debug({ type }, 'Domain event does not require external notification');
      break;
  }
}

/**
 * Atomically claims a batch of pending, retryable, or crashed lease-expired events.
 * Uses atomic MongoDB updateMany with claimToken.
 * Multiple concurrent worker processes can never claim or process the same events.
 *
 * @param {number} [batchSize]
 * @param {Date} [currentTime=new Date()]
 * @returns {Promise<Array<import('@borrowloop/server-core').DomainEvent>>}
 */
export async function claimOutboxBatch(
  batchSize = BUSINESS_CONFIG.OUTBOX.BATCH_SIZE,
  currentTime = new Date(),
) {
  const leaseTimeoutMs = BUSINESS_CONFIG.OUTBOX.LEASE_TIMEOUT_MS || 300000;
  const leaseExpiredDate = new Date(currentTime.getTime() - leaseTimeoutMs);

  const candidates = await DomainEvent.find(
    {
      $or: [
        { status: 'pending' },
        {
          status: 'failed',
          retryCount: { $lt: BUSINESS_CONFIG.OUTBOX.MAX_RETRIES },
          nextRetryAt: { $lte: currentTime },
        },
        {
          status: 'processing',
          lockedAt: { $lte: leaseExpiredDate },
        },
      ],
    },
    { _id: 1 },
  )
    .sort({ createdAt: 1 })
    .limit(batchSize)
    .lean();

  if (candidates.length === 0) return [];

  const candidateIds = candidates.map((c) => c._id);
  const claimToken = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

  await DomainEvent.updateMany(
    {
      _id: { $in: candidateIds },
      $or: [
        { status: 'pending' },
        {
          status: 'failed',
          retryCount: { $lt: BUSINESS_CONFIG.OUTBOX.MAX_RETRIES },
          nextRetryAt: { $lte: currentTime },
        },
        {
          status: 'processing',
          lockedAt: { $lte: leaseExpiredDate },
        },
      ],
    },
    {
      $set: {
        status: 'processing',
        lockedAt: currentTime,
        claimToken,
      },
    },
  );

  return DomainEvent.find({ claimToken }).sort({ createdAt: 1 });
}

/**
 * Atomically claims a single event (wrapper over claimOutboxBatch).
 */
export async function claimNextOutboxEvent(currentTime = new Date()) {
  const batch = await claimOutboxBatch(1, currentTime);
  return batch.length > 0 ? batch[0] : null;
}

/**
 * Processes a batch of pending or failed domain events from the outbox.
 *
 * @param {object} params
 * @param {import('ioredis').Redis} params.redisClient
 * @param {number} [params.batchSize]
 * @returns {Promise<number>} Number of processed events
 */
export async function processOutboxEvents({
  redisClient,
  batchSize = BUSINESS_CONFIG.OUTBOX.BATCH_SIZE,
}) {
  const events = await claimOutboxBatch(batchSize);
  if (events.length === 0) return 0;

  const userCache = new Map();
  let processedCount = 0;

  for (const event of events) {
    try {
      await dispatchSingleEvent(event, redisClient, userCache);

      event.status = 'processed';
      event.processedAt = new Date();
      event.error = null;
      event.lockedAt = null;
      event.claimToken = null;
      await event.save();

      processedCount++;
    } catch (err) {
      logger.error(
        { eventId: event._id, eventKey: event.eventKey, err: err.message },
        'Failed to process outbox event',
      );

      const nextRetryCount = (event.retryCount || 0) + 1;
      const isDeadLetter = nextRetryCount >= BUSINESS_CONFIG.OUTBOX.MAX_RETRIES;
      const delayMs = Math.min(
        BUSINESS_CONFIG.OUTBOX.MAX_BACKOFF_MS,
        BUSINESS_CONFIG.OUTBOX.INITIAL_BACKOFF_MS * Math.pow(2, nextRetryCount),
      );

      event.status = isDeadLetter ? 'failed' : 'failed';
      event.retryCount = nextRetryCount;
      event.nextRetryAt = new Date(Date.now() + delayMs);
      event.error = err.message;
      event.lockedAt = null;
      event.claimToken = null;
      await event.save();
    }
  }

  return processedCount;
}

/**
 * Starts the repeatable outbox dispatcher polling loop.
 *
 * @param {import('ioredis').Redis} redisClient
 */
export function startOutboxDispatcher(redisClient) {
  const intervalMs = BUSINESS_CONFIG.OUTBOX.POLL_INTERVAL_MS;

  const timer = setInterval(async () => {
    await runWithRedisLock({
      name: 'outbox_dispatcher',
      lockTtlMs: 15000,
      redisClient,
      handler: async () => {
        return processOutboxEvents({ redisClient });
      },
      logger,
    });
  }, intervalMs);

  return timer;
}

export { dispatchSingleEvent as dispatchSingleEventForTest };
