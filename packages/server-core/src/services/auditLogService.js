/**
 * @file packages/server-core/src/services/auditLogService.js
 * Fail-closed transaction-aware audit log writer.
 * Unlike non-critical fire-and-forget logging, writeAuditLogTx throws if the
 * audit write fails, guaranteeing the enclosing transaction safely rolls back.
 */

import AuditLog from '../models/AuditLog.js';

/**
 * Writes an append-only AuditLog record inside a MongoDB transaction.
 * Throws on failure to ensure caller transaction fails closed.
 *
 * @param {object} entry
 * @param {import('mongoose').Types.ObjectId | string} entry.actorId
 * @param {string} entry.actorRole
 * @param {string} entry.action
 * @param {string} entry.targetType
 * @param {import('mongoose').Types.ObjectId | string} entry.targetId
 * @param {object | null} [entry.before]
 * @param {object | null} [entry.after]
 * @param {string} [entry.ip]
 * @param {object} [options]
 * @param {import('mongoose').ClientSession | null} [options.session]
 * @returns {Promise<import('../models/AuditLog.js').default>}
 */
export async function writeAuditLogTx(entry, { session = null } = {}) {
  const [created] = await AuditLog.create([entry], { session });
  return created;
}

export default {
  writeAuditLogTx,
};
