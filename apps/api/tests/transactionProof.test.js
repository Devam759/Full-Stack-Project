import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { setupTestDB, teardownTestDB, clearTestDB } from './setup/dbTestHelper.js';

const TestItemSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    amountPaise: { type: Number, required: true },
  },
  { timestamps: true },
);

const TestItem = mongoose.model('TestTransactionItem', TestItemSchema);

describe('MongoDB Replica Set Transaction Proof', () => {
  beforeAll(async () => {
    await setupTestDB();
  }, 60000);

  afterAll(async () => {
    await teardownTestDB();
  });

  beforeEach(async () => {
    await clearTestDB();
  });

  it('rolls back changes when a transaction is aborted', async () => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      await TestItem.create([{ name: 'Lawn Mower', amountPaise: 50000 }], { session });

      // Within session it should be visible
      const insideTxn = await TestItem.findOne({ name: 'Lawn Mower' }).session(session);
      expect(insideTxn).not.toBeNull();
      expect(insideTxn.name).toBe('Lawn Mower');

      // Outside session it must NOT be visible yet
      const outsideTxn = await TestItem.findOne({ name: 'Lawn Mower' });
      expect(outsideTxn).toBeNull();

      // Abort transaction
      await session.abortTransaction();
    } finally {
      await session.endSession();
    }

    // After abort, document must not exist in database
    const finalDoc = await TestItem.findOne({ name: 'Lawn Mower' });
    expect(finalDoc).toBeNull();
  });

  it('commits changes when a transaction is committed successfully', async () => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      await TestItem.create([{ name: 'Power Drill', amountPaise: 25000 }], { session });

      await session.commitTransaction();
    } finally {
      await session.endSession();
    }

    // After commit, document must exist in database
    const finalDoc = await TestItem.findOne({ name: 'Power Drill' });
    expect(finalDoc).not.toBeNull();
    expect(finalDoc.name).toBe('Power Drill');
    expect(finalDoc.amountPaise).toBe(25000);
  });
});
