/**
 * @file packages/server-core/src/services/eventStub.js
 * Domain event persistence and in-memory test recording for BorrowLoop.
 * Persists events to the domain_events collection inside MongoDB transactions
 * or with an explicit eventKey using $setOnInsert upserts.
 */

import mongoose from 'mongoose';
import { AppError, ERROR_CODES } from '@borrowloop/shared';
import DomainEvent from '../models/DomainEvent.js';
import logger from '../common/logger.js';

const recordedEvents = [];

/**
 * Emits and records a domain event.
 * Persists to MongoDB domain_events collection if session or eventKey is provided.
 *
 * @param {string} eventName
 * @param {object} [payload={}]
 * @param {object} [options={}]
 * @param {import('mongoose').ClientSession | null} [options.session=null]
 * @param {string | null} [options.eventKey=null]
 * @param {any} [options.bookingId=null]
 * @param {any} [options.actorId=null]
 * @returns {Promise<object>}
 */
export async function emitDomainEvent(eventName, payload = {}, options = {}) {
  const { session = null, eventKey = null, bookingId = null, actorId = null } = options;

  // Item 5: In product code, require session or eventKey, otherwise throw
  if (!session && !eventKey && process.env.NODE_ENV !== 'test') {
    throw new AppError(
      ERROR_CODES.INTERNAL_ERROR,
      'emitDomainEvent requires session or eventKey in product code',
      500,
    );
  }

  const event = {
    id: `evt-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    eventName,
    payload,
    timestamp: new Date().toISOString(),
  };

  // Item 5: Recording in memory is test-only
  if (process.env.NODE_ENV === 'test') {
    recordedEvents.push(event);
  }

  logger.info({ eventName, payload }, `Domain Event Emitted: ${eventName}`);

  if (session || eventKey) {
    const rawBookingId = bookingId || payload.bookingId;
    const rawActorId = actorId || payload.userId;

    const validBookingId =
      rawBookingId && mongoose.Types.ObjectId.isValid(rawBookingId)
        ? new mongoose.Types.ObjectId(rawBookingId)
        : null;

    const validActorId =
      rawActorId && mongoose.Types.ObjectId.isValid(rawActorId)
        ? new mongoose.Types.ObjectId(rawActorId)
        : null;

    const key =
      eventKey ||
      `${eventName}_${validBookingId || 'none'}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    // Item 5: $setOnInsert on eventKey so duplicate event inside a transaction does not abort it
    await DomainEvent.updateOne(
      { eventKey: key },
      {
        $setOnInsert: {
          eventKey: key,
          type: eventName,
          bookingId: validBookingId,
          actorId: validActorId,
          payload,
          timestamp: new Date(),
          status: 'pending',
        },
      },
      { upsert: true, session },
    );
  }

  return event;
}

/**
 * Returns a copy of all recorded domain events (for testing assertions).
 *
 * @returns {Array<object>}
 */
export function getRecordedEvents() {
  return [...recordedEvents];
}

/**
 * Clears recorded domain events.
 */
export function clearRecordedEvents() {
  recordedEvents.length = 0;
}

export default {
  emitDomainEvent,
  getRecordedEvents,
  clearRecordedEvents,
};
