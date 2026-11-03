import AuditLog from '../models/AuditLog.js';
import logger from './logger.js';

/**
 * Writes an append-only audit log entry for administrative or security-sensitive actions.
 *
 * @param {object} params
 * @param {string} params.actorId
 * @param {string} params.actorRole
 * @param {string} params.action - e.g. 'COMMUNITY_SUSPEND', 'COMMUNITY_RESTORE'
 * @param {string} params.targetType - e.g. 'community', 'user'
 * @param {string} params.targetId
 * @param {Record<string, unknown>} [params.before]
 * @param {Record<string, unknown>} [params.after]
 * @param {string} [params.ip='unknown']
 */
export async function writeAuditLog({
  actorId,
  actorRole,
  action,
  targetType,
  targetId,
  before = null,
  after = null,
  ip = 'unknown',
}) {
  try {
    const entry = await AuditLog.create({
      actorId,
      actorRole,
      action,
      targetType,
      targetId,
      before,
      after,
      ip,
    });
    return entry;
  } catch (err) {
    logger.error(
      { err: err.message, action, targetType, targetId },
      'Failed to write audit log entry',
    );
  }
}

export default writeAuditLog;
