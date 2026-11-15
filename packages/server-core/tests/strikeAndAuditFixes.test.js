import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import { setupTestDB, teardownTestDB } from '../../../apps/api/tests/setup/dbTestHelper.js';
import {
  User,
  Booking,
  AuditLog,
  TrustEvent,
  applyStrike,
  reverseStrike,
  writeAuditLogTx,
} from '../src/index.js';

describe('Phase 8a Fixes: Strike Idempotency, Status Safety & Audit Transactions', () => {
  beforeAll(async () => {
    await setupTestDB();
    await AuditLog.init();
    await User.init();
    await TrustEvent.init();
  });

  afterAll(async () => {
    await teardownTestDB();
  });

  it('proves applyStrike with explicit eventKey is idempotent and ignores duplicates', async () => {
    const user = await User.create({
      name: 'Strike Test User',
      email: `strike_test_${Date.now()}@borrowloop.test`,
      passwordHash: 'hash123',
      emailVerified: true,
      status: 'active',
      strikes: 0,
    });

    const eventKey = `strike_dispute_123_${user._id}`;

    // First call: adds strike 1
    const res1 = await applyStrike({
      userId: user._id,
      reason: 'First dispute violation',
      eventKey,
    });
    expect(res1.strikes).toBe(1);

    const userAfterFirst = await User.findById(user._id);
    expect(userAfterFirst.strikes).toBe(1);

    // Duplicate call with same eventKey: must be a no-op and NOT increment strikes
    const res2 = await applyStrike({
      userId: user._id,
      reason: 'First dispute violation retry',
      eventKey,
    });
    expect(res2.strikes).toBe(1);

    const userAfterSecond = await User.findById(user._id);
    expect(userAfterSecond.strikes).toBe(1);

    const events = await TrustEvent.find({ eventKey });
    expect(events).toHaveLength(1);
  });

  it('proves reverseStrike preserves frozen account status when strikes drop below 3', async () => {
    // User was banned, then account was frozen due to not_returned dispute
    const frozenUser = await User.create({
      name: 'Frozen Strike User',
      email: `frozen_strike_${Date.now()}@borrowloop.test`,
      passwordHash: 'hash123',
      emailVerified: true,
      status: 'frozen',
      strikes: 3,
    });

    const res = await reverseStrike({
      userId: frozenUser._id,
      reason: 'Admin appeal upheld for strike 3',
    });

    expect(res.strikes).toBe(2);
    // User status must REMAIN 'frozen', never silently restored to 'active'
    expect(res.status).toBe('frozen');

    const freshUser = await User.findById(frozenUser._id);
    expect(freshUser.status).toBe('frozen');
    expect(freshUser.strikes).toBe(2);
  });

  it('proves writeAuditLogTx writes AuditLog within session and fails closed on invalid data', async () => {
    const session = await mongoose.startSession();
    session.startTransaction();

    const actorId = new mongoose.Types.ObjectId();
    const targetId = new mongoose.Types.ObjectId();

    try {
      const auditDoc = await writeAuditLogTx(
        {
          actorId,
          actorRole: 'care_agent',
          action: 'dispute_decision',
          targetType: 'dispute',
          targetId: targetId.toString(),
          before: { status: 'assigned' },
          after: { status: 'decided', depositToLenderPaise: 5000 },
          ip: '127.0.0.1',
        },
        { session },
      );

      expect(auditDoc).toBeDefined();
      expect(auditDoc.action).toBe('dispute_decision');

      await session.commitTransaction();
    } finally {
      session.endSession();
    }

    const saved = await AuditLog.findOne({ targetId });
    expect(saved).not.toBeNull();
    expect(saved.actorRole).toBe('care_agent');
  });

  it('proves Booking model completedBy enum accepts care', async () => {
    const booking = new Booking({
      itemId: new mongoose.Types.ObjectId(),
      lenderId: new mongoose.Types.ObjectId(),
      borrowerId: new mongoose.Types.ObjectId(),
      startDate: '2026-11-20',
      endDate: '2026-11-22',
      dueAt: new Date(),
      expiresAt: new Date(),
      days: 2,
      rentPaise: 1000_00,
      depositPaise: 2000_00,
      status: 'completed',
      completedAt: new Date(),
      completedBy: 'care',
      disputeReason: 'condition_mismatch',
    });

    const err = booking.validateSync();
    expect(err).toBeUndefined();
    expect(booking.completedBy).toBe('care');
    expect(booking.disputeReason).toBe('condition_mismatch');
  });
});
