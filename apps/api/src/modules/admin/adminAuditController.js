/**
 * @file apps/api/src/modules/admin/adminAuditController.js
 * Controller for inspecting immutable system-wide audit logs.
 */

import mongoose from 'mongoose';
import { AuditLog } from '@borrowloop/server-core';

/**
 * Masks sensitive fields (emails, password references, coordinates).
 */
function maskEmail(email) {
  if (!email || typeof email !== 'string') return '';
  const parts = email.split('@');
  if (parts.length !== 2) return '***';
  const [local, domain] = parts;
  const maskedLocal =
    local.length <= 1 ? `${local}***` : `${local[0]}***${local[local.length - 1]}`;
  const domainParts = domain.split('.');
  if (domainParts.length >= 2) {
    const mainDomain = domainParts[0];
    const tld = domainParts.slice(1).join('.');
    const maskedDomain = mainDomain.length <= 1 ? `${mainDomain}***` : `${mainDomain[0]}***`;
    return `${maskedLocal}@${maskedDomain}.${tld}`;
  }
  return `${maskedLocal}@***`;
}

function sanitizeAuditPayload(data) {
  if (!data || typeof data !== 'object') return data;
  if (Array.isArray(data)) return data.map(sanitizeAuditPayload);

  const sanitized = {};
  for (const [key, value] of Object.entries(data)) {
    const lowerKey = key.toLowerCase();
    // Exclude security secrets or GPS coordinates completely
    if (
      lowerKey.includes('password') ||
      lowerKey.includes('totp') ||
      lowerKey.includes('secret') ||
      lowerKey.includes('token') ||
      lowerKey.includes('coordinates') ||
      lowerKey === 'location'
    ) {
      continue;
    }
    // Exclude chat message text
    if (lowerKey === 'text' || lowerKey === 'content' || lowerKey === 'body_text') {
      continue;
    }
    // Mask emails
    if (lowerKey.includes('email') && typeof value === 'string') {
      sanitized[key] = maskEmail(value);
    } else if (typeof value === 'object' && value !== null) {
      sanitized[key] = sanitizeAuditPayload(value);
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

export async function getAuditLogs(req, res, next) {
  try {
    const { actorId, action, targetType, from, to, limit = 20, cursor } = req.query;

    const query = {};

    if (actorId && mongoose.Types.ObjectId.isValid(actorId)) {
      query.actorId = new mongoose.Types.ObjectId(actorId);
    }
    if (action) {
      query.action = action;
    }
    if (targetType) {
      query.targetType = targetType;
    }

    if (from || to) {
      query.createdAt = {};
      if (from) query.createdAt.$gte = new Date(from);
      if (to) query.createdAt.$lte = new Date(to);
    }

    if (cursor && mongoose.Types.ObjectId.isValid(cursor)) {
      query._id = { $lt: new mongoose.Types.ObjectId(cursor) };
    }

    const pageSize = Math.min(Number(limit) || 20, 50);

    const logs = await AuditLog.find(query)
      .sort({ _id: -1 })
      .limit(pageSize + 1)
      .lean();

    const hasMore = logs.length > pageSize;
    const items = hasMore ? logs.slice(0, pageSize) : logs;
    const nextCursor = hasMore ? items[items.length - 1]._id.toString() : null;

    const sanitizedLogs = items.map((log) => ({
      _id: log._id,
      actorId: log.actorId,
      actorRole: log.actorRole,
      action: log.action,
      targetType: log.targetType,
      targetId: log.targetId,
      before: sanitizeAuditPayload(log.before),
      after: sanitizeAuditPayload(log.after),
      ip: log.ip,
      createdAt: log.createdAt,
    }));

    return res.json({
      auditLogs: sanitizedLogs,
      nextCursor,
    });
  } catch (error) {
    next(error);
  }
}

export default {
  getAuditLogs,
};
