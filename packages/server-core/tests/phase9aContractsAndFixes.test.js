import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import { setupTestDB, teardownTestDB } from '../../../apps/api/tests/setup/dbTestHelper.js';
import User from '../src/models/User.js';
import AuditLog from '../src/models/AuditLog.js';
import TrustEvent from '../src/models/TrustEvent.js';
import AdSetting from '../src/models/AdSetting.js';
import SystemSetting from '../src/models/SystemSetting.js';
import { recordTrustEvent, recompute } from '../src/services/trustService.js';
import { applyStrike, reverseStrike } from '../src/services/strikeService.js';

beforeAll(async () => {
  await setupTestDB();
  await AuditLog.init();
  await TrustEvent.init();
  await User.init();
  await AdSetting.init();
  await SystemSetting.init();
});

afterAll(async () => {
  await teardownTestDB();
});

describe('Sub-step 9a: Contracts, Models and Fixes', () => {
  describe('AuditLog Immutability Middleware', () => {
    it('creates an audit log entry but blocks any subsequent modification', async () => {
      const entry = await AuditLog.create({
        actorId: new mongoose.Types.ObjectId(),
        actorRole: 'admin',
        action: 'user_banned',
        targetType: 'user',
        targetId: new mongoose.Types.ObjectId().toString(),
        before: { status: 'active' },
        after: { status: 'banned' },
      });

      expect(entry._id).toBeDefined();

      // 1. Modifying doc.save() must throw
      entry.action = 'unauthorized_edit';
      await expect(entry.save()).rejects.toThrow(
        /AuditLog entries are strictly immutable. Modifying existing entries is prohibited/,
      );

      // 2. updateOne query must throw
      await expect(
        AuditLog.updateOne({ _id: entry._id }, { $set: { action: 'tampered' } }),
      ).rejects.toThrow(/AuditLog entries are strictly immutable and append-only/);

      // 3. findOneAndUpdate query must throw
      await expect(
        AuditLog.findOneAndUpdate({ _id: entry._id }, { $set: { action: 'tampered' } }),
      ).rejects.toThrow(/AuditLog entries are strictly immutable and append-only/);

      // 4. deleteOne query must throw
      await expect(AuditLog.deleteOne({ _id: entry._id })).rejects.toThrow(
        /AuditLog entries are strictly immutable and append-only/,
      );

      // 5. deleteMany query must throw
      await expect(AuditLog.deleteMany({ _id: entry._id })).rejects.toThrow(
        /AuditLog entries are strictly immutable and append-only/,
      );
    });
  });

  describe('Trust Event Reversal and Recompute', () => {
    it('ignores penalty events that have been reversed via penalty_reversed events', async () => {
      const user = await User.create({
        name: 'Trust Test User',
        email: `trust_${Date.now()}@test.com`,
        passwordHash: 'dummy_hash',
        status: 'active',
        trustScore: 50,
      });

      // 1. Initial recompute -> base score 50
      let stats = await recompute(user._id);
      expect(stats.trustScore).toBe(50);

      // 2. Record lost_dispute (-10 trust)
      const penaltyEventKey = `penalty_lost_dispute_${user._id}_${Date.now()}`;
      await recordTrustEvent({
        userId: user._id,
        type: 'lost_dispute',
        eventKey: penaltyEventKey,
        delta: -10,
      });

      // Recompute -> score drops by 10 (to 40)
      stats = await recompute(user._id);
      expect(stats.trustScore).toBe(40);

      // 3. Record penalty_reversed referencing the original penalty
      const reversalEventKey = `penalty_reversed_${penaltyEventKey}`;
      await recordTrustEvent({
        userId: user._id,
        type: 'penalty_reversed',
        eventKey: reversalEventKey,
        meta: { reverses: penaltyEventKey },
      });

      // 4. Recompute -> penalty is completely ignored, score returns to 50
      stats = await recompute(user._id);
      expect(stats.trustScore).toBe(50);
      expect(stats.penaltySum).toBe(0);
    });
  });

  describe('Strike Reversal Determinism and Zero-Strike Refusal', () => {
    it('refuses to reverse a strike when user has 0 strikes', async () => {
      const user = await User.create({
        name: 'Zero Strike User',
        email: `zero_strike_${Date.now()}@test.com`,
        passwordHash: 'dummy_hash',
        status: 'active',
        strikes: 0,
      });

      await expect(
        reverseStrike({
          userId: user._id,
          reason: 'Test reversal',
          eventKey: 'rev_zero_1',
        }),
      ).rejects.toThrow(/User has 0 strikes; cannot reverse strike/);
    });

    it('idempotently handles duplicate reverseStrike calls with the same eventKey', async () => {
      const user = await User.create({
        name: 'Strike Replay User',
        email: `strike_replay_${Date.now()}@test.com`,
        passwordHash: 'dummy_hash',
        status: 'active',
        strikes: 0,
      });

      // Apply 2 strikes
      await applyStrike({
        userId: user._id,
        reason: 'Violation 1',
        eventKey: `apply_1_${user._id}`,
      });
      await applyStrike({
        userId: user._id,
        reason: 'Violation 2',
        eventKey: `apply_2_${user._id}`,
      });

      const updated = await User.findById(user._id);
      expect(updated.strikes).toBe(2);

      // Reversal with deterministic eventKey
      const revKey = `reversal_deterministic_${user._id}`;
      const firstRun = await reverseStrike({
        userId: user._id,
        reason: 'Appeal upheld correction',
        eventKey: revKey,
      });
      expect(firstRun.strikes).toBe(1);

      // Replay with identical eventKey -> must NOT decrement again
      const secondRun = await reverseStrike({
        userId: user._id,
        reason: 'Appeal upheld correction',
        eventKey: revKey,
      });
      expect(secondRun.strikes).toBe(1);

      const finalUser = await User.findById(user._id);
      expect(finalUser.strikes).toBe(1);
    });
  });

  describe('AdSetting and SystemSetting Models', () => {
    it('enforces uniqueness on AdSetting.placement', async () => {
      await AdSetting.create({
        placement: 'home_banner',
        enabled: true,
        adsenseSlotId: '1234567890',
      });

      await expect(
        AdSetting.create({
          placement: 'home_banner',
          enabled: false,
          adsenseSlotId: '9876543210',
        }),
      ).rejects.toThrow();
    });

    it('stores and retrieves SystemSetting keys', async () => {
      await SystemSetting.create({
        key: 'ads.masterEnabled',
        value: false,
      });

      const setting = await SystemSetting.findOne({ key: 'ads.masterEnabled' });
      expect(setting).toBeDefined();
      expect(setting.value).toBe(false);

      // Duplicate key is blocked
      await expect(
        SystemSetting.create({
          key: 'ads.masterEnabled',
          value: true,
        }),
      ).rejects.toThrow();
    });
  });
});
