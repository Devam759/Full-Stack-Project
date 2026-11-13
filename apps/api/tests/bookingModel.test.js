import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { setupTestDB, teardownTestDB, clearTestDB } from './setup/dbTestHelper.js';
import Booking from '../src/models/Booking.js';
import ItemDayLock from '../src/models/ItemDayLock.js';
import DomainEvent from '../src/models/DomainEvent.js';

describe('Booking and ItemDayLock Models & Indexes Verification', () => {
  beforeAll(async () => {
    await setupTestDB();
    await Booking.init();
    await ItemDayLock.init();
    await DomainEvent.init();
  });

  afterAll(async () => {
    await teardownTestDB();
  });

  beforeEach(async () => {
    await clearTestDB();
  });

  it('proves all required indexes exist on Booking and ItemDayLock', async () => {
    const bookingIndexes = await Booking.collection.indexes();
    const indexNames = bookingIndexes.map((idx) => idx.name);

    // Verify compound indexes on Booking
    expect(indexNames).toContain('borrowerId_1_status_1_createdAt_-1');
    expect(indexNames).toContain('lenderId_1_status_1_createdAt_-1');
    expect(indexNames).toContain('itemId_1_startDate_1_endDate_1');
    expect(indexNames).toContain('status_1_expiresAt_1');
    expect(indexNames).toContain('status_1_dueAt_1');

    // Verify compound unique index on ItemDayLock
    const lockIndexes = await ItemDayLock.collection.indexes();
    const uniqueLockIndex = lockIndexes.find(
      (idx) => idx.key.itemId === 1 && idx.key.day === 1 && idx.unique === true,
    );
    expect(uniqueLockIndex).toBeDefined();

    // Verify database rejects duplicate lock insertion
    const testItemId = new Booking()._id;
    await ItemDayLock.create({ itemId: testItemId, day: '2026-12-01' });
    await expect(ItemDayLock.create({ itemId: testItemId, day: '2026-12-01' })).rejects.toThrow(
      /E11000|duplicate/i,
    );

    // Verify unique index on DomainEvent.eventKey and duplicate rejection
    const eventIndexes = await DomainEvent.collection.indexes();
    const uniqueEventKeyIndex = eventIndexes.find(
      (idx) => idx.key.eventKey === 1 && idx.unique === true,
    );
    expect(uniqueEventKeyIndex).toBeDefined();

    await DomainEvent.create({ eventKey: 'test_event_dup', type: 'test.event' });
    await expect(
      DomainEvent.create({ eventKey: 'test_event_dup', type: 'test.event' }),
    ).rejects.toThrow(/E11000|duplicate/i);
  });
});
