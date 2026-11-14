/**
 * @file apps/api/src/modules/ratings/ratingController.js
 * Express controller handlers for submitting and querying blind ratings.
 */

import { ratingService } from '@borrowloop/server-core';

export async function createRating(req, res, next) {
  try {
    const { id } = req.params;
    const { stars, comment } = req.body;

    const result = await ratingService.submitRating({
      bookingId: id,
      stars,
      comment,
      userId: req.user._id,
      idempotency: req.idempotency,
    });

    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}

export async function getBookingRatings(req, res, next) {
  try {
    const { id } = req.params;

    const result = await ratingService.getBookingRatings({
      bookingId: id,
      userId: req.user._id,
    });

    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

export async function getUserRatings(req, res, next) {
  try {
    const { id } = req.params;
    const { cursor, before, limit } = req.query;

    const result = await ratingService.getUserRatings({
      userId: id,
      callerId: req.user?._id || null,
      before: cursor || before || null,
      limit,
    });

    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

export default {
  createRating,
  getBookingRatings,
  getUserRatings,
};
