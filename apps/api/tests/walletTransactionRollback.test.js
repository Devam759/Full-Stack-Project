import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { setupTestDB, teardownTestDB, clearTestDB } from './setup/dbTestHelper.js';
import User from '../src/models/User.js';
import Wallet from '../src/models/Wallet.js';
import LedgerEntry from '../src/models/LedgerEntry.js';
import { runInTransactionWithRetry } from '../src/modules/wallet/ledgerService.js';

describe('Suite 3: Transaction Atomicity & Rollback Integrity', () => {
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
      name: 'Bob Rollback',
      email: 'bob.rollback@example.com',
      emailVerified: true,
      status: 'active',
      passwordHash: 'dummyhash123',
    });
  });

  it('leaves zero partial ledger entries or balance changes when a transaction aborts', async () => {
    await Wallet.create({
      userId: user._id,
      availablePaise: 50000,
      frozenPaise: 0,
    });

    const entriesBefore = await LedgerEntry.countDocuments();
    expect(entriesBefore).toBe(0);

    // Deliberately trigger an error after partial work inside a transaction
    await expect(
      runInTransactionWithRetry(async (session) => {
        // Step 1: Write an entry
        await LedgerEntry.create(
          [
            {
              txnId: 'txn-rollback-test',
              account: 'available',
              userId: user._id,
              amountPaise: 10000,
              type: 'deposit_funds',
            },
          ],
          { session },
        );

        // Step 2: Modify wallet
        await Wallet.updateOne(
          { userId: user._id },
          { $inc: { availablePaise: 10000 } },
          { session },
        );

        // Step 3: Deliberately throw an unhandled error
        throw new Error('Simulated network failure midway through payment execution');
      }),
    ).rejects.toThrow('Simulated network failure');

    // Verify complete rollback: zero ledger entries and unchanged wallet
    const entriesAfter = await LedgerEntry.countDocuments();
    expect(entriesAfter).toBe(0);

    const wallet = await Wallet.findOne({ userId: user._id });
    expect(wallet.availablePaise).toBe(50000);
  });

  it('retries transient write conflict errors with backoff and succeeds on recovery', async () => {
    let attempts = 0;
    const result = await runInTransactionWithRetry(async () => {
      attempts += 1;
      if (attempts < 3) {
        const transientError = new Error('Write conflict during plan execution');
        transientError.code = 112;
        transientError.errorLabels = ['TransientTransactionError'];
        throw transientError;
      }
      return 'success_after_retry';
    }, 5);

    expect(result).toBe('success_after_retry');
    expect(attempts).toBe(3);
  });

  it('throws AppError RETRY_EXHAUSTED with 503 when retries are exhausted under write contention', async () => {
    let attempts = 0;
    const maxRetries = 4;

    await expect(
      runInTransactionWithRetry(async () => {
        attempts += 1;
        const transientError = new Error('Write conflict during plan execution');
        transientError.code = 112;
        transientError.codeName = 'WriteConflict';
        throw transientError;
      }, maxRetries),
    ).rejects.toMatchObject({
      name: 'AppError',
      code: 'RETRY_EXHAUSTED',
      statusCode: 503,
      details: { retryable: true, attempts: maxRetries },
    });

    expect(attempts).toBe(maxRetries);
  });
});
