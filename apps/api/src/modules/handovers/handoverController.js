/**
 * @file apps/api/src/modules/handovers/handoverController.js
 * Express controller handlers for handover QR, scan, code fallback, and photo registration.
 */

import { getRedisClient } from '../../redis.js';
import * as handoverService from './handoverService.js';

export async function issuePickupQr(req, res, next) {
  try {
    const { id } = req.params;
    const { lat, lng, accuracyM } = req.body || {};
    const redisClient = getRedisClient();

    const result = await handoverService.issueHandoverQr({
      bookingId: id,
      type: 'pickup',
      userId: req.user._id,
      lat,
      lng,
      accuracyM,
      redisClient,
    });

    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

export async function scanPickupQr(req, res, next) {
  try {
    const { id } = req.params;
    const { qrToken, lat, lng, accuracyM } = req.body;
    const redisClient = getRedisClient();

    const result = await handoverService.scanHandover({
      bookingId: id,
      type: 'pickup',
      qrToken,
      userId: req.user._id,
      lat,
      lng,
      accuracyM,
      redisClient,
      idempotency: req.idempotency,
    });

    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

export async function verifyPickupCode(req, res, next) {
  try {
    const { id } = req.params;
    const { code } = req.body;

    const result = await handoverService.verifyFallbackCode({
      bookingId: id,
      type: 'pickup',
      code,
      userId: req.user._id,
      idempotency: req.idempotency,
    });

    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

export async function issueReturnQr(req, res, next) {
  try {
    const { id } = req.params;
    const { lat, lng, accuracyM } = req.body || {};
    const redisClient = getRedisClient();

    const result = await handoverService.issueHandoverQr({
      bookingId: id,
      type: 'return',
      userId: req.user._id,
      lat,
      lng,
      accuracyM,
      redisClient,
    });

    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

export async function scanReturnQr(req, res, next) {
  try {
    const { id } = req.params;
    const { qrToken, lat, lng, accuracyM } = req.body;
    const redisClient = getRedisClient();

    const result = await handoverService.scanHandover({
      bookingId: id,
      type: 'return',
      qrToken,
      userId: req.user._id,
      lat,
      lng,
      accuracyM,
      redisClient,
      idempotency: req.idempotency,
    });

    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

export async function verifyReturnCode(req, res, next) {
  try {
    const { id } = req.params;
    const { code } = req.body;

    const result = await handoverService.verifyFallbackCode({
      bookingId: id,
      type: 'return',
      code,
      userId: req.user._id,
      idempotency: req.idempotency,
    });

    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

export async function registerPhotos(req, res, next) {
  try {
    const { id } = req.params;
    const { stage, photos } = req.body;

    const result = await handoverService.registerConditionPhotos({
      bookingId: id,
      stage,
      photos,
      userId: req.user._id,
    });

    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

export async function getHandovers(req, res, next) {
  try {
    const { id } = req.params;

    const result = await handoverService.getBookingHandovers({
      bookingId: id,
      userId: req.user._id,
    });

    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}
