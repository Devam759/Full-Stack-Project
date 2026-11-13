/**
 * @file apps/api/tests/moneyPhaseClosure.test.js
 * Verification tests for Money Requirements 1, 2, 3, and 4:
 * 1. Worker pickup expiry re-reads booking & extensions inside transaction; lender reject race & retries
 * 2. Canonical opRef (ext_release_<id>) across all extension release paths (all path pairs)
 * 3. refundCancelledBooking and releaseDeposit compute refundable amount from ledger inside transaction
 * 4. Single ledgerService and idempotency helper copy across monorepo with guard test
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import fs from 'node:fs';
import path from 'node:path';
import { setupTestDB, teardownTestDB, clearTestDB } from './setup/dbTestHelper.js';
import {
  User,
  Wallet,
  Booking,
  Item,
  LedgerOperation,
  refundCancelledBooking,
  releaseDeposit,
  holdExtensionFunds,
  freezeBookingFunds,
} from '@borrowloop/server-core';
import { rejectExtension, cancelBooking } from '../src/modules/bookings/bookingService.js';
import { executeBookingExpiryJob } from '../../../apps/worker/src/jobs/bookingExpiryJob.js';

describe('MONEY Verification: Items 1, 2, 3, and 4', () => {
  beforeAll(async () => {
    await setupTestDB();
  });

  afterAll(async () => {
    await teardownTestDB();
  });

  beforeEach(async () => {
    await clearTestDB();
  });

  // --- ITEM 3: Ledger-derived refundable amount enforcement ---
  describe('Item 3: refundCancelledBooking and releaseDeposit ledger validation', () => {
    it('rejects refundCancelledBooking when caller amount exceeds held frozen funds for booking', async () => {
      const borrower = await User.create({
        name: 'Borrower 1',
        email: 'borrower1@test.com',
        role: 'user',
        status: 'active',
        emailVerified: true,
        passwordHash: 'dummy-hash',
      });

      // Wallet has 50,000 paise available
      await Wallet.create({
        userId: borrower._id,
        availablePaise: 50000,
        frozenPaise: 0,
      });

      const bookingId = new mongoose.Types.ObjectId();

      // Hold 10,000 paise for this booking
      await freezeBookingFunds({
        borrowerId: borrower._id,
        bookingId,
        rentPaise: 7000,
        depositPaise: 3000,
      });

      const walletAfterHold = await Wallet.findOne({ userId: borrower._id });
      expect(walletAfterHold.availablePaise).toBe(40000);
      expect(walletAfterHold.frozenPaise).toBe(10000);

      // Caller attempts to refund 15,000 paise (exceeds 10,000 held for this booking)
      await expect(
        refundCancelledBooking({
          borrowerId: borrower._id,
          bookingId,
          totalFrozenPaise: 15000,
          opRef: 'excess_refund_test',
        }),
      ).rejects.toThrow();

      // Verify wallet frozen funds are intact
      const walletIntact = await Wallet.findOne({ userId: borrower._id });
      expect(walletIntact.frozenPaise).toBe(10000);
      expect(walletIntact.availablePaise).toBe(40000);
    });

    it('rejects refundCancelledBooking when booking has no holds in the ledger', async () => {
      const borrower = await User.create({
        name: 'Borrower No Hold',
        email: 'borrower_nohold@test.com',
        role: 'user',
        status: 'active',
        emailVerified: true,
        passwordHash: 'dummy-hash',
      });

      await Wallet.create({
        userId: borrower._id,
        availablePaise: 20000,
        frozenPaise: 10000, // Frozen from unrelated activity
      });

      const bookingWithoutHold = new mongoose.Types.ObjectId();

      await expect(
        refundCancelledBooking({
          borrowerId: borrower._id,
          bookingId: bookingWithoutHold,
          totalFrozenPaise: 5000,
          opRef: 'no_hold_test',
        }),
      ).rejects.toThrow();
    });

    it('refundCancelledBooking on booking A does not touch booking B frozen funds', async () => {
      const borrower = await User.create({
        name: 'Borrower Multi Booking',
        email: 'borrower_multi@test.com',
        role: 'user',
        status: 'active',
        emailVerified: true,
        passwordHash: 'dummy-hash',
      });

      await Wallet.create({
        userId: borrower._id,
        availablePaise: 100000,
        frozenPaise: 0,
      });

      const bookingA = new mongoose.Types.ObjectId();
      const bookingB = new mongoose.Types.ObjectId();

      // Hold for booking A: 20,000 paise
      await freezeBookingFunds({
        borrowerId: borrower._id,
        bookingId: bookingA,
        rentPaise: 15000,
        depositPaise: 5000,
      });

      // Hold for booking B: 30,000 paise
      await freezeBookingFunds({
        borrowerId: borrower._id,
        bookingId: bookingB,
        rentPaise: 20000,
        depositPaise: 10000,
      });

      const walletBoth = await Wallet.findOne({ userId: borrower._id });
      expect(walletBoth.frozenPaise).toBe(50000);

      // Attempt to refund 25,000 on booking A (only 20,000 was held on A)
      await expect(
        refundCancelledBooking({
          borrowerId: borrower._id,
          bookingId: bookingA,
          totalFrozenPaise: 25000,
          opRef: 'booking_a_excess',
        }),
      ).rejects.toThrow();

      // Successful legitimate refund of booking A (20,000 paise)
      await refundCancelledBooking({
        borrowerId: borrower._id,
        bookingId: bookingA,
        totalFrozenPaise: 20000,
        opRef: 'booking_a_legit',
      });

      // Booking B's 30,000 paise must remain strictly frozen!
      const walletAfterA = await Wallet.findOne({ userId: borrower._id });
      expect(walletAfterA.frozenPaise).toBe(30000);
      expect(walletAfterA.availablePaise).toBe(70000);
    });

    it('rejects releaseDeposit when caller amount exceeds held deposit for that booking', async () => {
      const borrower = await User.create({
        name: 'Borrower Deposit Test',
        email: 'borrower_dep@test.com',
        role: 'user',
        status: 'active',
        emailVerified: true,
        passwordHash: 'dummy-hash',
      });

      await Wallet.create({
        userId: borrower._id,
        availablePaise: 50000,
        frozenPaise: 0,
      });

      const bookingId = new mongoose.Types.ObjectId();

      await freezeBookingFunds({
        borrowerId: borrower._id,
        bookingId,
        rentPaise: 5000,
        depositPaise: 2000,
      });

      // Caller attempts to release deposit of 5,000 paise (held deposit was only 2,000)
      await expect(
        releaseDeposit({
          borrowerId: borrower._id,
          bookingId,
          depositPaise: 5000,
          opRef: 'excess_deposit',
        }),
      ).rejects.toThrow();
    });
  });

  // --- ITEM 1: Worker pickup expiry fresh read and concurrency ---
  describe('Item 1: Worker pickup expiry re-reads booking & extensions inside transaction', () => {
    it('lender rejects an extension at same moment pickup expires; hold released once and other booking unaffected', async () => {
      const borrower = await User.create({
        name: 'Borrower Expiry Race',
        email: 'borrower_exp_race@test.com',
        role: 'user',
        status: 'active',
        emailVerified: true,
        passwordHash: 'dummy-hash',
      });
      const lender = await User.create({
        name: 'Lender Expiry Race',
        email: 'lender_exp_race@test.com',
        role: 'user',
        status: 'active',
        emailVerified: true,
        passwordHash: 'dummy-hash',
      });

      // Borrower has 200,000 available
      await Wallet.create({
        userId: borrower._id,
        availablePaise: 200000,
        frozenPaise: 0,
      });

      const item = await Item.create({
        ownerId: lender._id,
        title: 'Expiry Race Item',
        description: 'Test item with sufficient description length',
        category: 'electronics_and_gadgets',
        condition: 'good',
        photos: ['https://res.cloudinary.com/demo/image/upload/sample.jpg'],
        rentPerDayPaise: 1000,
        depositPaise: 2000,
        status: 'active',
        location: { type: 'Point', coordinates: [75.8, 26.9] },
      });

      // Another unrelated active booking B with frozen funds
      const bookingB = await Booking.create({
        borrowerId: borrower._id,
        lenderId: lender._id,
        itemId: item._id,
        startDate: '2026-12-10',
        endDate: '2026-12-15',
        days: 5,
        expiresAt: new Date(Date.now() + 86400000),
        dueAt: new Date(Date.now() + 86400000 * 5),
        rentPaise: 5000,
        depositPaise: 3000,
        status: 'accepted',
      });
      await freezeBookingFunds({
        borrowerId: borrower._id,
        bookingId: bookingB._id,
        rentPaise: 5000,
        depositPaise: 3000,
      });

      // Target booking A past pickup deadline (yesterday)
      const bookingA = await Booking.create({
        borrowerId: borrower._id,
        lenderId: lender._id,
        itemId: item._id,
        startDate: '2026-01-01', // well in the past
        endDate: '2026-01-05',
        days: 5,
        expiresAt: new Date(Date.now() + 86400000),
        dueAt: new Date(Date.now() + 86400000 * 5),
        rentPaise: 4000,
        depositPaise: 2000,
        status: 'accepted',
        extensions: [
          {
            id: 'ext-race-1',
            requestedEndDate: '2026-01-07',
            extraDays: 2,
            extraRentPaise: 2000,
            status: 'requested',
            requestedAt: new Date(),
          },
        ],
      });
      await freezeBookingFunds({
        borrowerId: borrower._id,
        bookingId: bookingA._id,
        rentPaise: 4000,
        depositPaise: 2000,
      });
      await holdExtensionFunds({
        borrowerId: borrower._id,
        bookingId: bookingA._id,
        extraRentPaise: 2000,
        extensionId: 'ext-race-1',
      });

      // Before race: bookingB has 8000 frozen, bookingA has 6000 + 2000 = 8000 frozen. Total frozen = 16000
      const walletPre = await Wallet.findOne({ userId: borrower._id });
      expect(walletPre.frozenPaise).toBe(16000);

      // Concurrently run rejectExtension AND pickup expiry
      const _results = await Promise.allSettled([
        rejectExtension({
          bookingId: bookingA._id,
          lenderId: lender._id,
          reason: 'Lender rejected extension at deadline',
        }),
        executeBookingExpiryJob({ redis: null }),
      ]);

      // Verify wallet: bookingA's 8000 frozen is released, bookingB's 8000 remains frozen!
      const walletPost = await Wallet.findOne({ userId: borrower._id });
      expect(walletPost.frozenPaise).toBe(8000);
      expect(walletPost.availablePaise).toBe(192000);

      // Verify that ext_release_ext-race-1 was applied exactly once
      const extOps = await LedgerOperation.find({
        bookingId: bookingA._id,
        operationType: 'booking_cancel_refund',
        opRef: 'ext_release_ext-race-1',
      });
      expect(extOps.length).toBe(1);
    });
  });

  // --- ITEM 2: Canonical opRef (ext_release_<id>) across all pairs ---
  describe('Item 2: Canonical opRef per extension release across all path pairs', () => {
    it('enforces release-once between reject and cancel via canonical opRef', async () => {
      const borrower = await User.create({
        name: 'Borrower Canonical',
        email: 'borrower_canon@test.com',
        role: 'user',
        status: 'active',
        emailVerified: true,
        passwordHash: 'dummy-hash',
      });
      const lender = await User.create({
        name: 'Lender Canonical',
        email: 'lender_canon@test.com',
        role: 'user',
        status: 'active',
        emailVerified: true,
        passwordHash: 'dummy-hash',
      });

      await Wallet.create({
        userId: borrower._id,
        availablePaise: 100000,
        frozenPaise: 0,
      });

      const item = await Item.create({
        ownerId: lender._id,
        title: 'Canon Item',
        description: 'Test item with sufficient description length',
        category: 'electronics_and_gadgets',
        condition: 'good',
        photos: ['https://res.cloudinary.com/demo/image/upload/sample.jpg'],
        rentPerDayPaise: 1000,
        depositPaise: 2000,
        status: 'active',
        location: { type: 'Point', coordinates: [75.8, 26.9] },
      });

      const booking = await Booking.create({
        borrowerId: borrower._id,
        lenderId: lender._id,
        itemId: item._id,
        startDate: '2026-12-01',
        endDate: '2026-12-03',
        days: 3,
        expiresAt: new Date(Date.now() + 86400000),
        dueAt: new Date(Date.now() + 86400000 * 3),
        rentPaise: 3000,
        depositPaise: 2000,
        status: 'accepted',
        extensions: [
          {
            id: 'ext-canon-1',
            requestedEndDate: '2026-12-05',
            extraDays: 2,
            extraRentPaise: 2000,
            status: 'requested',
            requestedAt: new Date(),
          },
        ],
      });

      // Hold 5000 initial booking + 2000 extension
      await freezeBookingFunds({
        borrowerId: borrower._id,
        bookingId: booking._id,
        rentPaise: 3000,
        depositPaise: 2000,
      });
      await holdExtensionFunds({
        borrowerId: borrower._id,
        bookingId: booking._id,
        extraRentPaise: 2000,
        extensionId: 'ext-canon-1',
      });

      const walletHeld = await Wallet.findOne({ userId: borrower._id });
      expect(walletHeld.frozenPaise).toBe(7000);

      // Path 1: rejectExtension releases extension
      await rejectExtension({
        bookingId: booking._id,
        lenderId: lender._id,
        reason: 'Too busy',
      });

      const walletAfterReject = await Wallet.findOne({ userId: borrower._id });
      expect(walletAfterReject.frozenPaise).toBe(5000); // 2000 unfrozen!

      // Path 2: cancelBooking called later must NOT release the extension again
      await cancelBooking({
        bookingId: booking._id,
        userId: borrower._id,
        reason: 'Change of mind',
      });

      const walletAfterCancel = await Wallet.findOne({ userId: borrower._id });
      // Total released should be 5000 (initial) + 2000 (ext once) = 7000. Frozen must be 0!
      expect(walletAfterCancel.frozenPaise).toBe(0);
      expect(walletAfterCancel.availablePaise).toBe(100000);

      // Verify LedgerOperations for booking_cancel_refund:
      const refundOps = await LedgerOperation.find({
        bookingId: booking._id,
        operationType: 'booking_cancel_refund',
      });
      // Exactly 2 operations: default (rent+deposit) and ext_release_ext-canon-1
      const opRefs = refundOps.map((o) => o.opRef);
      expect(opRefs).toContain('ext_release_ext-canon-1');
      expect(opRefs).toContain('default');
      expect(refundOps.length).toBe(2);
    });

    it('enforces release-once across cancel + extension expiry pair', async () => {
      const borrower = await User.create({
        name: 'Borrower Pair 2',
        email: 'b_pair2@test.com',
        role: 'user',
        status: 'active',
        emailVerified: true,
        passwordHash: 'dummy-hash',
      });
      const lender = await User.create({
        name: 'Lender Pair 2',
        email: 'l_pair2@test.com',
        role: 'user',
        status: 'active',
        emailVerified: true,
        passwordHash: 'dummy-hash',
      });

      await Wallet.create({
        userId: borrower._id,
        availablePaise: 100000,
        frozenPaise: 0,
      });

      const item = await Item.create({
        ownerId: lender._id,
        title: 'Canon Pair 2 Item',
        description: 'Test item with sufficient description length',
        category: 'electronics_and_gadgets',
        condition: 'good',
        photos: ['https://res.cloudinary.com/demo/image/upload/sample.jpg'],
        rentPerDayPaise: 1000,
        depositPaise: 2000,
        status: 'active',
        location: { type: 'Point', coordinates: [75.8, 26.9] },
      });

      const booking = await Booking.create({
        borrowerId: borrower._id,
        lenderId: lender._id,
        itemId: item._id,
        startDate: '2026-12-01',
        endDate: '2026-12-03',
        days: 3,
        expiresAt: new Date(Date.now() + 86400000),
        dueAt: new Date(Date.now() + 86400000 * 3),
        rentPaise: 3000,
        depositPaise: 2000,
        status: 'accepted',
        extensions: [
          {
            id: 'ext-canon-2',
            requestedEndDate: '2026-12-05',
            extraDays: 2,
            extraRentPaise: 2000,
            status: 'requested',
            expiresAt: new Date(Date.now() - 1000), // expired
            requestedAt: new Date(),
          },
        ],
      });

      await freezeBookingFunds({
        borrowerId: borrower._id,
        bookingId: booking._id,
        rentPaise: 3000,
        depositPaise: 2000,
      });
      await holdExtensionFunds({
        borrowerId: borrower._id,
        bookingId: booking._id,
        extraRentPaise: 2000,
        extensionId: 'ext-canon-2',
      });

      // Concurrently run cancelBooking and executeBookingExpiryJob
      await Promise.allSettled([
        cancelBooking({
          bookingId: booking._id,
          userId: borrower._id,
          reason: 'Cancel before pickup',
        }),
        executeBookingExpiryJob({ redis: null }),
      ]);

      const wallet = await Wallet.findOne({ userId: borrower._id });
      expect(wallet.frozenPaise).toBe(0);
      expect(wallet.availablePaise).toBe(100000);

      const refundOps = await LedgerOperation.find({
        bookingId: booking._id,
        operationType: 'booking_cancel_refund',
        opRef: 'ext_release_ext-canon-2',
      });
      expect(refundOps.length).toBe(1);
    });
  });

  // --- ITEM 4: Single copy of ledgerService and idempotency helper ---
  describe('Item 4: Single copy of ledgerService and idempotency helper', () => {
    it('verifies apps/api/src/modules/wallet/ledgerService.js re-exports from packages/server-core', () => {
      const apiLedgerPath = path.resolve('apps/api/src/modules/wallet/ledgerService.js');
      expect(fs.existsSync(apiLedgerPath)).toBe(true);
      const content = fs.readFileSync(apiLedgerPath, 'utf8');
      expect(content).toMatch(/export\s+\*\s+from\s+['"]@borrowloop\/server-core/);
    });

    it('verifies apps/api/src/common/idempotencyMiddleware.js re-exports core idempotency from packages/server-core', () => {
      const apiIdempPath = path.resolve('apps/api/src/common/idempotencyMiddleware.js');
      expect(fs.existsSync(apiIdempPath)).toBe(true);
      const content = fs.readFileSync(apiIdempPath, 'utf8');
      expect(content).toMatch(/from\s+['"]@borrowloop\/server-core/);
    });

    it('guard: fails if a duplicate standalone implementation of ledgerService or idempotency helper exists in apps/api', () => {
      // Find all files in apps/api/src
      const findFiles = (dir) => {
        let results = [];
        for (const file of fs.readdirSync(dir)) {
          const fullPath = path.join(dir, file);
          const stat = fs.statSync(fullPath);
          if (stat.isDirectory()) {
            results = results.concat(findFiles(fullPath));
          } else if (file.endsWith('.js')) {
            results.push(fullPath);
          }
        }
        return results;
      };

      const apiFiles = findFiles(path.resolve('apps/api/src'));
      for (const file of apiFiles) {
        const content = fs.readFileSync(file, 'utf8');
        // If file defines standalone addDemoFunds implementation (not an import/export)
        if (
          content.includes('async function addDemoFunds') ||
          content.includes('function addDemoFunds(')
        ) {
          throw new Error(`Duplicate ledgerService implementation detected in ${file}`);
        }
        // If file defines standalone canonicalJsonStringify implementation (not an import/export)
        if (content.includes('function canonicalJsonStringify(')) {
          throw new Error(`Duplicate idempotency helper implementation detected in ${file}`);
        }
      }
    });
  });
});
