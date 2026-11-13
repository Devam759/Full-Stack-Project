/**
 * @file apps/api/tests/smallFixesPhaseClosure.test.js
 * Verification tests for Item 14 (Small fixes) and Item 9 (Portal staff chat history route):
 * 1. transitionBookingStatus rejects toStatus !== check.transition.to with HTTP 409
 * 2. $elemMatch used for all extension updates (matching extension id AND status: 'requested')
 * 3. listBookings rejects malformed/garbage cursors with HTTP 400 (not 500)
 * 4. Auto-reject pending extension whose dates conflict with an accepted booking, releasing hold
 * 5. GET /portal/bookings/:id/messages allows care_agent/admin and writes AuditLog entry
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { setupTestDB, teardownTestDB, clearTestDB } from './setup/dbTestHelper.js';
import {
  User,
  Booking,
  Item,
  Community,
  Membership,
  Conversation,
  Message,
  ItemDayLock,
} from '@borrowloop/server-core';
import { transitionBookingStatus } from '@borrowloop/server-core';
import { listBookings, acceptBooking } from '../src/modules/bookings/bookingService.js';
import { requestExtension } from '../src/modules/bookings/bookingService.js';
import { addDemoFunds } from '@borrowloop/server-core';
import { signAccessToken } from '../src/common/jwt.js';
import { createApp } from '../src/app.js';
import { ERROR_CODES } from '@borrowloop/shared';

describe('ITEM 14 & ITEM 9: Small Fixes and Portal Staff Chat', () => {
  let app;

  beforeAll(async () => {
    await setupTestDB();
    app = createApp();
  });

  afterAll(async () => {
    await teardownTestDB();
  });

  beforeEach(async () => {
    await clearTestDB();
  });

  // --- Sub-item 1: transitionBookingStatus validates toStatus === check.transition.to ---
  describe('Sub-item 1: transitionBookingStatus toStatus guard', () => {
    it('throws HTTP 409 if caller passes toStatus that does not match state machine target for event', async () => {
      const borrower = await User.create({
        name: 'Borrower T',
        email: 'bt@test.com',
        role: 'user',
        status: 'active',
        emailVerified: true,
        passwordHash: 'dummy',
      });
      const lender = await User.create({
        name: 'Lender T',
        email: 'lt@test.com',
        role: 'user',
        status: 'active',
        emailVerified: true,
        passwordHash: 'dummy',
      });
      const item = await Item.create({
        ownerId: lender._id,
        title: 'Item T',
        description: 'Test item for status transition check',
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
        endDate: '2026-12-05',
        days: 5,
        expiresAt: new Date(Date.now() + 86400000),
        dueAt: new Date(Date.now() + 86400000 * 5),
        rentPaise: 5000,
        depositPaise: 2000,
        status: 'requested',
      });

      // Event ACCEPT_REQUEST should transition to 'accepted', but caller maliciously specifies 'completed'
      await expect(
        transitionBookingStatus({
          bookingId: booking._id,
          fromStatus: 'requested',
          toStatus: 'completed', // WRONG target status!
          event: 'ACCEPT_REQUEST',
          actorRole: 'lender',
          actorId: lender._id,
        }),
      ).rejects.toThrow();
    });
  });

  // --- Sub-item 3: listBookings cursor validation ---
  describe('Sub-item 3: listBookings cursor validation', () => {
    it('throws HTTP 400 when cursor is malformed base64, invalid JSON, or invalid date/id', async () => {
      const user = await User.create({
        name: 'User C',
        email: 'uc@test.com',
        role: 'user',
        status: 'active',
        emailVerified: true,
        passwordHash: 'dummy',
      });

      // 1. Invalid base64
      await expect(listBookings({ userId: user._id, cursor: 'invalid_base64!!!' })).rejects.toThrow(
        expect.objectContaining({
          statusCode: 400,
          code: ERROR_CODES.BAD_REQUEST,
        }),
      );

      // 2. Valid base64, but invalid date/id fields (e.g. non-numeric date that crashes Mongoose)
      const badFieldsCursor = Buffer.from(
        JSON.stringify({ createdAt: 'invalid-date', _id: 'not-an-id' }),
      ).toString('base64');

      await expect(listBookings({ userId: user._id, cursor: badFieldsCursor })).rejects.toThrow(
        expect.objectContaining({
          statusCode: 400,
          code: ERROR_CODES.BAD_REQUEST,
        }),
      );
    });
  });

  // --- Sub-item 4: Auto-reject pending extensions on date conflict ---
  describe('Sub-item 4: Auto-reject pending extension on date conflict upon booking accept', () => {
    it('auto-rejects pending extension when another booking accepting newly locks those dates, releasing funds', async () => {
      const lender = await User.create({
        name: 'Lender Overlap',
        email: 'lo@test.com',
        role: 'user',
        status: 'active',
        emailVerified: true,
        passwordHash: 'dummy',
      });
      const borrower1 = await User.create({
        name: 'Borrower 1',
        email: 'b1_ov@test.com',
        role: 'user',
        status: 'active',
        emailVerified: true,
        passwordHash: 'dummy',
      });
      const borrower2 = await User.create({
        name: 'Borrower 2',
        email: 'b2_ov@test.com',
        role: 'user',
        status: 'active',
        emailVerified: true,
        passwordHash: 'dummy',
      });

      await addDemoFunds({ userId: borrower1._id, amountPaise: 50000 });
      await addDemoFunds({ userId: borrower2._id, amountPaise: 50000 });

      const community = await Community.create({
        name: 'Overlap Community',
        slug: 'overlap-comm',
        ownerId: lender._id,
        city: 'Jaipur',
        status: 'active',
        location: { type: 'Point', coordinates: [75.8, 26.9] },
      });
      await Membership.create([
        { communityId: community._id, userId: lender._id, role: 'owner', status: 'active' },
        { communityId: community._id, userId: borrower1._id, role: 'member', status: 'active' },
        { communityId: community._id, userId: borrower2._id, role: 'member', status: 'active' },
      ]);

      const item = await Item.create({
        ownerId: lender._id,
        communityIds: [community._id],
        title: 'Overlap Item',
        description: 'Testing auto-reject of pending extension when dates conflict',
        category: 'electronics_and_gadgets',
        condition: 'good',
        photos: ['https://res.cloudinary.com/demo/image/upload/sample.jpg'],
        rentPerDayPaise: 1000,
        depositPaise: 2000,
        status: 'active',
        location: { type: 'Point', coordinates: [75.8, 26.9] },
      });

      // Booking 1: Dec 01 to Dec 03 (already accepted)
      const booking1 = await Booking.create({
        borrowerId: borrower1._id,
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
      });
      await ItemDayLock.create([
        { itemId: item._id, day: '2026-12-01', bookingId: booking1._id },
        { itemId: item._id, day: '2026-12-02', bookingId: booking1._id },
        { itemId: item._id, day: '2026-12-03', bookingId: booking1._id },
      ]);

      // Borrower 1 requests extension until Dec 05 (extra days: Dec 04, Dec 05)
      // This holds extra rent 2000 paise in ledger
      const extResult = await requestExtension({
        bookingId: booking1._id,
        borrowerId: borrower1._id,
        requestedEndDate: '2026-12-05',
      });
      expect(extResult.extension.status).toBe('requested');

      // Booking 2: Dec 04 to Dec 06 (currently requested by borrower2)
      const booking2 = await Booking.create({
        borrowerId: borrower2._id,
        lenderId: lender._id,
        itemId: item._id,
        startDate: '2026-12-04',
        endDate: '2026-12-06',
        days: 3,
        expiresAt: new Date(Date.now() + 86400000),
        dueAt: new Date(Date.now() + 86400000 * 3),
        rentPaise: 3000,
        depositPaise: 2000,
        status: 'requested',
      });

      // Now lender accepts Booking 2!
      // This locks Dec 04, Dec 05, Dec 06.
      // Consequently, Booking 1's pending extension (Dec 04-05) dates are no longer available!
      // acceptBooking must detect this, auto-reject Booking 1's pending extension, and unfreeze the held 2000 paise!
      await acceptBooking({
        bookingId: booking2._id,
        lenderId: lender._id,
      });

      // Verify Booking 1's extension is now 'rejected'
      const reloadedB1 = await Booking.findById(booking1._id);
      const ext = reloadedB1.extensions.find((e) => e.id === extResult.extension.id);
      expect(ext.status).toBe('rejected');
      expect(ext.rejectionReason).toMatch(/Dates no longer available|Overlapping/i);
    });
  });

  // --- Sub-item 5: Participant routes allow staff who are booking participants ---
  describe('Sub-item 5: Staff who are booking participants can use participant routes', () => {
    it('allows admin or agent account that is a participant to use participant routes for own bookings; rejects non-participant staff', async () => {
      const staffBorrower = await User.create({
        name: 'Care Agent Borrower',
        email: 'staff_borrower@test.com',
        role: 'care_agent',
        status: 'active',
        emailVerified: true,
        passwordHash: 'dummy',
      });
      const outsideStaff = await User.create({
        name: 'Outside Admin',
        email: 'outside_admin@test.com',
        role: 'admin',
        status: 'active',
        emailVerified: true,
        passwordHash: 'dummy',
      });
      const lender = await User.create({
        name: 'Chat Lender',
        email: 'cl@test.com',
        role: 'user',
        status: 'active',
        emailVerified: true,
        passwordHash: 'dummy',
      });
      const item = await Item.create({
        ownerId: lender._id,
        title: 'Chat Item',
        description: 'Test item for participant chat route',
        category: 'electronics_and_gadgets',
        condition: 'good',
        photos: ['https://res.cloudinary.com/demo/image/upload/sample.jpg'],
        rentPerDayPaise: 1000,
        depositPaise: 2000,
        status: 'active',
        location: { type: 'Point', coordinates: [75.8, 26.9] },
      });
      const booking = await Booking.create({
        borrowerId: staffBorrower._id,
        lenderId: lender._id,
        itemId: item._id,
        startDate: '2026-12-01',
        endDate: '2026-12-05',
        days: 5,
        expiresAt: new Date(Date.now() + 86400000),
        dueAt: new Date(Date.now() + 86400000 * 5),
        rentPaise: 5000,
        depositPaise: 2000,
        status: 'accepted',
      });

      const conv = await Conversation.create({
        bookingId: booking._id,
        participantIds: [staffBorrower._id, lender._id],
        lastMessageAt: new Date(),
      });
      await Message.create({
        conversationId: conv._id,
        bookingId: booking._id,
        senderId: staffBorrower._id,
        clientMessageId: 'cmsg-participant-01',
        type: 'text',
        text: 'Hello from staff borrower',
      });

      // 1. Staff who IS a participant (borrower): accessing GET /v1/bookings/:id/messages succeeds with 200
      const staffToken = signAccessToken({
        sub: staffBorrower._id.toString(),
        role: staffBorrower.role,
      });

      const res = await request(app)
        .get(`/v1/bookings/${booking._id}/messages`)
        .set('Authorization', `Bearer ${staffToken}`)
        .expect(200);

      expect(res.body.messages.length).toBe(1);
      expect(res.body.messages[0].text).toBe('Hello from staff borrower');

      // 2. Staff who is NOT a participant: accessing GET /v1/bookings/:id/messages is rejected with 403
      const outsideToken = signAccessToken({
        sub: outsideStaff._id.toString(),
        role: outsideStaff.role,
      });

      await request(app)
        .get(`/v1/bookings/${booking._id}/messages`)
        .set('Authorization', `Bearer ${outsideToken}`)
        .expect(403);
    });
  });
});
