/**
 * @file apps/api/src/modules/items/itemService.js
 * Business logic and database interactions for Items, Search, and Availability.
 */

import mongoose from 'mongoose';
import { AppError, ERROR_CODES, BUSINESS_CONFIG } from '@borrowloop/shared';
import Item from '../../models/Item.js';
import ItemDayLock from '../../models/ItemDayLock.js';
import Community from '../../models/Community.js';
import Membership from '../../models/Membership.js';
import Block from '../../models/Block.js';
import User from '../../models/User.js';
import { isValidCloudinaryPhotoUrl, buildCdnImageUrl } from '../../services/uploadService.js';
import { hasActiveBookings } from '../../services/bookingGuard.js';
import { runInTransaction, formatDistanceBand } from '../communities/communityService.js';
import {
  getTodayIST,
  getCurrentMonthIST,
  getDaysInRange,
  getMonthBounds,
  monthsDiff,
} from '../../common/dates.js';

/**
 * Calculates Haversine distance in meters between two coordinates.
 */
export function haversineDistanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371e3; // Earth radius in meters
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const deltaPhi = ((lat2 - lat1) * Math.PI) / 180;
  const deltaLambda = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

/**
 * Scans title and description for prohibited words.
 *
 * @param {string} title
 * @param {string} description
 * @returns {boolean} true if prohibited words found
 */
export function containsProhibitedWords(title, description) {
  const combined = `${title || ''} ${description || ''}`.toLowerCase();
  return BUSINESS_CONFIG.PROHIBITED_WORDS_BLOCKLIST.some((word) => {
    const regex = new RegExp(`\\b${word}\\b`, 'i');
    return regex.test(combined);
  });
}

/**
 * Formats an item document for public/member consumption:
 * Strips exact coordinates and attaches computed distance band and CDN variants.
 */
export function formatItemResponse(itemDoc, requesterCoords = null) {
  const obj = itemDoc.toObject ? itemDoc.toObject() : { ...itemDoc };

  let distanceBand = null;
  if (
    requesterCoords &&
    typeof requesterCoords.lat === 'number' &&
    typeof requesterCoords.lng === 'number' &&
    obj.location &&
    Array.isArray(obj.location.coordinates)
  ) {
    const [itemLng, itemLat] = obj.location.coordinates;
    const distanceMeters = haversineDistanceMeters(
      requesterCoords.lat,
      requesterCoords.lng,
      itemLat,
      itemLng,
    );
    distanceBand = formatDistanceBand(distanceMeters);
  }

  // Strict Privacy: Never expose coordinates
  delete obj.location;
  delete obj.__v;

  obj.distanceBand = distanceBand;

  // Attach CDN variant photos
  if (Array.isArray(obj.photos)) {
    obj.photoVariants = obj.photos.map((photo) => ({
      original: photo,
      thumbnail: buildCdnImageUrl(photo, { width: 300, height: 300, crop: 'fill' }),
      card: buildCdnImageUrl(photo, { width: 600, crop: 'limit' }),
    }));
  }

  return obj;
}

/**
 * Creates a new item listing.
 */
export async function createItem(user, itemData) {
  // 1. User verification & status checks (Rule 13)
  if (!user.emailVerified) {
    throw new AppError(
      ERROR_CODES.EMAIL_NOT_VERIFIED,
      'You must verify your email before listing an item',
      403,
    );
  }
  if (user.status !== 'active') {
    throw new AppError(ERROR_CODES.FORBIDDEN, 'Your account is not active', 403);
  }

  // 2. Active items limit check (Rule 13)
  const activeCount = await Item.countDocuments({
    ownerId: user._id,
    status: { $in: ['active', 'paused', 'pending_review'] },
  });
  if (activeCount >= BUSINESS_CONFIG.MAX_ACTIVE_ITEMS_PER_USER) {
    throw new AppError(
      ERROR_CODES.VALIDATION_ERROR,
      `You have reached the maximum limit of ${BUSINESS_CONFIG.MAX_ACTIVE_ITEMS_PER_USER} active items`,
      400,
    );
  }

  // 3. Photo validation (Rule 7: folder borrowloop/items/<userId>/)
  for (const photoUrl of itemData.photos) {
    const isValid = isValidCloudinaryPhotoUrl(photoUrl, 'item', user._id.toString());
    if (!isValid) {
      throw new AppError(
        ERROR_CODES.VALIDATION_ERROR,
        `Photo does not belong to authorized user storage: ${photoUrl}`,
        400,
      );
    }
  }

  // 4. Communities validation (Rule 1)
  const activeMemberships = await Membership.find({
    userId: user._id,
    communityId: { $in: itemData.communityIds },
    status: 'active',
  });
  if (activeMemberships.length !== itemData.communityIds.length) {
    throw new AppError(
      ERROR_CODES.VALIDATION_ERROR,
      'You must be an active member of all specified communities to list an item in them',
      400,
    );
  }

  const communities = await Community.find({
    _id: { $in: itemData.communityIds },
    status: 'active',
  });
  if (communities.length !== itemData.communityIds.length) {
    throw new AppError(
      ERROR_CODES.VALIDATION_ERROR,
      'One or more specified communities are suspended or unavailable',
      400,
    );
  }

  // 5. Prohibited words check -> sets status to pending_review (Rule 6)
  const isSuspicious = containsProhibitedWords(itemData.title, itemData.description);
  const initialStatus = isSuspicious ? 'pending_review' : 'active';

  // 6. Data-sensitive categories check (Rule 6)
  let electronicsWarningAcceptedAt = null;
  if (BUSINESS_CONFIG.DATA_SENSITIVE_CATEGORIES.includes(itemData.category)) {
    if (!itemData.electronicsWarningAccepted) {
      throw new AppError(
        ERROR_CODES.VALIDATION_ERROR,
        'You must acknowledge the data-reset warning for electronics and storage devices',
        400,
      );
    }
    electronicsWarningAcceptedAt = new Date();
  }

  // 7. Location rounding and fallback to community area (Rule 8)
  let coordinates;
  if (
    itemData.location &&
    typeof itemData.location.lat === 'number' &&
    typeof itemData.location.lng === 'number'
  ) {
    coordinates = [
      Number(itemData.location.lng.toFixed(2)),
      Number(itemData.location.lat.toFixed(2)),
    ];
  } else {
    // Fall back to primary community's location
    coordinates = communities[0].location.coordinates;
  }

  return runInTransaction(async (session) => {
    const [item] = await Item.create(
      [
        {
          ownerId: user._id,
          title: itemData.title,
          description: itemData.description,
          category: itemData.category,
          condition: itemData.condition,
          photos: itemData.photos,
          rentPerDayPaise: itemData.rentPerDayPaise,
          depositPaise: itemData.depositPaise,
          lateFeePerDayPaise: itemData.lateFeePerDayPaise || 0,
          minDays: itemData.minDays || BUSINESS_CONFIG.MIN_BOOKING_DAYS,
          maxDays: itemData.maxDays || BUSINESS_CONFIG.MAX_BOOKING_DAYS,
          communityIds: itemData.communityIds,
          location: {
            type: 'Point',
            coordinates,
          },
          status: initialStatus,
          electronicsWarningAcceptedAt,
        },
      ],
      { session },
    );

    return formatItemResponse(item);
  });
}

/**
 * Updates an item listing with whitelist verification and booking conflict guards.
 */
export async function updateItem(user, itemId, updateData) {
  const item = await Item.findById(itemId);
  if (!item || item.status === 'removed') {
    throw new AppError(ERROR_CODES.NOT_FOUND, 'Item not found', 404);
  }

  // Owner check (Rule 10 IDOR prevention)
  if (item.ownerId.toString() !== user._id.toString()) {
    throw new AppError(
      ERROR_CODES.FORBIDDEN,
      'You do not have permission to modify this item',
      403,
    );
  }

  // Check active booking status (Rule 5)
  const isBookingActive = await hasActiveBookings(item._id);

  const restrictedFields = [
    'rentPerDayPaise',
    'depositPaise',
    'lateFeePerDayPaise',
    'minDays',
    'maxDays',
    'communityIds',
    'category',
    'condition',
    'location',
  ];

  if (isBookingActive) {
    for (const field of restrictedFields) {
      if (updateData[field] !== undefined) {
        throw new AppError(
          ERROR_CODES.CONFLICT,
          `Cannot modify ${field} while an active booking is in progress`,
          409,
        );
      }
    }
  }

  // Photo validation if updating photos
  if (updateData.photos) {
    for (const photoUrl of updateData.photos) {
      const isValid = isValidCloudinaryPhotoUrl(photoUrl, 'item', user._id.toString());
      if (!isValid) {
        throw new AppError(
          ERROR_CODES.VALIDATION_ERROR,
          `Photo does not belong to authorized user storage: ${photoUrl}`,
          400,
        );
      }
    }
    item.photos = updateData.photos;
  }

  // Community validation if updating communities
  if (updateData.communityIds) {
    const activeMemberships = await Membership.find({
      userId: user._id,
      communityId: { $in: updateData.communityIds },
      status: 'active',
    });
    if (activeMemberships.length !== updateData.communityIds.length) {
      throw new AppError(
        ERROR_CODES.VALIDATION_ERROR,
        'You must be an active member of all specified communities',
        400,
      );
    }
    item.communityIds = updateData.communityIds;
  }

  if (updateData.title !== undefined) item.title = updateData.title;
  if (updateData.description !== undefined) item.description = updateData.description;
  if (updateData.category !== undefined) item.category = updateData.category;
  if (updateData.condition !== undefined) item.condition = updateData.condition;
  if (updateData.rentPerDayPaise !== undefined) item.rentPerDayPaise = updateData.rentPerDayPaise;
  if (updateData.depositPaise !== undefined) item.depositPaise = updateData.depositPaise;
  if (updateData.lateFeePerDayPaise !== undefined)
    item.lateFeePerDayPaise = updateData.lateFeePerDayPaise;
  if (updateData.minDays !== undefined) item.minDays = updateData.minDays;
  if (updateData.maxDays !== undefined) item.maxDays = updateData.maxDays;

  // Status toggle (only active or paused)
  if (updateData.status && ['active', 'paused'].includes(updateData.status)) {
    item.status = updateData.status;
  }

  // Prohibited words check
  if (updateData.title || updateData.description) {
    if (containsProhibitedWords(item.title, item.description)) {
      item.status = 'pending_review';
    }
  }

  if (updateData.location) {
    item.location = {
      type: 'Point',
      coordinates: [
        Number(updateData.location.lng.toFixed(2)),
        Number(updateData.location.lat.toFixed(2)),
      ],
    };
  }

  await item.save();
  return formatItemResponse(item);
}

/**
 * Deletes (soft-deletes) an item listing.
 */
export async function deleteItem(user, itemId) {
  const item = await Item.findById(itemId);
  if (!item || item.status === 'removed') {
    throw new AppError(ERROR_CODES.NOT_FOUND, 'Item not found', 404);
  }

  // Owner check (Rule 10)
  if (item.ownerId.toString() !== user._id.toString()) {
    throw new AppError(
      ERROR_CODES.FORBIDDEN,
      'You do not have permission to delete this item',
      403,
    );
  }

  // Active booking check (Rule 5)
  const isBookingActive = await hasActiveBookings(item._id);
  if (isBookingActive) {
    throw new AppError(
      ERROR_CODES.CONFLICT,
      'Cannot delete an item while an active booking is in progress',
      409,
    );
  }

  item.status = 'removed';
  await item.save();
  return { success: true };
}

/**
 * Gets details of a single item, enforcing visibility rules.
 */
export async function getItemById(requesterUser, itemId, requesterCoords = null) {
  const item = await Item.findById(itemId)
    .populate('ownerId', 'name photoUrl trustScore ratingAvg ratingCount status')
    .populate('communityIds', 'name city status');

  if (!item || item.status === 'removed') {
    throw new AppError(ERROR_CODES.NOT_FOUND, 'Item not found', 404);
  }

  const isOwner = requesterUser && item.ownerId._id.toString() === requesterUser._id.toString();

  // If item is pending_review, hidden, or paused, only the owner can see it
  if (!isOwner && item.status !== 'active') {
    throw new AppError(ERROR_CODES.NOT_FOUND, 'Item not found', 404);
  }

  // Check owner status (Rule 1)
  if (!isOwner && item.ownerId.status !== 'active') {
    throw new AppError(ERROR_CODES.NOT_FOUND, 'Item not found', 404);
  }

  // Check if owner or requester is blocked (Rule 1)
  if (!isOwner && requesterUser) {
    const isBlocked = await Block.exists({
      $or: [
        { blockerId: requesterUser._id, blockedId: item.ownerId._id },
        { blockerId: item.ownerId._id, blockedId: requesterUser._id },
      ],
    });
    if (isBlocked) {
      throw new AppError(ERROR_CODES.NOT_FOUND, 'Item not found', 404);
    }
  }

  // Visibility Rule (Rule 1): Item is visible ONLY to active members of its active communities
  if (!isOwner) {
    if (!requesterUser) {
      throw new AppError(ERROR_CODES.NOT_FOUND, 'Item not found', 404);
    }

    const activeCommunityIds = item.communityIds
      .filter((c) => c.status === 'active')
      .map((c) => c._id);

    if (activeCommunityIds.length === 0) {
      throw new AppError(ERROR_CODES.NOT_FOUND, 'Item not found', 404);
    }

    const isMember = await Membership.exists({
      userId: requesterUser._id,
      communityId: { $in: activeCommunityIds },
      status: 'active',
    });

    if (!isMember) {
      throw new AppError(ERROR_CODES.NOT_FOUND, 'Item not found', 404);
    }
  }

  return formatItemResponse(item, requesterCoords);
}

/**
 * Searches and browses items across communities where requester is an active member.
 */
export async function searchItems(requesterUser, queryParams) {
  // 1. Find requester's active community memberships
  const memberships = await Membership.find(
    { userId: requesterUser._id, status: 'active' },
    'communityId',
  );
  const joinedCommunityIds = memberships.map((m) => m.communityId);

  // Filter to active (non-suspended, non-deleted) communities
  const activeCommunities = await Community.find(
    { _id: { $in: joinedCommunityIds }, status: 'active' },
    '_id',
  );
  const eligibleCommunityIds = activeCommunities.map((c) => c._id);

  if (eligibleCommunityIds.length === 0) {
    return { items: [], nextCursor: null };
  }

  // 2. Exclude blocked users (Rule 1)
  const blocks = await Block.find({
    $or: [{ blockerId: requesterUser._id }, { blockedId: requesterUser._id }],
  });
  const blockedUserIds = blocks.map((b) =>
    b.blockerId.equals(requesterUser._id) ? b.blockedId : b.blockerId,
  );

  // 3. Exclude banned or inactive owners
  const inactiveUsers = await User.find({ status: { $ne: 'active' } }, '_id');
  const excludedOwnerIds = [...blockedUserIds, ...inactiveUsers.map((u) => u._id)];

  // 4. Build base MongoDB filter
  const filter = {
    status: 'active',
    ownerId: { $nin: excludedOwnerIds },
  };

  // Specific community filter or all joined eligible communities
  if (queryParams.communityId) {
    const isEligible = eligibleCommunityIds.some((id) => id.toString() === queryParams.communityId);
    if (!isEligible) {
      return { items: [], nextCursor: null };
    }
    filter.communityIds = queryParams.communityId;
  } else {
    filter.communityIds = { $in: eligibleCommunityIds };
  }

  if (queryParams.category) {
    filter.category = queryParams.category;
  }

  if (queryParams.minPrice !== undefined || queryParams.maxPrice !== undefined) {
    filter.rentPerDayPaise = {};
    if (queryParams.minPrice !== undefined) filter.rentPerDayPaise.$gte = queryParams.minPrice;
    if (queryParams.maxPrice !== undefined) filter.rentPerDayPaise.$lte = queryParams.maxPrice;
  }

  // 5. Geospatial + Text Search (Rule 2: $text + $geoWithin centerSphere)
  const hasTextQuery = Boolean(queryParams.q && queryParams.q.trim());
  if (hasTextQuery) {
    filter.$text = { $search: queryParams.q.trim() };
  }

  const hasGeoQuery = typeof queryParams.lat === 'number' && typeof queryParams.lng === 'number';
  if (hasGeoQuery) {
    const radiusKm = queryParams.radius || BUSINESS_CONFIG.DEFAULT_SEARCH_RADIUS_KM;
    const radiusInRadians = radiusKm / 6378.1;
    filter.location = {
      $geoWithin: {
        $centerSphere: [[queryParams.lng, queryParams.lat], radiusInRadians],
      },
    };
  }

  // 6. Date filtering constraints on minDays / maxDays (Rule 3)
  let requestedDays = [];
  if (queryParams.from && queryParams.to) {
    const todayIST = getTodayIST();
    if (queryParams.from < todayIST) {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Cannot search for dates in the past', 400);
    }
    requestedDays = getDaysInRange(queryParams.from, queryParams.to);
    const daysCount = requestedDays.length;

    filter.minDays = { $lte: daysCount };
    filter.maxDays = { $gte: daysCount };
  }

  // 7. Pagination Cursor & Sort
  const limit = queryParams.limit || BUSINESS_CONFIG.DEFAULT_PAGE_LIMIT;
  let sortCriteria = { createdAt: -1, _id: -1 };

  if (queryParams.cursor) {
    try {
      const decoded = JSON.parse(Buffer.from(queryParams.cursor, 'base64').toString('utf8'));
      if (decoded.createdAt && decoded._id) {
        filter.$or = [
          { createdAt: { $lt: new Date(decoded.createdAt) } },
          {
            createdAt: new Date(decoded.createdAt),
            _id: { $lt: new mongoose.Types.ObjectId(decoded._id) },
          },
        ];
      }
    } catch {
      // Invalid cursor ignored
    }
  }

  // 8. Date candidate query and refill loop (Rule 3)
  const candidateBatchSize = limit * 2;
  const availableItems = [];
  let currentFilter = { ...filter };
  let lastEvaluatedItem = null;
  let hasMore = true;

  const requesterCoords = hasGeoQuery ? { lat: queryParams.lat, lng: queryParams.lng } : null;

  while (availableItems.length < limit && hasMore) {
    const candidates = await Item.find(currentFilter)
      .sort(sortCriteria)
      .limit(candidateBatchSize)
      .populate('ownerId', 'name photoUrl trustScore');

    if (candidates.length === 0) {
      hasMore = false;
      break;
    }

    if (candidates.length < candidateBatchSize) {
      hasMore = false;
    }

    // Check date locks for all candidate items in one single query (Rule 3)
    let candidateLockedIds = new Set();
    if (requestedDays.length > 0) {
      const candidateIds = candidates.map((c) => c._id);
      const lockedRecords = await ItemDayLock.find(
        {
          itemId: { $in: candidateIds },
          day: { $in: requestedDays },
        },
        'itemId',
      );
      candidateLockedIds = new Set(lockedRecords.map((r) => r.itemId.toString()));
    }

    for (const item of candidates) {
      lastEvaluatedItem = item;
      if (!candidateLockedIds.has(item._id.toString())) {
        availableItems.push(formatItemResponse(item, requesterCoords));
        if (availableItems.length === limit) {
          break;
        }
      }
    }

    if (hasMore && availableItems.length < limit && lastEvaluatedItem) {
      currentFilter = {
        ...filter,
        $or: [
          { createdAt: { $lt: lastEvaluatedItem.createdAt } },
          { createdAt: lastEvaluatedItem.createdAt, _id: { $lt: lastEvaluatedItem._id } },
        ],
      };
    }
  }

  let nextCursor = null;
  if (lastEvaluatedItem && (hasMore || availableItems.length === limit)) {
    nextCursor = Buffer.from(
      JSON.stringify({
        createdAt: lastEvaluatedItem.createdAt.toISOString(),
        _id: lastEvaluatedItem._id.toString(),
      }),
    ).toString('base64');
  }

  return {
    items: availableItems,
    nextCursor,
  };
}

/**
 * Returns item calendar availability per IST day for a requested month.
 * Strictly returns only free/taken per day without leaking booking information (Rule 11).
 */
export async function getItemAvailability(requesterUser, itemId, monthStr) {
  // 1. Month validation and range limits
  const currentMonth = getCurrentMonthIST();
  const diff = monthsDiff(currentMonth, monthStr);

  if (diff < 0) {
    throw new AppError(
      ERROR_CODES.VALIDATION_ERROR,
      'Cannot query availability for past months',
      400,
    );
  }
  if (diff > BUSINESS_CONFIG.AVAILABILITY_MAX_MONTHS_AHEAD) {
    throw new AppError(
      ERROR_CODES.VALIDATION_ERROR,
      `Cannot query availability more than ${BUSINESS_CONFIG.AVAILABILITY_MAX_MONTHS_AHEAD} months in advance`,
      400,
    );
  }

  // 2. Item existence and visibility check
  const item = await Item.findById(itemId);
  if (!item || item.status === 'removed') {
    throw new AppError(ERROR_CODES.NOT_FOUND, 'Item not found', 404);
  }

  const isOwner = requesterUser && item.ownerId.toString() === requesterUser._id.toString();
  if (!isOwner) {
    if (item.status !== 'active') {
      throw new AppError(ERROR_CODES.NOT_FOUND, 'Item not found', 404);
    }
    const isMember = await Membership.exists({
      userId: requesterUser._id,
      communityId: { $in: item.communityIds },
      status: 'active',
    });
    if (!isMember) {
      throw new AppError(ERROR_CODES.NOT_FOUND, 'Item not found', 404);
    }
  }

  // 3. Query locks for the month
  const { startDay, endDay, totalDays } = getMonthBounds(monthStr);
  const locks = await ItemDayLock.find({
    itemId: item._id,
    day: { $gte: startDay, $lte: endDay },
  });

  const lockedDaysSet = new Set(locks.map((l) => l.day));
  const todayIST = getTodayIST();

  const days = [];
  for (let d = 1; d <= totalDays; d++) {
    const dayStr = `${monthStr}-${String(d).padStart(2, '0')}`;
    const isPast = dayStr < todayIST;
    const isLocked = lockedDaysSet.has(dayStr);

    days.push({
      day: dayStr,
      status: isPast || isLocked ? 'taken' : 'free',
    });
  }

  return {
    month: monthStr,
    days,
  };
}

/**
 * Returns all listings owned by the authenticated user.
 */
export async function getUserItems(userId) {
  const items = await Item.find({
    ownerId: userId,
    status: { $ne: 'removed' },
  }).sort({ createdAt: -1 });

  return items.map((item) => formatItemResponse(item));
}

/**
 * Cleanup hook when an owner leaves or is removed from a community (Rule 12).
 * Removes the community from their items; pauses items with no active communities left
 * unless an active booking is currently underway.
 */
export async function handleCommunityMembershipLoss(userId, communityId, session = null) {
  const items = await Item.find({
    ownerId: userId,
    communityIds: communityId,
    status: { $ne: 'removed' },
  }).session(session);

  for (const item of items) {
    item.communityIds = item.communityIds.filter(
      (cId) => cId.toString() !== communityId.toString(),
    );

    if (item.communityIds.length === 0) {
      const activeBooking = await hasActiveBookings(item._id, session);
      if (!activeBooking) {
        item.status = 'paused';
      }
    }

    await item.save({ session });
  }
}
