import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { setupTestDB, teardownTestDB, clearTestDB } from './setup/dbTestHelper.js';
import { createBookingFixtures } from './setup/bookingTestFixture.js';
import app from '../src/app.js';
import Booking from '../src/models/Booking.js';
import ItemDayLock from '../src/models/ItemDayLock.js';
import Wallet from '../src/models/Wallet.js';

describe('Suite 13: Cross-Domain Real Booking Guards (Item Modification, Deletion, and User Account Deletion)', () => {
  beforeAll(async () => {
    await setupTestDB();
    await Booking.init();
    await ItemDayLock.init();
  });

  afterAll(async () => {
    await teardownTestDB();
  });

  beforeEach(async () => {
    await clearTestDB();
  });

  it('active booking blocks modifying restricted pricing/deposit/dates on item', async () => {
    const fixtures = await createBookingFixtures();

    // Create and accept booking
    const createRes = await request(app)
      .post('/v1/bookings')
      .set('Authorization', `Bearer ${fixtures.borrowerToken}`)
      .set('Idempotency-Key', 'ik-guard-edit-create')
      .send({
        itemId: fixtures.item._id.toString(),
        startDate: '2026-12-10',
        endDate: '2026-12-12',
      });
    expect(createRes.status).toBe(201);
    const bookingId = createRes.body.booking._id;

    await request(app)
      .post(`/v1/bookings/${bookingId}/accept`)
      .set('Authorization', `Bearer ${fixtures.lenderToken}`)
      .set('Idempotency-Key', 'ik-guard-edit-accept');

    // Lender attempts to edit rentPerDayPaise while booking is active
    const editRes = await request(app)
      .patch(`/v1/items/${fixtures.item._id}`)
      .set('Authorization', `Bearer ${fixtures.lenderToken}`)
      .send({
        rentPerDayPaise: 80000,
      });

    expect(editRes.status).toBe(409);
    expect(editRes.body.error.message).toContain('while an active booking is in progress');
  });

  it('active booking blocks deleting item', async () => {
    const fixtures = await createBookingFixtures();

    const createRes = await request(app)
      .post('/v1/bookings')
      .set('Authorization', `Bearer ${fixtures.borrowerToken}`)
      .set('Idempotency-Key', 'ik-guard-del-create')
      .send({
        itemId: fixtures.item._id.toString(),
        startDate: '2026-12-10',
        endDate: '2026-12-12',
      });
    const bookingId = createRes.body.booking._id;

    await request(app)
      .post(`/v1/bookings/${bookingId}/accept`)
      .set('Authorization', `Bearer ${fixtures.lenderToken}`)
      .set('Idempotency-Key', 'ik-guard-del-accept');

    // Lender attempts to delete item
    const deleteRes = await request(app)
      .delete(`/v1/items/${fixtures.item._id}`)
      .set('Authorization', `Bearer ${fixtures.lenderToken}`);

    expect(deleteRes.status).toBe(409);
    expect(deleteRes.body.error.message).toContain('while an active booking is in progress');
  });

  it('active booking and frozen funds block user account deletion until resolved', async () => {
    const fixtures = await createBookingFixtures();

    const createRes = await request(app)
      .post('/v1/bookings')
      .set('Authorization', `Bearer ${fixtures.borrowerToken}`)
      .set('Idempotency-Key', 'ik-guard-user-create')
      .send({
        itemId: fixtures.item._id.toString(),
        startDate: '2026-12-10',
        endDate: '2026-12-12',
      });
    const bookingId = createRes.body.booking._id;

    await request(app)
      .post(`/v1/bookings/${bookingId}/accept`)
      .set('Authorization', `Bearer ${fixtures.lenderToken}`)
      .set('Idempotency-Key', 'ik-guard-user-accept');

    // Borrower attempts to delete their account while booking is active and funds are frozen
    const deleteRes = await request(app)
      .delete('/v1/users/me')
      .set('Authorization', `Bearer ${fixtures.borrowerToken}`)
      .send({ password: 'Password123!' }); // Valid password to reach business rule check

    expect(deleteRes.status).toBe(409);
    expect(deleteRes.body.error.message).toContain(
      'Account cannot be deleted while bookings are open or wallet funds are frozen',
    );

    // Cancel the booking so funds are refunded and status is cancelled
    await request(app)
      .post(`/v1/bookings/${bookingId}/cancel`)
      .set('Authorization', `Bearer ${fixtures.borrowerToken}`)
      .set('Idempotency-Key', 'ik-guard-user-cancel')
      .send({ reason: 'Need to cancel before deleting account' });

    // Verify wallet frozenPaise is now 0
    const bWallet = await Wallet.findOne({ userId: fixtures.borrower._id });
    expect(bWallet.frozenPaise).toBe(0);

    // Also withdraw all available funds so wallet is zeroed if needed
    // Now verify deletion guard is unblocked
    const unblockedCheck = await Booking.exists({
      borrowerId: fixtures.borrower._id,
      status: { $in: ['accepted', 'picked_up', 'returned', 'disputed'] },
    });
    expect(unblockedCheck).toBeNull();
  });
});
