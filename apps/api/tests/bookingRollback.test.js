import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { setupTestDB, teardownTestDB, clearTestDB } from './setup/dbTestHelper.js';
import { createBookingFixtures } from './setup/bookingTestFixture.js';
import app from '../src/app.js';
import Booking from '../src/models/Booking.js';
import Wallet from '../src/models/Wallet.js';
import ItemDayLock from '../src/models/ItemDayLock.js';
import LedgerEntry from '../src/models/LedgerEntry.js';
import LedgerOperation from '../src/models/LedgerOperation.js';
import * as ledgerService from '../src/modules/wallet/ledgerService.js';

describe('Suite 8: Booking Transaction Atomicity and Rollback Verification', () => {
  beforeAll(async () => {
    await setupTestDB();
    await Booking.init();
    await ItemDayLock.init();
    await LedgerOperation.init();
  });

  afterAll(async () => {
    await teardownTestDB();
  });

  beforeEach(async () => {
    await clearTestDB();
  });

  it('proves that a mid-transaction failure during acceptBooking leaves zero day locks and zero partial money', async () => {
    const fixtures = await createBookingFixtures({
      borrowerFundsPaise: 500000,
      rentPerDayPaise: 50000,
      depositPaise: 100000,
    });

    const createRes = await request(app)
      .post('/v1/bookings')
      .set('Authorization', `Bearer ${fixtures.borrowerToken}`)
      .set('Idempotency-Key', 'ik-rollback-req-1')
      .send({
        itemId: fixtures.item._id.toString(),
        startDate: '2026-12-01',
        endDate: '2026-12-03',
      });
    expect(createRes.status).toBe(201);
    const bookingId = createRes.body.booking._id;

    // Simulate a failure in freezeBookingFunds by injecting a spy/mock or artificially throwing an error
    // Alternatively, make borrower's wallet available funds negative or drop the collection's permissions
    // Here we temporarily monkey-patch freezeBookingFunds to throw after ItemDayLocks are already inserted
    let locksExistedMidTxn = false;

    // Force failure during freeze step
    const spy = vi
      .spyOn(ledgerService, 'freezeBookingFunds')
      .mockImplementationOnce(async (args) => {
        // Check that ItemDayLocks were already inserted in the transaction session
        const locksInside = await ItemDayLock.find({ bookingId }).session(args.session);
        if (locksInside.length === 3) {
          locksExistedMidTxn = true;
        }
        throw new Error('SIMULATED_LEDGER_FAILURE_AFTER_LOCKS');
      });

    const acceptRes = await request(app)
      .post(`/v1/bookings/${bookingId}/accept`)
      .set('Authorization', `Bearer ${fixtures.lenderToken}`)
      .set('Idempotency-Key', 'ik-rollback-accept-1');

    spy.mockRestore();

    // Must return 500 or error
    expect(acceptRes.status).toBe(500);
    expect(locksExistedMidTxn).toBe(true);

    // After transaction aborts:
    // 1. Day locks must be completely rolled back (count === 0)
    const locksAfter = await ItemDayLock.find({ bookingId });
    expect(locksAfter.length).toBe(0);

    // 2. Booking status must still be 'requested'
    const bookingAfter = await Booking.findById(bookingId);
    expect(bookingAfter.status).toBe('requested');

    // 3. Borrower wallet must have zero frozen paise and full 500,000 available
    const bWallet = await Wallet.findOne({ userId: fixtures.borrower._id });
    expect(bWallet.frozenPaise).toBe(0);
    expect(bWallet.availablePaise).toBe(500000);

    // 4. Zero hold ledger entries created
    const holdEntries = await LedgerEntry.find({ type: 'booking_hold' });
    expect(holdEntries.length).toBe(0);

    // 5. Zero ledger operations recorded
    const ops = await LedgerOperation.find({ bookingId });
    expect(ops.length).toBe(0);
  });
});
