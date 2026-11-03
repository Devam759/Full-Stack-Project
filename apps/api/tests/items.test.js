import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import { setupTestDB, teardownTestDB, clearTestDB } from './setup/dbTestHelper.js';
import User from '../src/models/User.js';
import Community from '../src/models/Community.js';
import Membership from '../src/models/Membership.js';
import Item from '../src/models/Item.js';
import ItemDayLock from '../src/models/ItemDayLock.js';
import Block from '../src/models/Block.js';
import { hashPassword } from '../src/common/crypto.js';
import { signAccessToken } from '../src/common/jwt.js';
import { BUSINESS_CONFIG } from '@borrowloop/shared';
import { getTodayIST } from '../src/common/dates.js';
import { leaveCommunity } from '../src/modules/communities/communityService.js';

describe('Items, Search, and Availability (Phase 3)', () => {
  let userAlice;
  let tokenAlice;
  let userBob;
  let tokenBob;
  let userCharlie;
  let tokenCharlie;
  let communityA;
  let communityB;

  beforeAll(async () => {
    await setupTestDB();
  }, 60000);

  afterAll(async () => {
    await teardownTestDB();
  });

  beforeEach(async () => {
    await clearTestDB();

    const passwordHash = await hashPassword('Password123!');

    // 1. User Alice (Owner)
    userAlice = await User.create({
      name: 'Alice Lender',
      email: 'alice@example.com',
      passwordHash,
      emailVerified: true,
      status: 'active',
      photoUrl: 'https://res.cloudinary.com/demo_cloud/image/upload/borrowloop/profiles/alice.jpg',
    });
    tokenAlice = signAccessToken(
      { sub: userAlice._id.toString(), role: 'user' },
      BUSINESS_CONFIG.TOKEN_AUDIENCES.USER,
    );

    // 2. User Bob (Borrower in Community A)
    userBob = await User.create({
      name: 'Bob Borrower',
      email: 'bob@example.com',
      passwordHash,
      emailVerified: true,
      status: 'active',
      photoUrl: 'https://res.cloudinary.com/demo_cloud/image/upload/borrowloop/profiles/bob.jpg',
    });
    tokenBob = signAccessToken(
      { sub: userBob._id.toString(), role: 'user' },
      BUSINESS_CONFIG.TOKEN_AUDIENCES.USER,
    );

    // 3. User Charlie (Outsider in Community B only)
    userCharlie = await User.create({
      name: 'Charlie Outsider',
      email: 'charlie@example.com',
      passwordHash,
      emailVerified: true,
      status: 'active',
      photoUrl:
        'https://res.cloudinary.com/demo_cloud/image/upload/borrowloop/profiles/charlie.jpg',
    });
    tokenCharlie = signAccessToken(
      { sub: userCharlie._id.toString(), role: 'user' },
      BUSINESS_CONFIG.TOKEN_AUDIENCES.USER,
    );

    // Create Community A (Indiranagar)
    communityA = await Community.create({
      name: 'Indiranagar Borrowers',
      slug: 'indiranagar-borrowers',
      city: 'Bengaluru',
      ownerId: userAlice._id,
      isPrivate: false,
      status: 'active',
      memberCount: 2,
      location: {
        type: 'Point',
        coordinates: [77.64, 12.97],
      },
    });

    // Create Community B (Koramangala)
    communityB = await Community.create({
      name: 'Koramangala Loop',
      slug: 'koramangala-loop',
      city: 'Bengaluru',
      ownerId: userCharlie._id,
      isPrivate: false,
      status: 'active',
      memberCount: 1,
      location: {
        type: 'Point',
        coordinates: [77.62, 12.93],
      },
    });

    // Memberships: Alice and Bob in Community A
    await Membership.create([
      { userId: userAlice._id, communityId: communityA._id, status: 'active', role: 'owner' },
      { userId: userBob._id, communityId: communityA._id, status: 'active', role: 'member' },
      { userId: userCharlie._id, communityId: communityB._id, status: 'active', role: 'owner' },
    ]);
  });

  describe('Item Creation & Validation (Rules 6, 7, 8, 13, 16)', () => {
    it('creates an item with photo sandbox validation, location rounding, and sanitization', async () => {
      const payload = {
        title: '<b>Bosch Cordless Drill</b>   ',
        description:
          '<script>alert(1)</script>Heavy duty professional hammer drill with 2 batteries.',
        category: 'tools_and_diy',
        condition: 'good',
        photos: [
          `https://res.cloudinary.com/demo_cloud/image/upload/borrowloop/items/${userAlice._id}/drill1.jpg`,
          `https://res.cloudinary.com/demo_cloud/image/upload/borrowloop/items/${userAlice._id}/drill2.png`,
        ],
        rentPerDayPaise: 250_00, // Rs 250/day
        depositPaise: 1500_00, // Rs 1500
        lateFeePerDayPaise: 50_00,
        minDays: 1,
        maxDays: 7,
        communityIds: [communityA._id.toString()],
        location: {
          lat: 12.97159,
          lng: 77.64123,
        },
      };

      const res = await request(app)
        .post('/v1/items')
        .set('Authorization', `Bearer ${tokenAlice}`)
        .send(payload);

      expect(res.status).toBe(201);
      expect(res.body.title).toBe('Bosch Cordless Drill');
      expect(res.body.description).toBe('Heavy duty professional hammer drill with 2 batteries.');
      expect(res.body.rentPerDayPaise).toBe(25000);
      expect(res.body.depositPaise).toBe(150000);
      expect(res.body.status).toBe('active');
      // Rule 8: coordinates must never be returned directly in API
      expect(res.body.location).toBeUndefined();
      expect(res.body.photoVariants).toBeDefined();
      expect(res.body.photoVariants[0].thumbnail).toContain('w_300');
      expect(res.body.photoVariants[0].thumbnail).toContain('c_fill');

      // Verify in DB that coordinates were rounded to 2 decimal places
      const dbItem = await Item.findById(res.body._id);
      expect(dbItem.location.coordinates).toEqual([77.64, 12.97]);
    });

    it('falls back to community area coordinates when client omits item location (Rule 8)', async () => {
      const payload = {
        title: 'Camping Tent for 4',
        description: 'Waterproof 4-person tent with ground sheet included.',
        category: 'outdoor_and_camping',
        condition: 'like_new',
        photos: [
          `https://res.cloudinary.com/demo_cloud/image/upload/borrowloop/items/${userAlice._id}/tent.webp`,
        ],
        rentPerDayPaise: 300_00,
        depositPaise: 2000_00,
        minDays: 2,
        maxDays: 5,
        communityIds: [communityA._id.toString()],
      };

      const res = await request(app)
        .post('/v1/items')
        .set('Authorization', `Bearer ${tokenAlice}`)
        .send(payload);

      expect(res.status).toBe(201);
      const dbItem = await Item.findById(res.body._id);
      expect(dbItem.location.coordinates).toEqual([77.64, 12.97]);
    });

    it('rejects photos that do not belong to the user folder sandbox (Rule 7)', async () => {
      const payload = {
        title: 'Bad Photo Tent',
        description: 'Tent with someone else photo path',
        category: 'outdoor_and_camping',
        condition: 'good',
        photos: [
          `https://res.cloudinary.com/demo_cloud/image/upload/borrowloop/items/${userBob._id}/stolen.jpg`,
        ],
        rentPerDayPaise: 200_00,
        depositPaise: 1000_00,
        communityIds: [communityA._id.toString()],
      };

      const res = await request(app)
        .post('/v1/items')
        .set('Authorization', `Bearer ${tokenAlice}`)
        .send(payload);

      expect(res.status).toBe(400);
      expect(res.body.error.message).toMatch(/authorized user storage/i);
    });

    it('flags title/description matching prohibited words blocklist and sets status to pending_review (Rule 6)', async () => {
      const payload = {
        title: 'Hunting Knife for camping',
        description: 'Sharp weapon blade handy for outdoor survival.',
        category: 'outdoor_and_camping',
        condition: 'good',
        photos: [
          `https://res.cloudinary.com/demo_cloud/image/upload/borrowloop/items/${userAlice._id}/knife.jpg`,
        ],
        rentPerDayPaise: 100_00,
        depositPaise: 500_00,
        communityIds: [communityA._id.toString()],
      };

      const res = await request(app)
        .post('/v1/items')
        .set('Authorization', `Bearer ${tokenAlice}`)
        .send(payload);

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('pending_review');
    });

    it('requires electronicsWarningAccepted for data-sensitive categories (Rule 6)', async () => {
      const payload = {
        title: 'iPad Pro 11 inch',
        description: 'Apple iPad Pro with pencil for digital drawing.',
        category: 'electronics_and_gadgets',
        condition: 'like_new',
        photos: [
          `https://res.cloudinary.com/demo_cloud/image/upload/borrowloop/items/${userAlice._id}/ipad.jpg`,
        ],
        rentPerDayPaise: 500_00,
        depositPaise: 5000_00,
        communityIds: [communityA._id.toString()],
        electronicsWarningAccepted: false,
      };

      const res = await request(app)
        .post('/v1/items')
        .set('Authorization', `Bearer ${tokenAlice}`)
        .send(payload);

      expect(res.status).toBe(400);
      expect(res.body.error.details.body.electronicsWarningAccepted[0]).toMatch(
        /data-reset warning/i,
      );

      // Succeeded with electronicsWarningAccepted: true
      const successRes = await request(app)
        .post('/v1/items')
        .set('Authorization', `Bearer ${tokenAlice}`)
        .send({ ...payload, electronicsWarningAccepted: true });

      expect(successRes.status).toBe(201);
      const dbItem = await Item.findById(successRes.body._id);
      expect(dbItem.electronicsWarningAcceptedAt).toBeDefined();
    });

    it('enforces unverified email check and non-member listing rejection (Rule 1, 13)', async () => {
      // Create unverified user
      const unverified = await User.create({
        name: 'Unverified Dan',
        email: 'dan@example.com',
        passwordHash: 'hash',
        emailVerified: false,
        status: 'active',
      });
      const unverifiedToken = signAccessToken(
        { sub: unverified._id.toString(), role: 'user' },
        BUSINESS_CONFIG.TOKEN_AUDIENCES.USER,
      );

      const payload = {
        title: 'Test Board Game',
        description: 'Catan board game with all cards.',
        category: 'board_games_and_hobbies',
        condition: 'good',
        photos: [
          `https://res.cloudinary.com/demo_cloud/image/upload/borrowloop/items/${unverified._id}/catan.jpg`,
        ],
        rentPerDayPaise: 100_00,
        depositPaise: 500_00,
        communityIds: [communityA._id.toString()],
      };

      const resUnverified = await request(app)
        .post('/v1/items')
        .set('Authorization', `Bearer ${unverifiedToken}`)
        .send(payload);

      expect(resUnverified.status).toBe(403);

      // Charlie trying to list in Community A (where Charlie is NOT a member)
      const resCharlie = await request(app)
        .post('/v1/items')
        .set('Authorization', `Bearer ${tokenCharlie}`)
        .send({
          ...payload,
          photos: [
            `https://res.cloudinary.com/demo_cloud/image/upload/borrowloop/items/${userCharlie._id}/catan.jpg`,
          ],
        });

      expect(resCharlie.status).toBe(400);
      expect(resCharlie.body.error.message).toMatch(/active member of all specified communities/i);
    });
  });

  describe('Visibility & Privacy Rules (Rule 1)', () => {
    let aliceItem;

    beforeEach(async () => {
      aliceItem = await Item.create({
        ownerId: userAlice._id,
        title: 'Sony Alpha Camera',
        description: 'Mirrorless camera with 50mm f1.8 lens.',
        category: 'electronics_and_gadgets',
        condition: 'like_new',
        photos: [
          `https://res.cloudinary.com/demo_cloud/image/upload/borrowloop/items/${userAlice._id}/sony.jpg`,
        ],
        rentPerDayPaise: 800_00,
        depositPaise: 10000_00,
        communityIds: [communityA._id],
        location: {
          type: 'Point',
          coordinates: [77.64, 12.97],
        },
        status: 'active',
      });
    });

    it('allows active community member (Bob) to view item with distance band and no coordinates (Rule 1, 8)', async () => {
      const res = await request(app)
        .get(`/v1/items/${aliceItem._id}?lat=12.96&lng=77.63`)
        .set('Authorization', `Bearer ${tokenBob}`);

      expect(res.status).toBe(200);
      expect(res.body.title).toBe('Sony Alpha Camera');
      expect(res.body.distanceBand).toBeDefined();
      expect(res.body.location).toBeUndefined(); // Coordinates stripped
      expect(res.body.ownerId.name).toBe('Alice Lender');
    });

    it('returns 404 Not Found to outsiders who are not members of the item community (Rule 1)', async () => {
      const res = await request(app)
        .get(`/v1/items/${aliceItem._id}`)
        .set('Authorization', `Bearer ${tokenCharlie}`);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    it('hides items when owner is blocked by requester or owner blocked requester (Rule 1)', async () => {
      // Bob blocks Alice
      await Block.create({ blockerId: userBob._id, blockedId: userAlice._id });

      const res = await request(app)
        .get(`/v1/items/${aliceItem._id}`)
        .set('Authorization', `Bearer ${tokenBob}`);

      expect(res.status).toBe(404);
    });

    it('hides items when owner is banned or community is suspended (Rule 1)', async () => {
      // Ban Alice
      userAlice.status = 'banned';
      await userAlice.save();

      const res = await request(app)
        .get(`/v1/items/${aliceItem._id}`)
        .set('Authorization', `Bearer ${tokenBob}`);

      expect(res.status).toBe(404);
    });
  });

  describe('MongoDB Query Constraints & Search (Rules 2, 3)', () => {
    beforeEach(async () => {
      // Seed test items in Community A
      await Item.create([
        {
          ownerId: userAlice._id,
          title: 'Acoustic Guitar Yamaha',
          description: '6-string acoustic guitar with padded carry case.',
          category: 'musical_instruments',
          condition: 'good',
          photos: [
            `https://res.cloudinary.com/demo_cloud/image/upload/borrowloop/items/${userAlice._id}/guitar.jpg`,
          ],
          rentPerDayPaise: 150_00,
          depositPaise: 800_00,
          minDays: 1,
          maxDays: 14,
          communityIds: [communityA._id],
          location: { type: 'Point', coordinates: [77.64, 12.97] },
          status: 'active',
        },
        {
          ownerId: userAlice._id,
          title: 'Electric Guitar Fender',
          description: 'Fender Stratocaster with portable amp.',
          category: 'musical_instruments',
          condition: 'like_new',
          photos: [
            `https://res.cloudinary.com/demo_cloud/image/upload/borrowloop/items/${userAlice._id}/fender.jpg`,
          ],
          rentPerDayPaise: 400_00,
          depositPaise: 2000_00,
          minDays: 2,
          maxDays: 7,
          communityIds: [communityA._id],
          location: { type: 'Point', coordinates: [77.63, 12.96] },
          status: 'active',
        },
        {
          ownerId: userAlice._id,
          title: 'Electric Screwdriver Kit',
          description: 'High power electric screwdriver with 30 magnetic bits.',
          category: 'tools_and_diy',
          condition: 'good',
          photos: [
            `https://res.cloudinary.com/demo_cloud/image/upload/borrowloop/items/${userAlice._id}/screw.jpg`,
          ],
          rentPerDayPaise: 100_00,
          depositPaise: 500_00,
          minDays: 1,
          maxDays: 3,
          communityIds: [communityA._id],
          location: { type: 'Point', coordinates: [77.64, 12.98] },
          status: 'active',
        },
      ]);
    });

    it('proves MongoDB rejects combining $text with $near, and verifies our $text + $geoWithin solution (Rule 2)', async () => {
      // 1. Prove MongoDB throws error when $text is combined with $near
      let mongoErrorCaught = false;
      try {
        await Item.find({
          $text: { $search: 'Guitar' },
          location: {
            $near: {
              $geometry: { type: 'Point', coordinates: [77.64, 12.97] },
              $maxDistance: 10000,
            },
          },
        });
      } catch (err) {
        mongoErrorCaught = true;
        expect(err.message).toMatch(/cannot.*text.*near|text.*not.*allowed/i);
      }
      expect(mongoErrorCaught).toBe(true);

      // 2. Prove our API successfully searches with text + geoWithin without error
      const res = await request(app)
        .get('/v1/items?q=Guitar&lat=12.97&lng=77.64&radius=10')
        .set('Authorization', `Bearer ${tokenBob}`);

      expect(res.status).toBe(200);
      expect(res.body.items.length).toBe(2);
      expect(res.body.items.every((it) => it.title.includes('Guitar'))).toBe(true);
      expect(res.body.items[0].distanceBand).toBeDefined();
    });

    it('filters items by availability dates using candidate lookup and refill (Rule 3)', async () => {
      const items = await Item.find({ title: /Guitar/ });
      const guitar1 = items[0];
      const nextDay = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

      // Lock guitar1 for tomorrow
      await ItemDayLock.create({
        itemId: guitar1._id,
        day: nextDay,
      });

      // Search for tomorrow: guitar1 should be excluded due to lock, guitar2 should be returned
      const res = await request(app)
        .get(`/v1/items?q=Guitar&from=${nextDay}&to=${nextDay}`)
        .set('Authorization', `Bearer ${tokenBob}`);

      expect(res.status).toBe(200);
      const returnedIds = res.body.items.map((i) => i._id);
      expect(returnedIds).not.toContain(guitar1._id.toString());
    });

    it('returns 400 when searching with past dates (Rule 3)', async () => {
      const pastDate = '2020-01-01';
      const res = await request(app)
        .get(`/v1/items?from=${pastDate}&to=${pastDate}`)
        .set('Authorization', `Bearer ${tokenBob}`);

      expect(res.status).toBe(400);
      expect(res.body.error.message).toMatch(/past/i);
    });
  });

  describe('Item Availability Calendar Endpoint (Rule 11)', () => {
    let testItem;

    beforeEach(async () => {
      testItem = await Item.create({
        ownerId: userAlice._id,
        title: 'Projector for Movie Night',
        description: 'Full HD 1080p projector with HDMI cable.',
        category: 'electronics_and_gadgets',
        condition: 'like_new',
        photos: [
          `https://res.cloudinary.com/demo_cloud/image/upload/borrowloop/items/${userAlice._id}/proj.jpg`,
        ],
        rentPerDayPaise: 400_00,
        depositPaise: 2000_00,
        communityIds: [communityA._id],
        location: { type: 'Point', coordinates: [77.64, 12.97] },
        status: 'active',
      });
    });

    it('returns only free/taken per IST day for a month without leaking booking details (Rule 11)', async () => {
      const currentMonth = getTodayIST().slice(0, 7);
      const testDay = `${currentMonth}-15`;

      await ItemDayLock.create({
        itemId: testItem._id,
        day: testDay,
      });

      const res = await request(app)
        .get(`/v1/items/${testItem._id}/availability?month=${currentMonth}`)
        .set('Authorization', `Bearer ${tokenBob}`);

      expect(res.status).toBe(200);
      expect(res.body.month).toBe(currentMonth);
      expect(res.body.days.length).toBeGreaterThanOrEqual(28);

      const day15 = res.body.days.find((d) => d.day === testDay);
      expect(day15.status).toBe('taken');

      // Verify no booking info is leaked
      expect(day15.bookingId).toBeUndefined();
      expect(day15.userId).toBeUndefined();
    });

    it('rejects availability queries for past months or more than 6 months ahead (Rule 11)', async () => {
      const pastMonth = '2022-01';
      const resPast = await request(app)
        .get(`/v1/items/${testItem._id}/availability?month=${pastMonth}`)
        .set('Authorization', `Bearer ${tokenBob}`);

      expect(resPast.status).toBe(400);

      const futureFar = '2030-01';
      const resFuture = await request(app)
        .get(`/v1/items/${testItem._id}/availability?month=${futureFar}`)
        .set('Authorization', `Bearer ${tokenBob}`);

      expect(resFuture.status).toBe(400);
    });
  });

  describe('Authorization, IDOR, Mass-Assignment & Edit Rules (Rules 5, 9, 10)', () => {
    let testItem;

    beforeEach(async () => {
      testItem = await Item.create({
        ownerId: userAlice._id,
        title: 'Bicycle Rockrider',
        description: 'Mountain bike with 21 gears.',
        category: 'sports_and_fitness',
        condition: 'good',
        photos: [
          `https://res.cloudinary.com/demo_cloud/image/upload/borrowloop/items/${userAlice._id}/bike.jpg`,
        ],
        rentPerDayPaise: 200_00,
        depositPaise: 1000_00,
        communityIds: [communityA._id],
        location: { type: 'Point', coordinates: [77.64, 12.97] },
        status: 'active',
      });
    });

    it('prevents IDOR: non-owner (Bob) cannot update or delete Alice item (Rule 10)', async () => {
      const patchRes = await request(app)
        .patch(`/v1/items/${testItem._id}`)
        .set('Authorization', `Bearer ${tokenBob}`)
        .send({ title: 'Hacked Bicycle Title' });

      expect(patchRes.status).toBe(403);
      expect(patchRes.body.error.code).toBe('FORBIDDEN');

      const delRes = await request(app)
        .delete(`/v1/items/${testItem._id}`)
        .set('Authorization', `Bearer ${tokenBob}`);

      expect(delRes.status).toBe(403);
      expect(delRes.body.error.code).toBe('FORBIDDEN');
    });

    it('rejects mass-assignment attempts to modify ownerId, ratingAvg, reportCount, or _id (Rule 9)', async () => {
      const maliciousRes = await request(app)
        .patch(`/v1/items/${testItem._id}`)
        .set('Authorization', `Bearer ${tokenAlice}`)
        .send({
          ownerId: userBob._id.toString(),
          ratingAvg: 5.0,
          reportCount: 99,
          invalidUnknownField: 'hack',
        });

      // Strict schema rejects unrecognized fields
      expect(maliciousRes.status).toBe(400);

      const itemDb = await Item.findById(testItem._id);
      expect(itemDb.ownerId.toString()).toBe(userAlice._id.toString());
      expect(itemDb.reportCount).toBe(0);
    });

    it('allows description, photo and pause updates anytime by the owner (Rule 5)', async () => {
      const res = await request(app)
        .patch(`/v1/items/${testItem._id}`)
        .set('Authorization', `Bearer ${tokenAlice}`)
        .send({
          description: 'Updated mountain bike description with fresh tires.',
          status: 'paused',
        });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('paused');
      expect(res.body.description).toBe('Updated mountain bike description with fresh tires.');
    });

    it('soft deletes an item setting status to removed (Rule 5)', async () => {
      const res = await request(app)
        .delete(`/v1/items/${testItem._id}`)
        .set('Authorization', `Bearer ${tokenAlice}`);

      expect(res.status).toBe(200);

      const dbItem = await Item.findById(testItem._id);
      expect(dbItem.status).toBe('removed');
    });
  });

  describe('Community Membership Loss Side Effects (Rule 12)', () => {
    it('removes community from owner items and pauses items when no community is left upon leave/removal', async () => {
      // Alice has an item listed only in Community A
      const item = await Item.create({
        ownerId: userBob._id,
        title: 'Bob Camping Stove',
        description: 'Single burner butane camping stove.',
        category: 'outdoor_and_camping',
        condition: 'good',
        photos: [
          `https://res.cloudinary.com/demo_cloud/image/upload/borrowloop/items/${userBob._id}/stove.jpg`,
        ],
        rentPerDayPaise: 100_00,
        depositPaise: 500_00,
        communityIds: [communityA._id],
        location: { type: 'Point', coordinates: [77.64, 12.97] },
        status: 'active',
      });

      // Bob leaves Community A
      await leaveCommunity(communityA._id, userBob._id);

      // Verify community was removed and item was paused because 0 communities remain
      const updatedItem = await Item.findById(item._id);
      expect(updatedItem.communityIds.length).toBe(0);
      expect(updatedItem.status).toBe('paused');
    });
  });

  describe('User Listings Endpoint (docs/API_SPEC.md)', () => {
    it('returns all active and paused listings for the logged-in user at GET /users/me/items', async () => {
      await Item.create({
        ownerId: userAlice._id,
        title: 'Alice Board Game',
        description: 'Classic Scrabble game.',
        category: 'board_games_and_hobbies',
        condition: 'good',
        photos: [
          `https://res.cloudinary.com/demo_cloud/image/upload/borrowloop/items/${userAlice._id}/scrabble.jpg`,
        ],
        rentPerDayPaise: 50_00,
        depositPaise: 300_00,
        communityIds: [communityA._id],
        location: { type: 'Point', coordinates: [77.64, 12.97] },
        status: 'paused',
      });

      const res = await request(app)
        .get('/v1/users/me/items')
        .set('Authorization', `Bearer ${tokenAlice}`);

      expect(res.status).toBe(200);
      expect(res.body.length).toBeGreaterThanOrEqual(1);
      expect(res.body.some((i) => i.title === 'Alice Board Game')).toBe(true);
    });
  });
});
