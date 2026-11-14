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
  handoverIssueQrSchema,
  handoverScanSchema,
  handoverFallbackCodeSchema,
  handoverPhotosSchema,
} from '@borrowloop/shared';
import * as bookingController from './bookingController.js';
import * as chatController from '../chat/chatController.js';
import * as handoverController from '../handovers/handoverController.js';

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

const issueQrLimiter = createRateLimiter({
  get redis() {
    return getRedisClient();
  },
  windowSeconds: BUSINESS_CONFIG.HANDOVER.RATE_LIMITS.ISSUE_QR.windowSeconds,
  maxRequests: BUSINESS_CONFIG.HANDOVER.RATE_LIMITS.ISSUE_QR.maxRequests,
  keyPrefix: 'rl:handover:issue_qr',
  keyGenerator: (req) => req.user?.id || req.ip,
});

const scanLimiter = createRateLimiter({
  get redis() {
    return getRedisClient();
  },
  windowSeconds: BUSINESS_CONFIG.HANDOVER.RATE_LIMITS.SCAN.windowSeconds,
  maxRequests: BUSINESS_CONFIG.HANDOVER.RATE_LIMITS.SCAN.maxRequests,
  keyPrefix: 'rl:handover:scan',
  keyGenerator: (req) => req.user?.id || req.ip,
});

const codeLimiter = createRateLimiter({
  get redis() {
    return getRedisClient();
  },
  windowSeconds: BUSINESS_CONFIG.HANDOVER.RATE_LIMITS.CODE.windowSeconds,
  maxRequests: BUSINESS_CONFIG.HANDOVER.RATE_LIMITS.CODE.maxRequests,
  keyPrefix: 'rl:handover:code',
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
// Handover & Return Endpoints (Phase 7)
router.post(
  '/:id/handover/qr',
  issueQrLimiter,
  validate({ body: handoverIssueQrSchema }),
  handoverController.issuePickupQr,
);

router.post(
  '/:id/handover/scan',
  requireIdempotencyKey(),
  scanLimiter,
  validate({ body: handoverScanSchema }),
  handoverController.scanPickupQr,
);

router.post(
  '/:id/handover/code',
  requireIdempotencyKey(),
  codeLimiter,
  validate({ body: handoverFallbackCodeSchema }),
  handoverController.verifyPickupCode,
);

router.post(
  '/:id/return/qr',
  issueQrLimiter,
  validate({ body: handoverIssueQrSchema }),
  handoverController.issueReturnQr,
);

router.post(
  '/:id/return/scan',
  requireIdempotencyKey(),
  scanLimiter,
  validate({ body: handoverScanSchema }),
  handoverController.scanReturnQr,
);

router.post(
  '/:id/return/code',
  requireIdempotencyKey(),
  codeLimiter,
  validate({ body: handoverFallbackCodeSchema }),
  handoverController.verifyReturnCode,
);

router.post(
  '/:id/photos',
  validate({ body: handoverPhotosSchema }),
  handoverController.registerPhotos,
);

router.get('/:id/handovers', handoverController.getHandovers);

export default router;
