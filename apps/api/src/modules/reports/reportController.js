/**
 * @file apps/api/src/modules/reports/reportController.js
 * Controller endpoints for user reporting and staff care moderation.
 */

import * as reportService from './reportService.js';

export async function createReport(req, res, next) {
  try {
    const { targetType, targetId, reason, details } = req.body;

    const report = await reportService.createReport({
      targetType,
      targetId,
      reason,
      details,
      userId: req.user._id,
    });

    res.status(201).json({ report });
  } catch (err) {
    next(err);
  }
}

export async function listReports(req, res, next) {
  try {
    const { status, targetType, cursor, limit } = req.query;

    const result = await reportService.listReports({
      status,
      targetType,
      cursor,
      limit,
    });

    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

export async function takeCareAction(req, res, next) {
  try {
    const { id } = req.params;
    const { action, notes, note } = req.body;

    const result = await reportService.takeCareReportAction({
      reportId: id,
      action,
      notes: notes || note || '',
      staffUser: req.user,
      ip: req.ip,
    });

    res.status(200).json({ report: result });
  } catch (err) {
    next(err);
  }
}

export async function getUserLookup(req, res, next) {
  try {
    const { id } = req.params;

    const result = await reportService.getCareUserLookup({
      userId: id,
      staffUser: req.user,
      ip: req.ip,
    });

    res.status(200).json({ user: result });
  } catch (err) {
    next(err);
  }
}
