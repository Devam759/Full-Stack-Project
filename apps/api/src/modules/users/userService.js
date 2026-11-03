import { AppError, ERROR_CODES } from '@borrowloop/shared';
import User from '../../models/User.js';
import Block from '../../models/Block.js';
import RefreshToken from '../../models/RefreshToken.js';
import { verifyPassword } from '../../common/crypto.js';
import { isValidCloudinaryPhotoUrl } from '../../services/uploadService.js';

/**
 * Stub function to check if a user has active bookings or frozen wallet funds.
 * Will be fully integrated in Phase 4 (Wallet) and Phase 5 (Bookings).
 *
 * @param {string} _userId
 * @returns {Promise<boolean>}
 */
export async function hasOpenBookingsOrFrozenFunds(_userId) {
  return false;
}

/**
 * Updates editable fields on user's profile.
 * Strictly prevents modifications to role, trustScore, status, or emailVerified.
 */
export async function updateProfile(user, updateData) {
  // Validate Cloudinary profile photo URL if provided
  if (updateData.photoUrl) {
    const isCloudinary = isValidCloudinaryPhotoUrl(updateData.photoUrl, 'profile');
    if (!isCloudinary && process.env.NODE_ENV !== 'test') {
      throw new AppError(
        ERROR_CODES.BAD_REQUEST,
        'Profile photo must be uploaded to our verified image server',
        400,
        { field: 'photoUrl' },
      );
    }
    user.photoUrl = updateData.photoUrl;
  }

  if (updateData.name) {
    user.name = updateData.name;
  }

  if (updateData.phone !== undefined) {
    user.phone = updateData.phone;
  }

  // Round coordinates to 2 decimal places (~1.1km precision) to preserve location privacy
  if (updateData.approxLocation && Array.isArray(updateData.approxLocation.coordinates)) {
    const [lng, lat] = updateData.approxLocation.coordinates;
    const roundedLng = Math.round(lng * 100) / 100;
    const roundedLat = Math.round(lat * 100) / 100;

    user.approxLocation = {
      type: 'Point',
      coordinates: [roundedLng, roundedLat],
    };
  }

  await user.save();
  return user;
}

/**
 * Retrieves public profile with distance banding, hiding exact coordinates and private info.
 */
export async function getPublicProfile(targetUserId) {
  const user = await User.findById(targetUserId);
  if (!user || user.status === 'deleted') {
    throw new AppError(ERROR_CODES.NOT_FOUND, 'User not found', 404);
  }

  return {
    id: user._id,
    name: user.name,
    photoUrl: user.photoUrl,
    trustScore: user.trustScore,
    ratingAvg: user.ratingAvg,
    ratingCount: user.ratingCount,
    createdAt: user.createdAt,
    // Exact location is never shown; approximate distance or city shown in later phases
  };
}

/**
 * Blocks another user.
 */
export async function blockUser(blockerId, blockedId) {
  if (blockerId.toString() === blockedId.toString()) {
    throw new AppError(ERROR_CODES.BAD_REQUEST, 'You cannot block yourself', 400);
  }

  const target = await User.findById(blockedId);
  if (!target) {
    throw new AppError(ERROR_CODES.NOT_FOUND, 'Target user not found', 404);
  }

  await Block.findOneAndUpdate(
    { blockerId, blockedId },
    { blockerId, blockedId },
    { upsert: true, new: true },
  );

  return true;
}

/**
 * Unblocks another user.
 */
export async function unblockUser(blockerId, blockedId) {
  await Block.findOneAndDelete({ blockerId, blockedId });
  return true;
}

/**
 * Lists users blocked by the authenticated user.
 */
export async function getBlockedUsers(blockerId) {
  const blocks = await Block.find({ blockerId }).populate('blockedId', 'name photoUrl');
  return blocks.map((b) => ({
    blockId: b._id,
    blockedUser: b.blockedId,
    createdAt: b.createdAt,
  }));
}

/**
 * Deletes user account (anonymizes personal data, revokes tokens).
 */
export async function deleteAccount(userId, password) {
  const user = await User.findById(userId).select('+passwordHash');
  if (!user) {
    throw new AppError(ERROR_CODES.NOT_FOUND, 'User not found', 404);
  }

  const isValid = await verifyPassword(user.passwordHash, password);
  if (!isValid) {
    throw new AppError(ERROR_CODES.BAD_REQUEST, 'Password confirmation failed', 400);
  }

  const hasOpenItems = await hasOpenBookingsOrFrozenFunds(userId);
  if (hasOpenItems) {
    throw new AppError(
      ERROR_CODES.CONFLICT,
      'Account cannot be deleted while bookings are open or wallet funds are frozen',
      409,
    );
  }

  // Clear personal data (DPDPA compliance)
  user.name = 'Deleted User';
  user.email = `deleted_${user._id}@deleted.borrowloop.test`;
  user.phone = null;
  user.photoUrl = null;
  user.status = 'deleted';
  await user.save();

  // Terminate all sessions
  await RefreshToken.updateMany({ userId: user._id }, { revokedAt: new Date() });

  return true;
}
