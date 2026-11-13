/**
 * @file apps/api/src/modules/bookings/bookingRoutes.js
 * Express routes for the booking lifecycle matching docs/API_SPEC.md.
 */

import { Router } from 'express';
import { validate } from '../../common/validate.js';
import { authenticate, requireVerifiedEmail } from '../../common/authMiddleware.js';
import { requireIdempotencyKey } from '../../common/idempotencyMiddleware.js';
import { createRateLimiter } from '../../common/rateLimiter.js';
import { getRedisClient } from '../../redis.js';
import {
  BUSINESS_CONFIG,
  createBookingSchema,
  cancelBookingSchema,
  rejectBookingSchema,
  createExtensionSchema,
  bookingQuerySchema,
  createMessageSchema,
  confirmPinSchema,
  listMessagesQuerySchema,
} from '@borrowloop/shared';
import * as bookingController from './bookingController.js';
import * as chatController from '../chat/chatController.js';

const router = Router();

const chatMessageLimiter = createRateLimiter({
  get redis() {
    return getRedisClient();
  },
  windowSeconds: BUSINESS_CONFIG.CHAT.RATE_LIMITS.SEND_MESSAGE_USER.windowSeconds,
  maxRequests: BUSINESS_CONFIG.CHAT.RATE_LIMITS.SEND_MESSAGE_USER.maxRequests,
  keyPrefix: 'rl:chat:msg',
  keyGenerator: (req) => req.user?.id || req.ip,
});

const pinConfirmLimiter = createRateLimiter({
  get redis() {
    return getRedisClient();
  },
  windowSeconds: BUSINESS_CONFIG.CHAT.RATE_LIMITS.CONFIRM_PIN.windowSeconds,
  maxRequests: BUSINESS_CONFIG.CHAT.RATE_LIMITS.CONFIRM_PIN.maxRequests,
  keyPrefix: 'rl:chat:pin_confirm',
  keyGenerator: (req) => req.user?.id || req.ip,
});

// All booking routes require authenticated user and verified email
router.use(authenticate());
router.use(requireVerifiedEmail);

// Create a new booking request
router.post(
  '/',
  requireIdempotencyKey(),
  validate({ body: createBookingSchema }),
  bookingController.createBooking,
);

// List bookings for current user
router.get('/', validate({ query: bookingQuerySchema }), bookingController.listBookings);

// Get single booking detail
router.get('/:id', bookingController.getBooking);

// Accept a booking request
router.post('/:id/accept', requireIdempotencyKey(), bookingController.acceptBooking);

// Reject a booking request
router.post(
  '/:id/reject',
  requireIdempotencyKey(),
  validate({ body: rejectBookingSchema }),
  bookingController.rejectBooking,
);

// Cancel a booking
router.post(
  '/:id/cancel',
  requireIdempotencyKey(),
  validate({ body: cancelBookingSchema }),
  bookingController.cancelBooking,
);

// Request an extension
router.post(
  '/:id/extensions',
  requireIdempotencyKey(),
  validate({ body: createExtensionSchema }),
  bookingController.requestExtension,
);

// Accept an extension
router.post('/:id/extensions/accept', requireIdempotencyKey(), bookingController.acceptExtension);

// Reject an extension
router.post(
  '/:id/extensions/reject',
  requireIdempotencyKey(),
  validate({ body: rejectBookingSchema }),
  bookingController.rejectExtension,
);

// Chat & Map Pin Endpoints (Phase 6)
router.get(
  '/:id/messages',
  validate({ query: listMessagesQuerySchema }),
  chatController.listMessages,
);
router.post(
  '/:id/messages',
  chatMessageLimiter,
  validate({ body: createMessageSchema }),
  chatController.sendMessage,
);
router.post(
  '/:id/pin/confirm',
  pinConfirmLimiter,
  validate({ body: confirmPinSchema }),
  chatController.confirmPin,
);
router.post('/:id/messages/read', chatController.markMessagesAsRead);

export default router;
