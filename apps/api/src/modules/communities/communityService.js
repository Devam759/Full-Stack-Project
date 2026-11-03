import crypto from 'crypto';
import mongoose from 'mongoose';
import { AppError, ERROR_CODES, BUSINESS_CONFIG } from '@borrowloop/shared';
import Community from '../../models/Community.js';
import Membership from '../../models/Membership.js';
import Block from '../../models/Block.js';

/**
 * Calculates human-readable distance bands to preserve location privacy.
 * @param {number} distanceMeters
 * @returns {string} e.g. "< 1 km", "~2 km", "~5 km"
 */
export function formatDistanceBand(distanceMeters) {
  const km = distanceMeters / 1000;
  if (km < 1) return '< 1 km';
  if (km <= 2) return '~2 km';
  if (km <= 5) return '~5 km';
  if (km <= 10) return '~10 km';
  return `~${Math.round(km)} km`;
}

/**
 * Generates an 8+ character random alphanumeric invite code.
 */
export function generateInviteCode(length = BUSINESS_CONFIG.COMMUNITY_INVITE_CODE_LENGTH) {
  return crypto.randomBytes(length).toString('base64url').slice(0, length).toUpperCase();
}

/**
 * Escapes regex special characters to prevent ReDoS / injection in text searches.
 */
export function escapeRegex(text) {
  return text.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
}

/**
 * Executes a callback within a MongoDB transaction, automatically retrying on WriteConflict
 * (TransientTransactionError) under high concurrency.
 */
export async function runInTransaction(workFn, maxRetries = 30) {
  let attempts = 0;
  while (attempts < maxRetries) {
    attempts++;
    const session = await mongoose.startSession();
    try {
      let result;
      await session.withTransaction(async () => {
        result = await workFn(session);
      });
      return result;
    } catch (err) {
      const isTransient =
        err.hasErrorLabel?.('TransientTransactionError') ||
        err.errorLabels?.includes?.('TransientTransactionError') ||
        err.message?.includes('Write conflict') ||
        err.message?.includes('WriteConflict') ||
        err.code === 112;
      if (isTransient && attempts < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, Math.floor(Math.random() * 80 + 20)));
        continue;
      }
      throw err;
    } finally {
      await session.endSession();
    }
  }
}
export function notifyCommunityOwner(_ownerId, _communityId, _requesterId) {
  // Stuffed for Phase 6 Notification service
}

/**
 * Searches for communities nearby within radius using MongoDB $nearSphere.
 * Enforces privacy: private communities only show name, city, member count to outsiders.
 */
export async function getNearbyCommunities({ lat, lng, radius = 10000, userId }) {
  const communities = await Community.find({
    status: 'active',
    location: {
      $nearSphere: {
        $geometry: {
          type: 'Point',
          coordinates: [lng, lat],
        },
        $maxDistance: Math.min(radius, 50000), // Max 50km
      },
    },
  })
    .limit(BUSINESS_CONFIG.MAX_NEARBY_COMMUNITIES)
    .lean();

  if (communities.length === 0) return [];

  // One single query to check current user's membership status across all returned communities
  let userMembershipsMap = new Map();
  if (userId) {
    const communityIds = communities.map((c) => c._id);
    const memberships = await Membership.find({
      userId,
      communityId: { $in: communityIds },
    }).lean();

    userMembershipsMap = new Map(memberships.map((m) => [m.communityId.toString(), m]));
  }

  // Calculate distance bands & apply privacy filtering
  return communities.map((comm) => {
    const commLng = comm.location.coordinates[0];
    const commLat = comm.location.coordinates[1];

    // Haversine distance in meters
    const R = 6371e3;
    const phi1 = (lat * Math.PI) / 180;
    const phi2 = (commLat * Math.PI) / 180;
    const deltaPhi = ((commLat - lat) * Math.PI) / 180;
    const deltaLambda = ((commLng - lng) * Math.PI) / 180;
    const a =
      Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
      Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distMeters = R * c;

    const userMembership = userMembershipsMap.get(comm._id.toString());
    const isMember = userMembership && userMembership.status === 'active';

    const basePayload = {
      id: comm._id,
      name: comm.name,
      slug: comm.slug,
      city: comm.city,
      type: comm.type,
      memberCount: comm.memberCount,
      distanceBand: formatDistanceBand(distMeters),
      membershipStatus: userMembership ? userMembership.status : 'none',
      userRole: userMembership?.role || null,
    };

    // Private community outsiders do not see description or exact location
    if (comm.type === 'private' && !isMember) {
      return basePayload;
    }

    return {
      ...basePayload,
      description: comm.description,
      location: {
        type: 'Point',
        coordinates: [Math.round(commLng * 100) / 100, Math.round(commLat * 100) / 100],
      },
    };
  });
}

/**
 * Searches communities by text with cursor-based pagination.
 */
export async function searchCommunities({ q, city, cursor, limit = 20, userId }) {
  const query = { status: 'active' };

  if (cursor) {
    query._id = { $gt: new mongoose.Types.ObjectId(cursor) };
  }

  if (city) {
    query.city = new RegExp(`^${escapeRegex(city)}$`, 'i');
  }

  if (q) {
    query.$text = { $search: q };
  }

  const communities = await Community.find(query)
    .sort({ _id: 1 })
    .limit(limit + 1)
    .lean();

  const hasNextPage = communities.length > limit;
  const results = hasNextPage ? communities.slice(0, limit) : communities;
  const nextCursor = hasNextPage ? results[results.length - 1]._id.toString() : null;

  let userMembershipsMap = new Map();
  if (userId && results.length > 0) {
    const ids = results.map((c) => c._id);
    const memberships = await Membership.find({ userId, communityId: { $in: ids } }).lean();
    userMembershipsMap = new Map(memberships.map((m) => [m.communityId.toString(), m]));
  }

  const items = results.map((comm) => {
    const userMembership = userMembershipsMap.get(comm._id.toString());
    const isMember = userMembership && userMembership.status === 'active';

    const base = {
      id: comm._id,
      name: comm.name,
      slug: comm.slug,
      city: comm.city,
      type: comm.type,
      memberCount: comm.memberCount,
      membershipStatus: userMembership ? userMembership.status : 'none',
      userRole: userMembership?.role || null,
    };

    if (comm.type === 'private' && !isMember) {
      return base;
    }

    return {
      ...base,
      description: comm.description,
    };
  });

  return { items, nextCursor };
}

/**
 * Fetches community detail by ID.
 */
export async function getCommunityDetail(communityId, userId) {
  const community = await Community.findOne({
    _id: communityId,
    status: { $ne: 'deleted' },
  }).select('+inviteCode');

  if (!community) {
    throw new AppError(ERROR_CODES.NOT_FOUND, 'Community not found', 404);
  }

  let membership = null;
  if (userId) {
    membership = await Membership.findOne({ communityId, userId }).lean();
  }

  const isMember = membership && membership.status === 'active';
  const isOwner = userId && community.ownerId.toString() === userId.toString();

  const baseDetail = {
    id: community._id,
    name: community.name,
    slug: community.slug,
    city: community.city,
    type: community.type,
    memberCount: community.memberCount,
    status: community.status,
    createdAt: community.createdAt,
    membershipStatus: membership ? membership.status : 'none',
    userRole: membership?.role || null,
  };

  if (isOwner) {
    baseDetail.inviteCode = community.inviteCode;
  }

  // Private community outsiders do not see description or map coordinates
  if (community.type === 'private' && !isMember && !isOwner) {
    return baseDetail;
  }

  return {
    ...baseDetail,
    description: community.description,
    location: {
      type: 'Point',
      coordinates: [
        Math.round(community.location.coordinates[0] * 100) / 100,
        Math.round(community.location.coordinates[1] * 100) / 100,
      ],
    },
  };
}

/**
 * Creates a new community. Enforces email verification, max created limit, and transaction.
 */
export async function createCommunity({ userId, name, description, type, location, city }) {
  // Check limit on created communities
  const createdCount = await Community.countDocuments({
    ownerId: userId,
    status: { $ne: 'deleted' },
  });
  if (createdCount >= BUSINESS_CONFIG.MAX_COMMUNITIES_CREATED) {
    throw new AppError(
      ERROR_CODES.BAD_REQUEST,
      `You cannot create more than ${BUSINESS_CONFIG.MAX_COMMUNITIES_CREATED} communities`,
      400,
    );
  }

  // Generate unique slug
  const baseSlug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  let slug = baseSlug;
  const existingSlug = await Community.findOne({ slug });
  if (existingSlug) {
    slug = `${baseSlug}-${Date.now().toString().slice(-4)}`;
  }

  // Round coordinates to 2 decimals for location privacy
  const [lng, lat] = location.coordinates;
  const roundedCoordinates = [Math.round(lng * 100) / 100, Math.round(lat * 100) / 100];

  const inviteCode = type === 'private' ? generateInviteCode() : undefined;

  // Run inside MongoDB transaction
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const community = await Community.create(
      [
        {
          name,
          slug,
          description,
          type,
          ownerId: userId,
          location: { type: 'Point', coordinates: roundedCoordinates },
          city,
          memberCount: 1,
          inviteCode,
          status: 'active',
        },
      ],
      { session },
    );

    await Membership.create(
      [
        {
          communityId: community[0]._id,
          userId,
          role: 'owner',
          status: 'active',
          joinedAt: new Date(),
        },
      ],
      { session },
    );

    await session.commitTransaction();
    return community[0];
  } catch (err) {
    await session.abortTransaction();
    if (err.code === 11000) {
      throw new AppError(ERROR_CODES.CONFLICT, 'A community with this name already exists', 409);
    }
    throw err;
  } finally {
    await session.endSession();
  }
}

/**
 * Joins a community. Runs in a MongoDB transaction with automatic TransientTransactionError retries.
 * Instant for public; requires invite code or pending approval for private.
 */
export async function joinCommunity({ communityId, userId, inviteCode }) {
  return runInTransaction(async (session) => {
    const community = await Community.findById(communityId).select('+inviteCode').session(session);

    if (!community || community.status !== 'active') {
      throw new AppError(ERROR_CODES.NOT_FOUND, 'Community not found or inactive', 404);
    }

    const existingMembership = await Membership.findOne({ communityId, userId }).session(session);

    if (existingMembership) {
      if (existingMembership.status === 'active') {
        throw new AppError(ERROR_CODES.CONFLICT, 'You are already a member of this community', 409);
      }
      if (existingMembership.status === 'pending') {
        throw new AppError(
          ERROR_CODES.CONFLICT,
          'Your join request is already pending approval',
          409,
        );
      }

      // Check 24-hour cooldown after rejection
      if (existingMembership.rejectedAt) {
        const cooldownMs = BUSINESS_CONFIG.COMMUNITY_REQUEST_COOLDOWN_SECONDS * 1000;
        const elapsed = Date.now() - new Date(existingMembership.rejectedAt).getTime();
        if (elapsed < cooldownMs) {
          const remainingHours = Math.ceil((cooldownMs - elapsed) / (1000 * 60 * 60));
          throw new AppError(
            ERROR_CODES.FORBIDDEN,
            `Please wait ${remainingHours} hour(s) before requesting to join again`,
            403,
          );
        }
      } else if (existingMembership.status === 'removed') {
        throw new AppError(
          ERROR_CODES.FORBIDDEN,
          'You were removed by the community owner and cannot re-join',
          403,
        );
      }
    }

    // Check max communities joined
    const activeJoined = await Membership.countDocuments({ userId, status: 'active' }).session(
      session,
    );
    if (activeJoined >= BUSINESS_CONFIG.MAX_COMMUNITIES_JOINED) {
      throw new AppError(
        ERROR_CODES.BAD_REQUEST,
        `You cannot join more than ${BUSINESS_CONFIG.MAX_COMMUNITIES_JOINED} communities`,
        400,
      );
    }

    let status = 'active';
    let isIncrement = true;

    if (community.type === 'private') {
      if (inviteCode && inviteCode.trim().toUpperCase() === community.inviteCode) {
        status = 'active';
      } else if (inviteCode) {
        throw new AppError(ERROR_CODES.FORBIDDEN, 'Invalid invite code for private community', 403);
      } else {
        // Submit request for owner approval
        status = 'pending';
        isIncrement = false;
        notifyCommunityOwner(community.ownerId, community._id, userId);
      }
    }

    if (existingMembership) {
      existingMembership.status = status;
      existingMembership.rejectedAt = null;
      if (status === 'active') existingMembership.joinedAt = new Date();
      await existingMembership.save({ session });
    } else {
      await Membership.create(
        [
          {
            communityId,
            userId,
            role: 'member',
            status,
            joinedAt: status === 'active' ? new Date() : null,
          },
        ],
        { session },
      );
    }

    if (isIncrement) {
      await Community.updateOne({ _id: communityId }, { $inc: { memberCount: 1 } }, { session });
    }

    return {
      status,
      message:
        status === 'active'
          ? 'Joined community successfully'
          : 'Request submitted to community owner for approval',
    };
  });
}

/**
 * Leaves a community. Runs in a MongoDB transaction.
 */
export async function leaveCommunity(communityId, userId) {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const community = await Community.findById(communityId).session(session);
    if (!community) {
      throw new AppError(ERROR_CODES.NOT_FOUND, 'Community not found', 404);
    }

    if (community.ownerId.toString() === userId.toString()) {
      throw new AppError(
        ERROR_CODES.BAD_REQUEST,
        'As the owner, you cannot leave the community. Transfer ownership or delete it.',
        400,
      );
    }

    const membership = await Membership.findOneAndDelete({ communityId, userId }).session(session);
    if (!membership || membership.status !== 'active') {
      throw new AppError(
        ERROR_CODES.BAD_REQUEST,
        'You are not an active member of this community',
        400,
      );
    }

    community.memberCount = Math.max(0, community.memberCount - 1);
    await community.save({ session });

    await session.commitTransaction();
    return true;
  } catch (err) {
    await session.abortTransaction();
    throw err;
  } finally {
    await session.endSession();
  }
}

/**
 * Cancels a user's own pending request.
 */
export async function cancelJoinRequest(communityId, userId) {
  const deleted = await Membership.findOneAndDelete({
    communityId,
    userId,
    status: 'pending',
  });

  if (!deleted) {
    throw new AppError(ERROR_CODES.NOT_FOUND, 'No pending request found to cancel', 404);
  }

  return true;
}

/**
 * Lists pending join requests (owner only).
 */
export async function getPendingRequests(communityId, ownerId) {
  const community = await Community.findById(communityId);
  if (!community || community.ownerId.toString() !== ownerId.toString()) {
    throw new AppError(
      ERROR_CODES.FORBIDDEN,
      'Only the community owner can view join requests',
      403,
    );
  }

  const requests = await Membership.find({ communityId, status: 'pending' })
    .populate('userId', 'name photoUrl trustScore createdAt')
    .lean();

  return requests.map((r) => ({
    membershipId: r._id,
    user: r.userId,
    requestedAt: r.createdAt,
  }));
}

/**
 * Approves a pending join request (owner only). Runs in a transaction.
 */
export async function approveRequest(communityId, ownerId, targetUserId) {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const community = await Community.findById(communityId).session(session);
    if (!community || community.ownerId.toString() !== ownerId.toString()) {
      throw new AppError(
        ERROR_CODES.FORBIDDEN,
        'Only the community owner can approve requests',
        403,
      );
    }

    const membership = await Membership.findOne({
      communityId,
      userId: targetUserId,
      status: 'pending',
    }).session(session);

    if (!membership) {
      throw new AppError(ERROR_CODES.NOT_FOUND, 'Pending request not found', 404);
    }

    membership.status = 'active';
    membership.joinedAt = new Date();
    await membership.save({ session });

    community.memberCount += 1;
    await community.save({ session });

    await session.commitTransaction();
    return true;
  } catch (err) {
    await session.abortTransaction();
    throw err;
  } finally {
    await session.endSession();
  }
}

/**
 * Rejects a pending join request (owner only). Sets rejectedAt for 24h cooldown.
 */
export async function rejectRequest(communityId, ownerId, targetUserId) {
  const community = await Community.findById(communityId);
  if (!community || community.ownerId.toString() !== ownerId.toString()) {
    throw new AppError(ERROR_CODES.FORBIDDEN, 'Only the community owner can reject requests', 403);
  }

  const membership = await Membership.findOne({
    communityId,
    userId: targetUserId,
    status: 'pending',
  });

  if (!membership) {
    throw new AppError(ERROR_CODES.NOT_FOUND, 'Pending request not found', 404);
  }

  membership.status = 'removed';
  membership.rejectedAt = new Date();
  await membership.save();

  return true;
}

/**
 * Removes a member (owner only). Sets status='removed' and blocks self-rejoin.
 */
export async function removeMember(communityId, ownerId, targetUserId) {
  if (ownerId.toString() === targetUserId.toString()) {
    throw new AppError(
      ERROR_CODES.BAD_REQUEST,
      'Owner cannot be removed. Transfer ownership instead.',
      400,
    );
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const community = await Community.findById(communityId).session(session);
    if (!community || community.ownerId.toString() !== ownerId.toString()) {
      throw new AppError(ERROR_CODES.FORBIDDEN, 'Only the community owner can remove members', 403);
    }

    const membership = await Membership.findOne({
      communityId,
      userId: targetUserId,
      status: 'active',
    }).session(session);

    if (!membership) {
      throw new AppError(ERROR_CODES.NOT_FOUND, 'Active membership not found', 404);
    }

    membership.status = 'removed';
    await membership.save({ session });

    community.memberCount = Math.max(0, community.memberCount - 1);
    await community.save({ session });

    await session.commitTransaction();
    return true;
  } catch (err) {
    await session.abortTransaction();
    throw err;
  } finally {
    await session.endSession();
  }
}

/**
 * Transfers community ownership to an active member.
 */
export async function transferOwnership(communityId, currentOwnerId, newOwnerId) {
  if (currentOwnerId.toString() === newOwnerId.toString()) {
    throw new AppError(ERROR_CODES.BAD_REQUEST, 'Target user is already the owner', 400);
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const community = await Community.findById(communityId).session(session);
    if (!community || community.ownerId.toString() !== currentOwnerId.toString()) {
      throw new AppError(
        ERROR_CODES.FORBIDDEN,
        'Only the current owner can transfer ownership',
        403,
      );
    }

    const newOwnerMembership = await Membership.findOne({
      communityId,
      userId: newOwnerId,
      status: 'active',
    }).session(session);

    if (!newOwnerMembership) {
      throw new AppError(
        ERROR_CODES.BAD_REQUEST,
        'New owner must be an active member of this community',
        400,
      );
    }

    // Update community owner
    community.ownerId = newOwnerId;
    await community.save({ session });

    // Update memberships
    await Membership.updateOne(
      { communityId, userId: currentOwnerId },
      { role: 'member' },
      { session },
    );

    newOwnerMembership.role = 'owner';
    await newOwnerMembership.save({ session });

    await session.commitTransaction();
    return true;
  } catch (err) {
    await session.abortTransaction();
    throw err;
  } finally {
    await session.endSession();
  }
}

/**
 * Soft-deletes a community (owner only).
 */
export async function deleteCommunity(communityId, ownerId) {
  const community = await Community.findById(communityId);
  if (!community || community.ownerId.toString() !== ownerId.toString()) {
    throw new AppError(ERROR_CODES.FORBIDDEN, 'Only the community owner can delete it', 403);
  }

  community.status = 'deleted';
  await community.save();
  return true;
}

/**
 * Regenerates the private community invite code (owner only).
 */
export async function regenerateInviteCode(communityId, ownerId) {
  const community = await Community.findById(communityId);
  if (!community || community.ownerId.toString() !== ownerId.toString()) {
    throw new AppError(
      ERROR_CODES.FORBIDDEN,
      'Only the community owner can regenerate invite codes',
      403,
    );
  }

  community.inviteCode = generateInviteCode();
  await community.save();
  return { inviteCode: community.inviteCode };
}

/**
 * Lists active community members (Members-only! Filters out blocked users).
 */
export async function getCommunityMembers(communityId, userId) {
  const membership = await Membership.findOne({ communityId, userId, status: 'active' });
  if (!membership) {
    throw new AppError(
      ERROR_CODES.FORBIDDEN,
      'Member list is private and accessible to active members only',
      403,
    );
  }

  // Find blocked users to filter them out (Rule 14)
  const blocks = await Block.find({
    $or: [{ blockerId: userId }, { blockedId: userId }],
  }).lean();

  const blockedUserIds = new Set(
    blocks.map((b) =>
      b.blockerId.toString() === userId.toString()
        ? b.blockedId.toString()
        : b.blockerId.toString(),
    ),
  );

  const members = await Membership.find({ communityId, status: 'active' })
    .populate('userId', 'name photoUrl trustScore')
    .lean();

  return members
    .filter((m) => m.userId && !blockedUserIds.has(m.userId._id.toString()))
    .map((m) => ({
      userId: m.userId._id,
      name: m.userId.name,
      photoUrl: m.userId.photoUrl,
      trustScore: m.userId.trustScore,
      role: m.role,
      joinedAt: m.joinedAt,
    }));
}

/**
 * Recounts and syncs active member count (used by nightly background job).
 */
export async function recountCommunityMemberships(communityId) {
  const actualCount = await Membership.countDocuments({ communityId, status: 'active' });
  await Community.updateOne({ _id: communityId }, { memberCount: actualCount });
  return actualCount;
}
