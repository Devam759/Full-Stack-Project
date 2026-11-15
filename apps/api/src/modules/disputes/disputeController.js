/**
 * @file apps/api/src/modules/disputes/disputeController.js
 * Controller endpoints for disputes.
 */

import {
  openDispute as svcOpenDispute,
  addEvidence as svcAddEvidence,
  getDisputeById as svcGetDisputeById,
  getDisputeByBookingId as svcGetDisputeByBookingId,
  appealDispute as svcAppealDispute,
} from './disputeService.js';

export async function openDispute(req, res, next) {
  try {
    const { id } = req.params;
    const { reason, details, photos } = req.body;

    const result = await svcOpenDispute({
      bookingId: id,
      reason,
      details,
      photos,
      userId: req.user._id,
      userRole: req.user.role,
      idempotency: req.idempotency,
    });

    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}

export async function addEvidence(req, res, next) {
  try {
    const { id } = req.params;
    const { notes, photos } = req.body;

    const result = await svcAddEvidence({
      disputeId: id,
      notes,
      photos,
      userId: req.user._id,
      userRole: req.user.role,
    });

    res.status(200).json({ dispute: result });
  } catch (err) {
    next(err);
  }
}

export async function getDispute(req, res, next) {
  try {
    const { id } = req.params;

    const result = await svcGetDisputeById({
      disputeId: id,
      userId: req.user._id,
      userRole: req.user.role,
    });

    res.status(200).json({ dispute: result });
  } catch (err) {
    next(err);
  }
}

export async function getBookingDispute(req, res, next) {
  try {
    const { id } = req.params;

    const result = await svcGetDisputeByBookingId({
      bookingId: id,
      userId: req.user._id,
      userRole: req.user.role,
    });

    res.status(200).json({ dispute: result });
  } catch (err) {
    next(err);
  }
}

export async function appealDispute(req, res, next) {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    const result = await svcAppealDispute({
      disputeId: id,
      reason,
      userId: req.user._id,
    });

    res.status(200).json({ dispute: result });
  } catch (err) {
    next(err);
  }
}
