/**
 * @file apps/worker/src/jobs/reminderJobs.js
 * Scheduled reminder jobs for pickups and return due dates.
 * Enforces deduplication via unique dedupeKey.
 */

import { Booking, DomainEvent, runWithRedisLock } from '@borrowloop/server-core';
import { BUSINESS_CONFIG } from '@borrowloop/shared';
import logger from '../logger.js';

/**
 * Sends pickup reminders to borrower and lender for bookings starting within 2 hours.
 *
 * @param {object} params
 * @param {import('ioredis').Redis} params.redisClient
 * @returns {Promise<{ processed: number }>}
 */
export async function sendPickupReminders({ redisClient }) {
  return runWithRedisLock({
    name: 'pickup_reminders_job',
    lockTtlMs: 60000,
    redisClient,
    handler: async () => {
      const now = new Date();
      // Threshold: bookings starting within next 2 hours
      const thresholdHours = BUSINESS_CONFIG.BACKGROUND_JOBS.PICKUP_REMINDERS_THRESHOLD_HOURS || 2;
      const futureThreshold = new Date(now.getTime() + thresholdHours * 3600 * 1000);

      // Find accepted bookings starting soon
      const bookings = await Booking.find({
        status: 'accepted',
        startDate: { $lte: futureThreshold.toISOString().slice(0, 10) },
      }).limit(100);

      let processedCount = 0;

      for (const booking of bookings) {
        const users = [booking.borrowerId, booking.lenderId];
        for (const userId of users) {
          const dedupeKey = `notif:pickup_rem:${booking._id}:${userId}:${booking.startDate}`;
          const existing = await DomainEvent.findOne({ eventKey: dedupeKey });
          if (!existing) {
            await DomainEvent.create({
              eventKey: dedupeKey,
              type: 'booking.pickup_reminder',
              bookingId: booking._id,
              actorId: userId,
              payload: {
                bookingId: booking._id,
                userId,
                startDate: booking.startDate,
              },
              status: 'pending',
            });
            processedCount++;
          }
        }
      }

      logger.info({ processedCount }, 'Pickup reminders check completed');
      return { processed: processedCount };
    },
    logger,
  });
}

/**
 * Sends due reminders to borrower and lender for bookings ending within 2 hours.
 *
 * @param {object} params
 * @param {import('ioredis').Redis} params.redisClient
 * @returns {Promise<{ processed: number }>}
 */
export async function sendDueReminders({ redisClient }) {
  return runWithRedisLock({
    name: 'due_reminders_job',
    lockTtlMs: 60000,
    redisClient,
    handler: async () => {
      const now = new Date();
      const thresholdHours = BUSINESS_CONFIG.BACKGROUND_JOBS.DUE_REMINDERS_THRESHOLD_HOURS || 2;
      const futureThreshold = new Date(now.getTime() + thresholdHours * 3600 * 1000);

      // Find picked_up bookings due within threshold
      const bookings = await Booking.find({
        status: 'picked_up',
        dueAt: { $gte: now, $lte: futureThreshold },
      }).limit(100);

      let processedCount = 0;

      for (const booking of bookings) {
        const users = [booking.borrowerId, booking.lenderId];
        for (const userId of users) {
          const dedupeKey = `notif:due_rem:${booking._id}:${userId}:${booking.endDate}`;
          const existing = await DomainEvent.findOne({ eventKey: dedupeKey });
          if (!existing) {
            await DomainEvent.create({
              eventKey: dedupeKey,
              type: 'booking.due_reminder',
              bookingId: booking._id,
              actorId: userId,
              payload: {
                bookingId: booking._id,
                userId,
                endDate: booking.endDate,
              },
              status: 'pending',
            });
            processedCount++;
          }
        }
      }

      logger.info({ processedCount }, 'Due reminders check completed');
      return { processed: processedCount };
    },
    logger,
  });
}
