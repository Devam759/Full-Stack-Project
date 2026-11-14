/**
 * @file apps/api/src/modules/handovers/handoverService.js
 * Core service managing rotating QR tokens, 6-digit fallback codes, proximity verification,
 * condition photos, and atomic state transitions for pickup and return.
 */

import crypto from 'crypto';
import { AppError, ERROR_CODES, BUSINESS_CONFIG, calculateLateCharge } from '@borrowloop/shared';
import {
  Booking,
  Handover,
  ItemDayLock,
  runInTransactionWithRetry,
  emitDomainEvent,
  saveIdempotencyRecord,
} from '@borrowloop/server-core';
import config from '../../config/index.js';

// In-memory fallback cache for geo coordinates when Redis is offline / in-memory test environment
const inMemoryGeoStore = new Map();

export async function setHandoverGeo(redisClient, key, value, ttlSeconds = 60) {
  if (redisClient && redisClient.status === 'ready') {
    try {
      await redisClient.set(key, value, 'EX', ttlSeconds);
      return;
    } catch {
      // Fall through to memory
    }
  }
  inMemoryGeoStore.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
}

export async function getHandoverGeo(redisClient, key) {
  if (redisClient && redisClient.status === 'ready') {
    try {
      const val = await redisClient.get(key);
      if (val) return val;
    } catch {
      // Fall through to memory
    }
  }
  const entry = inMemoryGeoStore.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    inMemoryGeoStore.delete(key);
    return null;
  }
  return entry.value;
}

/**
 * Calculates Haversine distance in meters between two coordinates.
 */
export function calculateHaversineDistanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371e3; // Earth radius in meters
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Generates an HMAC-signed QR token containing { bookingId, type, nonce, exp }.
 */
export function generateQrToken({ bookingId, type, nonce, exp, secret }) {
  const payload = {
    bookingId: bookingId.toString(),
    type,
    nonce,
    exp,
  };
  const payloadBase64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(payloadBase64).digest('base64url');
  return `${payloadBase64}.${signature}`;
}

/**
 * Verifies and parses an HMAC-signed QR token.
 */
export function verifyQrToken({ qrToken, secret }) {
  if (!qrToken || typeof qrToken !== 'string' || !qrToken.includes('.')) {
    throw new AppError(ERROR_CODES.QR_INVALID, 'Malformed QR token', 400);
  }

  const [payloadBase64, providedSig] = qrToken.split('.');
  const expectedSig = crypto.createHmac('sha256', secret).update(payloadBase64).digest('base64url');

  if (
    providedSig.length !== expectedSig.length ||
    !crypto.timingSafeEqual(Buffer.from(providedSig), Buffer.from(expectedSig))
  ) {
    throw new AppError(ERROR_CODES.QR_INVALID, 'QR token signature verification failed', 400);
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(payloadBase64, 'base64url').toString('utf8'));
  } catch {
    throw new AppError(ERROR_CODES.QR_INVALID, 'Failed to parse QR token payload', 400);
  }

  return payload;
}

/**
 * Issues a rotating QR code and single-use 6-digit fallback code.
 */
export async function issueHandoverQr({
  bookingId,
  type,
  userId,
  lat,
  lng,
  accuracyM,
  redisClient,
}) {
  const booking = await Booking.findById(bookingId);
  if (!booking) {
    throw new AppError(ERROR_CODES.BOOKING_NOT_FOUND, 'Booking not found', 404);
  }

  const isPickup = type === 'pickup';
  const expectedRole = isPickup ? 'lender' : 'borrower';
  const expectedStatus = isPickup ? 'accepted' : 'picked_up';

  const userRole =
    booking.lenderId.toString() === userId.toString()
      ? 'lender'
      : booking.borrowerId.toString() === userId.toString()
        ? 'borrower'
        : null;

  if (!userRole || userRole !== expectedRole) {
    throw new AppError(
      ERROR_CODES.FORBIDDEN,
      `Only the ${expectedRole} can generate the ${type} QR code`,
      403,
    );
  }

  if (booking.status !== expectedStatus) {
    throw new AppError(
      ERROR_CODES.INVALID_BOOKING_TRANSITION,
      `Booking must be in '${expectedStatus}' status to issue a ${type} QR code`,
      409,
    );
  }

  const nonce = crypto.randomBytes(16).toString('hex');
  const qrNonceHash = crypto.createHash('sha256').update(nonce).digest('hex');

  const now = new Date();
  const expiresInSeconds = BUSINESS_CONFIG.HANDOVER.QR_REFRESH_SECONDS;
  const qrExpiresAt = new Date(now.getTime() + expiresInSeconds * 1000);
  const expEpochSeconds = Math.floor(qrExpiresAt.getTime() / 1000);

  const qrToken = generateQrToken({
    bookingId: booking._id,
    type,
    nonce,
    exp: expEpochSeconds,
    secret: config.JWT_ACCESS_SECRET,
  });

  // Generate 6-digit fallback code
  const fallbackCode = crypto.randomInt(100000, 1000000).toString();
  const codeHmac = crypto
    .createHmac('sha256', config.JWT_ACCESS_SECRET)
    .update(fallbackCode + booking._id.toString())
    .digest('hex');

  // Upsert Handover record: new QR replaces previous nonce and resets single-use state
  await Handover.findOneAndUpdate(
    { bookingId: booking._id, type },
    {
      $set: {
        issuerId: userId,
        qrNonceHash,
        qrExpiresAt,
        qrConsumedAt: null,
        codeHmac,
        codeExpiresAt: qrExpiresAt,
        lockedUntil: null,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  // Cache issuer coordinates for proximity check (TTL 60s)
  if (lat !== undefined && lng !== undefined) {
    const geoPayload = JSON.stringify({
      lat: Number(lat),
      lng: Number(lng),
      accuracyM: Number(accuracyM) || 0,
    });
    await setHandoverGeo(redisClient, `handover:geo:${booking._id}:${type}`, geoPayload, 60);
  }

  return {
    qrToken,
    expiresAt: qrExpiresAt.toISOString(),
    fallbackCode,
    expiresInSeconds,
  };
}

/**
 * Scans and consumes a rotating QR code with single-use and proximity checks.
 */
export async function scanHandover({
  bookingId,
  type,
  qrToken,
  userId,
  lat,
  lng,
  accuracyM,
  redisClient,
  idempotency = null,
}) {
  const booking = await Booking.findById(bookingId);
  if (!booking) {
    throw new AppError(ERROR_CODES.BOOKING_NOT_FOUND, 'Booking not found', 404);
  }

  const isPickup = type === 'pickup';
  const expectedScannerRole = isPickup ? 'borrower' : 'lender';
  const expectedStatus = isPickup ? 'accepted' : 'picked_up';

  const userRole =
    booking.lenderId.toString() === userId.toString()
      ? 'lender'
      : booking.borrowerId.toString() === userId.toString()
        ? 'borrower'
        : null;

  if (!userRole || userRole !== expectedScannerRole) {
    throw new AppError(
      ERROR_CODES.FORBIDDEN,
      `Only the ${expectedScannerRole} can scan the ${type} QR code`,
      403,
    );
  }

  if (booking.status !== expectedStatus) {
    throw new AppError(
      ERROR_CODES.INVALID_BOOKING_TRANSITION,
      `Booking must be in '${expectedStatus}' status to scan ${type} QR`,
      409,
    );
  }

  // Verify token signature & expiry
  const payload = verifyQrToken({ qrToken, secret: config.JWT_ACCESS_SECRET });

  if (payload.type !== type) {
    throw new AppError(
      ERROR_CODES.QR_INVALID,
      `Token type mismatch: expected '${type}' token`,
      400,
    );
  }

  if (payload.bookingId !== booking._id.toString()) {
    throw new AppError(ERROR_CODES.QR_INVALID, 'Token was issued for a different booking', 400);
  }

  const nowMs = Date.now();
  if (payload.exp * 1000 <= nowMs) {
    throw new AppError(ERROR_CODES.QR_EXPIRED, 'QR token has expired', 400);
  }

  // Atomic consumption of QR nonce: guarantees single-use and exactly one winner
  const nonceHash = crypto.createHash('sha256').update(payload.nonce).digest('hex');
  const now = new Date();

  const consumed = await Handover.findOneAndUpdate(
    {
      bookingId: booking._id,
      type,
      qrNonceHash: nonceHash,
      qrConsumedAt: null,
      qrExpiresAt: { $gt: now },
    },
    {
      $set: { qrConsumedAt: now },
    },
    { new: true },
  );

  if (!consumed) {
    const existing = await Handover.findOne({
      bookingId: booking._id,
      type,
      qrNonceHash: nonceHash,
    });
    if (existing && existing.qrConsumedAt) {
      throw new AppError(ERROR_CODES.QR_ALREADY_USED, 'QR code has already been scanned', 409);
    }
    if (existing && existing.qrExpiresAt && existing.qrExpiresAt <= now) {
      throw new AppError(ERROR_CODES.QR_EXPIRED, 'QR code has expired', 400);
    }
    throw new AppError(ERROR_CODES.QR_INVALID, 'Invalid or superseded QR code', 400);
  }

  // Proximity check
  let distanceMeters = null;
  let geoChecked = false;

  let issuerGeo = null;
  const raw = await getHandoverGeo(redisClient, `handover:geo:${booking._id}:${type}`);
  if (raw) {
    try {
      issuerGeo = typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch {
      issuerGeo = null;
    }
  }

  if (issuerGeo && lat !== undefined && lng !== undefined) {
    const rawDistance = calculateHaversineDistanceMeters(
      issuerGeo.lat,
      issuerGeo.lng,
      Number(lat),
      Number(lng),
    );
    const slack = Math.min(
      BUSINESS_CONFIG.HANDOVER.MAX_ACCURACY_SLACK_METERS,
      (Number(issuerGeo.accuracyM) + (Number(accuracyM) || 0)) / 2,
    );
    distanceMeters = Math.max(0, rawDistance - slack);

    if (distanceMeters > BUSINESS_CONFIG.HANDOVER.MAX_DISTANCE_METERS) {
      throw new AppError(
        ERROR_CODES.HANDOVER_TOO_FAR,
        'Parties are too far apart for handover',
        400,
        { distanceMeters: Math.round(distanceMeters) },
      );
    }
    geoChecked = true;
  } else {
    // If GPS is unavailable, allow only the fallback code and set geoChecked: false
    throw new AppError(
      ERROR_CODES.HANDOVER_TOO_FAR,
      'GPS location required for QR scan. Please enable location permissions or use the 6-digit fallback code.',
      400,
    );
  }

  // State Transition & Record Update inside transaction
  return runInTransactionWithRetry(async (session) => {
    const b = await Booking.findById(booking._id).session(session);

    if (isPickup) {
      b.status = 'picked_up';
      b.pickupAt = now;
      b.statusHistory.push({
        fromStatus: 'accepted',
        toStatus: 'picked_up',
        actorId: userId,
        actorRole: 'borrower',
        reason: 'Pickup QR code successfully scanned',
        timestamp: now,
      });
      await b.save({ session });

      await Handover.findByIdAndUpdate(
        consumed._id,
        {
          $set: {
            scannerId: userId,
            scannedAt: now,
            distanceMeters: Math.round(distanceMeters),
            geoChecked: true,
            fallbackCodeUsed: false,
          },
        },
        { session },
      );

      await emitDomainEvent({
        type: 'booking.picked_up',
        bookingId: b._id,
        actorId: userId,
        payload: { pickupAt: now },
        session,
      });
    } else {
      // Return scan
      b.status = 'returned';
      b.returnAt = now;
      b.returnConfirmDeadline = new Date(
        now.getTime() + BUSINESS_CONFIG.RETURN_CONFIRMATION_WINDOW_SECONDS * 1000,
      );

      // Compute and freeze the final lateChargePaise from returnAt
      const { lateDays, lateChargePaise } = calculateLateCharge({
        effectiveTime: now,
        dueAt: b.dueAt,
        lateFeePerDayPaise: b.lateFeePerDayPaise,
        depositPaise: b.depositPaise,
      });

      if (lateChargePaise > 0) {
        b.lateChargePaise = lateChargePaise;
      }

      b.statusHistory.push({
        fromStatus: 'picked_up',
        toStatus: 'returned',
        actorId: userId,
        actorRole: 'lender',
        reason: `Return QR scanned (${lateDays} late days, ${lateChargePaise} paise fee)`,
        timestamp: now,
      });

      // Early return: release unused day locks after return date
      const returnDateStr = now.toISOString().slice(0, 10);
      await ItemDayLock.deleteMany({
        bookingId: b._id,
        day: { $gt: returnDateStr },
      }).session(session);

      await b.save({ session });

      await Handover.findByIdAndUpdate(
        consumed._id,
        {
          $set: {
            scannerId: userId,
            scannedAt: now,
            distanceMeters: Math.round(distanceMeters),
            geoChecked: true,
            fallbackCodeUsed: false,
          },
        },
        { session },
      );

      await emitDomainEvent({
        type: 'booking.returned',
        bookingId: b._id,
        actorId: userId,
        payload: { returnAt: now, lateChargePaise: b.lateChargePaise },
        session,
      });
    }

    const updatedHandover = await Handover.findById(consumed._id).session(session).lean();
    const responsePayload = {
      booking: b.toJSON(),
      handover: updatedHandover,
    };

    if (idempotency?.key) {
      await saveIdempotencyRecord({
        userId,
        key: idempotency.key,
        requestHash: idempotency.requestHash,
        statusCode: 200,
        responseBody: responsePayload,
        session,
      });
    }

    return responsePayload;
  });
}

/**
 * Verifies the 6-digit fallback code with max 3 attempts and 15-minute lockout.
 */
export async function verifyFallbackCode({ bookingId, type, code, userId, idempotency = null }) {
  const booking = await Booking.findById(bookingId);
  if (!booking) {
    throw new AppError(ERROR_CODES.BOOKING_NOT_FOUND, 'Booking not found', 404);
  }

  const isPickup = type === 'pickup';
  const expectedScannerRole = isPickup ? 'borrower' : 'lender';
  const expectedStatus = isPickup ? 'accepted' : 'picked_up';

  const userRole =
    booking.lenderId.toString() === userId.toString()
      ? 'lender'
      : booking.borrowerId.toString() === userId.toString()
        ? 'borrower'
        : null;

  if (!userRole || userRole !== expectedScannerRole) {
    throw new AppError(
      ERROR_CODES.FORBIDDEN,
      `Only the ${expectedScannerRole} can enter the fallback code`,
      403,
    );
  }

  if (booking.status !== expectedStatus) {
    throw new AppError(
      ERROR_CODES.INVALID_BOOKING_TRANSITION,
      `Booking must be in '${expectedStatus}' status for fallback code`,
      409,
    );
  }

  const handover = await Handover.findOne({ bookingId: booking._id, type });
  if (!handover || !handover.codeHmac) {
    throw new AppError(ERROR_CODES.HANDOVER_CODE_INVALID, 'No active fallback code found', 400);
  }

  const now = new Date();

  // Check lockout
  if (handover.lockedUntil && handover.lockedUntil > now) {
    throw new AppError(
      ERROR_CODES.HANDOVER_LOCKED,
      'Handover code entry is locked due to multiple failed attempts. Please wait 15 minutes.',
      403,
      { lockedUntil: handover.lockedUntil },
    );
  }

  // Check expiry
  if (!handover.codeExpiresAt || handover.codeExpiresAt <= now) {
    throw new AppError(
      ERROR_CODES.QR_EXPIRED,
      'Fallback code has expired. Please ask the other party to refresh the QR code.',
      400,
    );
  }

  // Check code match using HMAC
  const expectedHmac = crypto
    .createHmac('sha256', config.JWT_ACCESS_SECRET)
    .update(String(code).trim() + booking._id.toString())
    .digest('hex');

  const matches = crypto.timingSafeEqual(Buffer.from(expectedHmac), Buffer.from(handover.codeHmac));

  if (!matches) {
    // Increment failure attempt counter atomically OUTSIDE transaction
    const updated = await Handover.findByIdAndUpdate(
      handover._id,
      { $inc: { codeAttempts: 1 } },
      { new: true },
    );

    if (updated.codeAttempts >= BUSINESS_CONFIG.QR_FALLBACK_MAX_ATTEMPTS) {
      const lockedUntil = new Date(
        now.getTime() + BUSINESS_CONFIG.HANDOVER.FALLBACK_LOCKOUT_MINUTES * 60 * 1000,
      );
      await Handover.findByIdAndUpdate(handover._id, { $set: { lockedUntil } });
      throw new AppError(
        ERROR_CODES.HANDOVER_LOCKED,
        'Too many failed attempts. Handover code locked for 15 minutes.',
        403,
        { lockedUntil },
      );
    }

    throw new AppError(ERROR_CODES.HANDOVER_CODE_INVALID, 'Invalid fallback code', 400, {
      attemptsRemaining: BUSINESS_CONFIG.QR_FALLBACK_MAX_ATTEMPTS - updated.codeAttempts,
    });
  }

  // Code is valid: execute transition inside transaction
  return runInTransactionWithRetry(async (session) => {
    const b = await Booking.findById(booking._id).session(session);

    if (isPickup) {
      b.status = 'picked_up';
      b.pickupAt = now;
      b.statusHistory.push({
        fromStatus: 'accepted',
        toStatus: 'picked_up',
        actorId: userId,
        actorRole: 'borrower',
        reason: 'Pickup 6-digit fallback code verified',
        timestamp: now,
      });
      await b.save({ session });

      await Handover.findByIdAndUpdate(
        handover._id,
        {
          $set: {
            scannerId: userId,
            scannedAt: now,
            distanceMeters: null,
            geoChecked: false,
            fallbackCodeUsed: true,
            codeAttempts: 0,
            lockedUntil: null,
            codeHmac: null, // single use
          },
        },
        { session },
      );

      await emitDomainEvent({
        type: 'booking.picked_up',
        bookingId: b._id,
        actorId: userId,
        payload: { pickupAt: now, fallbackCodeUsed: true },
        session,
      });
    } else {
      b.status = 'returned';
      b.returnAt = now;
      b.returnConfirmDeadline = new Date(
        now.getTime() + BUSINESS_CONFIG.RETURN_CONFIRMATION_WINDOW_SECONDS * 1000,
      );

      const { lateDays, lateChargePaise } = calculateLateCharge({
        effectiveTime: now,
        dueAt: b.dueAt,
        lateFeePerDayPaise: b.lateFeePerDayPaise,
        depositPaise: b.depositPaise,
      });

      if (lateChargePaise > 0) {
        b.lateChargePaise = lateChargePaise;
      }

      b.statusHistory.push({
        fromStatus: 'picked_up',
        toStatus: 'returned',
        actorId: userId,
        actorRole: 'lender',
        reason: `Return fallback code verified (${lateDays} late days)`,
        timestamp: now,
      });

      const returnDateStr = now.toISOString().slice(0, 10);
      await ItemDayLock.deleteMany({
        bookingId: b._id,
        day: { $gt: returnDateStr },
      }).session(session);

      await b.save({ session });

      await Handover.findByIdAndUpdate(
        handover._id,
        {
          $set: {
            scannerId: userId,
            scannedAt: now,
            distanceMeters: null,
            geoChecked: false,
            fallbackCodeUsed: true,
            codeAttempts: 0,
            lockedUntil: null,
            codeHmac: null,
          },
        },
        { session },
      );

      await emitDomainEvent({
        type: 'booking.returned',
        bookingId: b._id,
        actorId: userId,
        payload: { returnAt: now, fallbackCodeUsed: true },
        session,
      });
    }

    const updatedHandover = await Handover.findById(handover._id).session(session).lean();
    const responsePayload = {
      booking: b.toJSON(),
      handover: updatedHandover,
      fallbackCodeUsed: true,
    };

    if (idempotency?.key) {
      await saveIdempotencyRecord({
        userId,
        key: idempotency.key,
        requestHash: idempotency.requestHash,
        statusCode: 200,
        responseBody: responsePayload,
        session,
      });
    }

    return responsePayload;
  });
}

/**
 * Registers condition photos taken during pickup or return.
 */
export async function registerConditionPhotos({ bookingId, stage, photos, userId }) {
  const booking = await Booking.findById(bookingId);
  if (!booking) {
    throw new AppError(ERROR_CODES.BOOKING_NOT_FOUND, 'Booking not found', 404);
  }

  const borrowerIdStr = (booking.borrowerId?._id || booking.borrowerId).toString();
  const lenderIdStr = (booking.lenderId?._id || booking.lenderId).toString();
  const userIdStr = userId.toString();

  if (userIdStr !== borrowerIdStr && userIdStr !== lenderIdStr) {
    throw new AppError(
      ERROR_CODES.FORBIDDEN,
      'Only booking participants can upload condition photos',
      403,
    );
  }

  // Stage matches booking status:
  // Pickup photos allowed when accepted or picked_up
  // Return photos allowed when picked_up or returned
  if (stage === 'pickup' && !['accepted', 'picked_up'].includes(booking.status)) {
    throw new AppError(
      ERROR_CODES.INVALID_BOOKING_TRANSITION,
      'Pickup photos can only be uploaded when booking is accepted or picked_up',
      409,
    );
  }

  if (stage === 'return' && !['picked_up', 'returned'].includes(booking.status)) {
    throw new AppError(
      ERROR_CODES.INVALID_BOOKING_TRANSITION,
      'Return photos can only be uploaded when booking is picked_up or returned',
      409,
    );
  }

  // Verify publicId folder restriction
  const expectedFolderPrefix = `${BUSINESS_CONFIG.UPLOAD_FOLDERS.HANDOVER}/${booking._id}/${stage}`;
  for (const photo of photos) {
    if (!photo.publicId || !photo.publicId.startsWith(expectedFolderPrefix)) {
      throw new AppError(
        ERROR_CODES.BAD_REQUEST,
        `Photo publicId must be located inside folder '${expectedFolderPrefix}'`,
        400,
      );
    }
  }

  // Find or create Handover record
  let handover = await Handover.findOne({ bookingId: booking._id, type: stage });
  if (!handover) {
    handover = new Handover({
      bookingId: booking._id,
      type: stage,
      issuerId: booking.lenderId,
    });
  }

  // Registration window check: within PHOTO_WINDOW_MINUTES after scannedAt
  const now = new Date();
  if (handover.scannedAt) {
    const elapsedMs = now.getTime() - handover.scannedAt.getTime();
    if (elapsedMs > BUSINESS_CONFIG.HANDOVER.PHOTO_WINDOW_MINUTES * 60 * 1000) {
      throw new AppError(
        ERROR_CODES.HANDOVER_PHOTO_WINDOW_CLOSED,
        'Condition photo upload window has closed (30 minutes after scan)',
        400,
      );
    }
  }

  // Max photos per party per stage
  const existingPartyPhotos = handover.photos.filter((p) => p.by.toString() === userIdStr);
  if (existingPartyPhotos.length + photos.length > BUSINESS_CONFIG.MAX_HANDOVER_PHOTOS) {
    throw new AppError(
      ERROR_CODES.HANDOVER_PHOTO_LIMIT,
      `Cannot exceed maximum ${BUSINESS_CONFIG.MAX_HANDOVER_PHOTOS} photos per party`,
      400,
    );
  }

  for (const photo of photos) {
    handover.photos.push({
      by: userId,
      publicId: photo.publicId,
      url: photo.url,
      capturedAt: now,
    });
  }

  await handover.save();

  return {
    photos: handover.photos.filter((p) => p.by.toString() === userIdStr),
  };
}

/**
 * Returns recorded handovers for a booking.
 */
export async function getBookingHandovers({ bookingId, userId }) {
  const booking = await Booking.findById(bookingId).lean();
  if (!booking) {
    throw new AppError(ERROR_CODES.BOOKING_NOT_FOUND, 'Booking not found', 404);
  }

  const borrowerIdStr = (booking.borrowerId?._id || booking.borrowerId).toString();
  const lenderIdStr = (booking.lenderId?._id || booking.lenderId).toString();
  const userIdStr = userId.toString();

  if (userIdStr !== borrowerIdStr && userIdStr !== lenderIdStr) {
    throw new AppError(ERROR_CODES.FORBIDDEN, 'Only booking participants may view handovers', 403);
  }

  const handovers = await Handover.find({ bookingId: booking._id }).lean();
  return { handovers };
}
