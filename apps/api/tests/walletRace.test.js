import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { setupTestDB, teardownTestDB, clearTestDB } from './setup/dbTestHelper.js';
import User from '../src/models/User.js';
import Wallet from '../src/models/Wallet.js';
import LedgerEntry from '../src/models/LedgerEntry.js';
import ledgerService from '../src/modules/wallet/ledgerService.js';

describe('Suite 8: High-Concurrency Race Test on Real Replica Set', () => {
  let user;

  beforeAll(async () => {
    await setupTestDB();
  });

  afterAll(async () => {
    await teardownTestDB();
  });

  beforeEach(async () => {
    await clearTestDB();

    user = await User.create({
      name: 'Racer Ray',
      email: 'ray.racer@example.com',
      emailVerified: true,
      status: 'active',
      passwordHash: 'dummyhash',
    });
  });

  it('executes 50 parallel Rs 100 withdrawals from Rs 1,000 giving exactly 10 successes and 40 failures', async () => {
    // 1. Fund user with exactly Rs 1,000 (100,000 paise)
    await ledgerService.addDemoFunds({
      userId: user._id,
      amountPaise: 100_000,
    });

    const initialWallet = await Wallet.findOne({ userId: user._id });
    expect(initialWallet.availablePaise).toBe(100_000);

    // 2. Fire 50 concurrent parallel withdrawals of Rs 100 (10,000 paise each)
    const withdrawalPromises = Array.from({ length: 50 }, (_, i) =>
      ledgerService.withdrawDemoFunds({
        userId: user._id,
        amountPaise: 10_000,
        meta: { attempt: i + 1 },
      }),
    );

    const results = await Promise.allSettled(withdrawalPromises);

    const successes = results.filter((r) => r.status === 'fulfilled');
    const failures = results.filter((r) => r.status === 'rejected');

    // Exactly 10 successful withdrawals (10 * 10,000 = 100,000 paise)
    expect(successes.length).toBe(10);
    expect(failures.length).toBe(40);

    for (const fail of failures) {
      expect(fail.reason.code).toBe('INSUFFICIENT_FUNDS');
    }

    // 3. Final wallet balance must be exactly 0
    const finalWallet = await Wallet.findOne({ userId: user._id });
    expect(finalWallet.availablePaise).toBe(0);
    expect(finalWallet.frozenPaise).toBe(0);

    // 4. Ledger integrity: 1 add txn (2 entries) + 10 withdraw txns (20 entries) = 22 entries
    const ledgerEntries = await LedgerEntry.find({ userId: user._id });
    expect(ledgerEntries.length).toBe(11); // User side entries: 1 credit, 10 debits

    const allEntries = await LedgerEntry.find();
    expect(allEntries.length).toBe(22);

    // Global ledger sum must be exactly zero
    const totalSum = allEntries.reduce((acc, curr) => acc + curr.amountPaise, 0);
    expect(totalSum).toBe(0);
  }, 30000); // 30s timeout for 50 concurrent transactions on replica set

  it('runs the 50-parallel withdrawal race 20 times in a loop: exactly 10 successes and 40 INSUFFICIENT_FUNDS every time', async () => {
    for (let run = 1; run <= 20; run++) {
      await clearTestDB();
      const u = await User.create({
        name: `Racer ${run}`,
        email: `racer_${run}_${Date.now()}@example.com`,
        emailVerified: true,
        status: 'active',
        passwordHash: 'dummyhash',
      });

      await ledgerService.addDemoFunds({ userId: u._id, amountPaise: 100_000 });

      const withdrawalPromises = Array.from({ length: 50 }, (_, i) =>
        ledgerService.withdrawDemoFunds({
          userId: u._id,
          amountPaise: 10_000,
          meta: { run, attempt: i + 1 },
        }),
      );

      const results = await Promise.allSettled(withdrawalPromises);
      const successes = results.filter((r) => r.status === 'fulfilled');
      const failures = results.filter((r) => r.status === 'rejected');

      expect(successes.length).toBe(10);
      expect(failures.length).toBe(40);
      for (const fail of failures) {
        expect(fail.reason.code).toBe('INSUFFICIENT_FUNDS');
      }

      const finalWallet = await Wallet.findOne({ userId: u._id });
      expect(finalWallet.availablePaise).toBe(0);
      expect(finalWallet.frozenPaise).toBe(0);
    }
  }, 120000);
});
