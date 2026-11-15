/**
 * @file apps/worker/src/jobs/disputeLifecycleJobs.js
 * Background jobs for dispute escalation and auto-closing past the appeal window.
 */

import { Dispute, emitDomainEvent, runWithRedisLock } from '@borrowloop/server-core';
import { BUSINESS_CONFIG } from '@borrowloop/shared';
import logger from '../logger.js';

const { DISPUTES } = BUSINESS_CONFIG;

/**
 * Automatically closes disputes in 'decided' status whose 7-day appeal window has elapsed.
 *
 * @param {object} options
 * @param {Date} [options.now=new Date()]
 * @param {import('ioredis').Redis} [options.redisClient=null]
 * @returns {Promise<{ closedCount: number }>}
 */
export async function closeDisputesJob({ now = new Date(), redisClient = null } = {}) {
  const runner = async () => {
    const appealWindowMs = (DISPUTES.APPEAL_WINDOW_DAYS || 7) * 86400 * 1000;
    const thresholdDate = new Date(now.getTime() - appealWindowMs);

    const expiredDisputes = await Dispute.find({
      status: 'decided',
      'decision.decidedAt': { $lte: thresholdDate },
    });

    let closedCount = 0;

    for (const dispute of expiredDisputes) {
      try {
        dispute.status = 'closed';
        dispute.closedAt = now;
        dispute.statusHistory.push({
          status: 'closed',
          changedBy: null,
          note: `Automatically closed after ${DISPUTES.APPEAL_WINDOW_DAYS || 7}-day appeal window elapsed`,
          changedAt: now,
        });
        await dispute.save();

        await emitDomainEvent({
          type: 'dispute.closed',
          bookingId: dispute.bookingId,
          actorId: null,
          eventKey: `dispute_closed_${dispute._id}`,
          payload: {
            disputeId: dispute._id,
            reason: 'appeal_window_elapsed',
          },
        });

        closedCount++;
      } catch (err) {
        logger.error({ err: err.message, disputeId: dispute._id }, 'Failed to auto-close dispute');
      }
    }

    logger.info({ closedCount }, 'Completed closeDisputesJob');
    return { closedCount };
  };

  if (redisClient) {
    return runWithRedisLock(redisClient, 'job:close_disputes', runner, 30000);
  }
  return runner();
}

/**
 * Escalates disputes that have remained unassigned in 'opened' status for > 24 hours.
 *
 * @param {object} options
 * @param {Date} [options.now=new Date()]
 * @param {import('ioredis').Redis} [options.redisClient=null]
 * @returns {Promise<{ escalatedCount: number }>}
 */
export async function escalateDisputesJob({ now = new Date(), redisClient = null } = {}) {
  const runner = async () => {
    const escalateMs = (DISPUTES.UNASSIGNED_ESCALATE_HOURS || 24) * 3600 * 1000;
    const thresholdDate = new Date(now.getTime() - escalateMs);

    const unassignedDisputes = await Dispute.find({
      status: 'opened',
      assignedAgentId: null,
      createdAt: { $lte: thresholdDate },
      isEscalated: { $ne: true },
    });

    let escalatedCount = 0;

    for (const dispute of unassignedDisputes) {
      try {
        dispute.isEscalated = true;
        dispute.escalatedAt = now;
        dispute.statusHistory.push({
          status: 'opened',
          changedBy: null,
          note: 'Escalated: unassigned for 24+ hours',
          changedAt: now,
        });
        await dispute.save();

        await emitDomainEvent({
          type: 'dispute.escalated',
          bookingId: dispute.bookingId,
          actorId: null,
          eventKey: `dispute_escalated_${dispute._id}`,
          payload: {
            disputeId: dispute._id,
            hoursUnassigned: DISPUTES.UNASSIGNED_ESCALATE_HOURS || 24,
          },
        });

        escalatedCount++;
      } catch (err) {
        logger.error({ err: err.message, disputeId: dispute._id }, 'Failed to escalate dispute');
      }
    }

    logger.info({ escalatedCount }, 'Completed escalateDisputesJob');
    return { escalatedCount };
  };

  if (redisClient) {
    return runWithRedisLock(redisClient, 'job:escalate_disputes', runner, 30000);
  }
  return runner();
}
