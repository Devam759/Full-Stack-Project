/**
 * @file apps/api/src/modules/bookings/bookingController.js
 * Express route handlers for the booking lifecycle API.
 */

import * as bookingService from './bookingService.js';

export async function createBooking(req, res, next) {
  try {
    const result = await bookingService.createBookingRequest({
      borrowerId: req.user.id,
      itemId: req.body.itemId,
      startDate: req.body.startDate,
      endDate: req.body.endDate,
      idempotency: req.idempotency,
    });
    if (result?._isReplay) {
      res.setHeader('X-Idempotent-Replay', 'true');
    }
    const responseBody = { ...result };
    delete responseBody._isReplay;
    delete responseBody._statusCode;
    return res.status(result?._statusCode || 201).json(responseBody);
  } catch (err) {
    next(err);
  }
}

export async function getBooking(req, res, next) {
  try {
    const booking = await bookingService.getBookingById({
      bookingId: req.params.id,
      userId: req.user.id,
      userRole: req.user.role,
    });
    return res.json({
      success: true,
      booking,
    });
  } catch (err) {
    next(err);
  }
}

export async function listBookings(req, res, next) {
  try {
    const { role, status, cursor, limit } = req.query;
    const result = await bookingService.listBookings({
      userId: req.user.id,
      role,
      status,
      cursor,
      limit,
    });
    return res.json({
      success: true,
      ...result,
    });
  } catch (err) {
    next(err);
  }
}

export async function acceptBooking(req, res, next) {
  try {
    const result = await bookingService.acceptBooking({
      bookingId: req.params.id,
      lenderId: req.user.id,
      idempotency: req.idempotency,
    });
    if (result?._isReplay) {
      res.setHeader('X-Idempotent-Replay', 'true');
    }
    const responseBody = { ...result };
    delete responseBody._isReplay;
    delete responseBody._statusCode;
    return res.status(result?._statusCode || 200).json(responseBody);
  } catch (err) {
    next(err);
  }
}

export async function rejectBooking(req, res, next) {
  try {
    const result = await bookingService.rejectBooking({
      bookingId: req.params.id,
      lenderId: req.user.id,
      reason: req.body.reason,
      idempotency: req.idempotency,
    });
    if (result?._isReplay) {
      res.setHeader('X-Idempotent-Replay', 'true');
    }
    const responseBody = { ...result };
    delete responseBody._isReplay;
    delete responseBody._statusCode;
    return res.status(result?._statusCode || 200).json(responseBody);
  } catch (err) {
    next(err);
  }
}

export async function cancelBooking(req, res, next) {
  try {
    const result = await bookingService.cancelBooking({
      bookingId: req.params.id,
      userId: req.user.id,
      reason: req.body.reason,
      idempotency: req.idempotency,
    });
    if (result?._isReplay) {
      res.setHeader('X-Idempotent-Replay', 'true');
    }
    const responseBody = { ...result };
    delete responseBody._isReplay;
    delete responseBody._statusCode;
    return res.status(result?._statusCode || 200).json(responseBody);
  } catch (err) {
    next(err);
  }
}

export async function requestExtension(req, res, next) {
  try {
    const result = await bookingService.requestExtension({
      bookingId: req.params.id,
      borrowerId: req.user.id,
      newEndDate: req.body.newEndDate || req.body.requestedEndDate,
      idempotency: req.idempotency,
    });
    if (result?._isReplay) {
      res.setHeader('X-Idempotent-Replay', 'true');
    }
    const responseBody = { ...result };
    delete responseBody._isReplay;
    delete responseBody._statusCode;
    return res.status(result?._statusCode || 201).json(responseBody);
  } catch (err) {
    next(err);
  }
}

export async function acceptExtension(req, res, next) {
  try {
    const result = await bookingService.acceptExtension({
      bookingId: req.params.id,
      lenderId: req.user.id,
      idempotency: req.idempotency,
    });
    if (result?._isReplay) {
      res.setHeader('X-Idempotent-Replay', 'true');
    }
    const responseBody = { ...result };
    delete responseBody._isReplay;
    delete responseBody._statusCode;
    return res.status(result?._statusCode || 200).json(responseBody);
  } catch (err) {
    next(err);
  }
}

export async function rejectExtension(req, res, next) {
  try {
    const result = await bookingService.rejectExtension({
      bookingId: req.params.id,
      lenderId: req.user.id,
      reason: req.body.reason,
      idempotency: req.idempotency,
    });
    if (result?._isReplay) {
      res.setHeader('X-Idempotent-Replay', 'true');
    }
    const responseBody = { ...result };
    delete responseBody._isReplay;
    delete responseBody._statusCode;
    return res.status(result?._statusCode || 200).json(responseBody);
  } catch (err) {
    next(err);
  }
}
