import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { setupTestDB, teardownTestDB, clearTestDB } from './setup/dbTestHelper.js';
import LedgerEntry from '../src/models/LedgerEntry.js';

describe('Suite 1: LedgerEntry Strict Append-Only Invariants', () => {
  beforeAll(async () => {
    await setupTestDB();
  });

  afterAll(async () => {
    await teardownTestDB();
  });

  beforeEach(async () => {
    await clearTestDB();
  });

  it('allows inserting new ledger entries', async () => {
    const entry = await LedgerEntry.create({
      txnId: 'txn-1',
      account: 'available',
      userId: new mongoose.Types.ObjectId(),
      amountPaise: 5000,
      balanceAfterPaise: 5000,
      type: 'deposit_funds',
    });

    expect(entry._id).toBeDefined();
    expect(entry.amountPaise).toBe(5000);
  });

  it('strictly blocks calling .save() on existing documents', async () => {
    const entry = await LedgerEntry.create({
      txnId: 'txn-save-test',
      account: 'available',
      userId: new mongoose.Types.ObjectId(),
      amountPaise: 5000,
      balanceAfterPaise: 5000,
      type: 'deposit_funds',
    });

    entry.amountPaise = 9999;
    await expect(entry.save()).rejects.toThrow(/append-only/i);
  });

  it('strictly blocks updateOne and updateMany query operations', async () => {
    await expect(
      LedgerEntry.updateOne({ txnId: 'txn-1' }, { $set: { amountPaise: 100 } }),
    ).rejects.toThrow(/append-only/i);

    await expect(
      LedgerEntry.updateMany({ txnId: 'txn-1' }, { $set: { amountPaise: 100 } }),
    ).rejects.toThrow(/append-only/i);
  });

  it('strictly blocks findOneAndUpdate, findOneAndReplace and replaceOne', async () => {
    await expect(
      LedgerEntry.findOneAndUpdate({ txnId: 'txn-1' }, { $set: { amountPaise: 100 } }),
    ).rejects.toThrow(/append-only/i);

    await expect(
      LedgerEntry.findOneAndReplace({ txnId: 'txn-1' }, { amountPaise: 100 }),
    ).rejects.toThrow(/append-only/i);

    await expect(LedgerEntry.replaceOne({ txnId: 'txn-1' }, { amountPaise: 100 })).rejects.toThrow(
      /append-only/i,
    );
  });

  it('strictly blocks deleteOne, deleteMany and findOneAndDelete', async () => {
    await expect(LedgerEntry.deleteOne({ txnId: 'txn-1' })).rejects.toThrow(/append-only/i);
    await expect(LedgerEntry.deleteMany({ txnId: 'txn-1' })).rejects.toThrow(/append-only/i);
    await expect(LedgerEntry.findOneAndDelete({ txnId: 'txn-1' })).rejects.toThrow(/append-only/i);
  });

  it('strictly blocks bulkWrite operations containing updates or deletes', async () => {
    await expect(
      LedgerEntry.bulkWrite([
        {
          updateOne: {
            filter: { txnId: 'txn-1' },
            update: { $set: { amountPaise: 200 } },
          },
        },
      ]),
    ).rejects.toThrow(/append-only/i);

    await expect(
      LedgerEntry.bulkWrite([
        {
          deleteOne: {
            filter: { txnId: 'txn-1' },
          },
        },
      ]),
    ).rejects.toThrow(/append-only/i);
  });
});
