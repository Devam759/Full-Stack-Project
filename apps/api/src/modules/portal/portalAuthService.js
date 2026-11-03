import { v4 as uuidv4 } from 'uuid';
import { AppError, ERROR_CODES, BUSINESS_CONFIG } from '@borrowloop/shared';
import User from '../../models/User.js';
import RefreshToken from '../../models/RefreshToken.js';
import AuthToken from '../../models/AuthToken.js';
import {
  verifyPassword,
  hashToken,
  generateRandomToken,
  DUMMY_ARGON2_HASH,
} from '../../common/crypto.js';
import { signAccessToken, signPreTotpToken, verifyAccessToken } from '../../common/jwt.js';
import { verifyTotpCode, generateTotpSecret } from '../../services/totpService.js';

const { TOKEN_AUDIENCES } = BUSINESS_CONFIG;

// Attempt tracker for TOTP code validation
const totpAttemptsMap = new Map();

/**
 * Step 1 of Portal Login: Email + Password check.
 * Issues a scoped 5-minute pre-TOTP token on success.
 */
export async function portalLogin({ email, password }) {
  const user = await User.findOne({ email }).select('+passwordHash +totpSecret');

  if (!user || !['care_agent', 'admin'].includes(user.role)) {
    await verifyPassword(DUMMY_ARGON2_HASH, password);
    throw new AppError(ERROR_CODES.INVALID_CREDENTIALS, 'Invalid portal credentials', 401);
  }

  const isValidPassword = await verifyPassword(user.passwordHash, password);
  if (!isValidPassword) {
    throw new AppError(ERROR_CODES.INVALID_CREDENTIALS, 'Invalid portal credentials', 401);
  }

  if (user.status !== 'active') {
    throw new AppError(ERROR_CODES.FORBIDDEN, `Portal account is ${user.status}`, 403);
  }

  if (!user.totpSecret) {
    throw new AppError(
      ERROR_CODES.TOTP_REQUIRED,
      'TOTP authentication is not enrolled. An admin must generate an enrollment link.',
      403,
      { enrollmentRequired: true },
    );
  }

  // Issue pre-TOTP token with specific audience
  const tempToken = signPreTotpToken({ sub: user._id.toString() });

  return {
    totpRequired: true,
    tempToken,
  };
}

/**
 * Step 2 of Portal Login: Validate 6-digit TOTP code against encrypted secret.
 */
export async function verifyPortalTotp({ tempToken, totpCode, userAgent }) {
  let decoded;
  try {
    // Strictly verify audience is borrowloop:portal_pre_totp
    decoded = verifyAccessToken(tempToken, TOKEN_AUDIENCES.PORTAL_PRE_TOTP);
  } catch {
    throw new AppError(ERROR_CODES.UNAUTHORIZED, 'Invalid or expired pre-TOTP session token', 401);
  }

  const userId = decoded.sub;
  const key = `totp:${userId}`;
  const attempts = totpAttemptsMap.get(key) || 0;

  if (attempts >= BUSINESS_CONFIG.TOTP_SETTINGS.MAX_ATTEMPTS) {
    throw new AppError(
      ERROR_CODES.RATE_LIMITED,
      'Too many failed TOTP attempts. Please re-authenticate.',
      429,
    );
  }

  const user = await User.findById(userId).select('+totpSecret +lastTotpStep');
  if (!user || !user.totpSecret) {
    throw new AppError(ERROR_CODES.UNAUTHORIZED, 'User or TOTP secret not found', 401);
  }

  const result = verifyTotpCode({
    code: totpCode,
    encryptedSecret: user.totpSecret,
    lastStep: user.lastTotpStep || 0,
    email: user.email,
  });

  if (!result.valid) {
    totpAttemptsMap.set(key, attempts + 1);
    const msg = result.replayed
      ? 'TOTP code has already been used. Please wait for the next code.'
      : 'Invalid 6-digit authentication code';
    throw new AppError(ERROR_CODES.INVALID_TOTP, msg, 401);
  }

  // Clear failed attempts and update lastTotpStep
  totpAttemptsMap.delete(key);
  user.lastTotpStep = result.newStep;
  user.lastLoginAt = new Date();
  await user.save();

  // Issue portal session tokens
  const rawRefreshToken = generateRandomToken(40);
  const familyId = uuidv4();
  const tokenHash = hashToken(rawRefreshToken);
  const expiresAt = new Date(Date.now() + BUSINESS_CONFIG.REFRESH_TOKEN_EXPIRY_SECONDS * 1000);

  await RefreshToken.create({
    userId: user._id,
    tokenHash,
    familyId,
    expiresAt,
    userAgent: userAgent || 'portal',
  });

  const accessToken = signAccessToken(
    { sub: user._id.toString(), role: user.role },
    TOKEN_AUDIENCES.PORTAL,
  );

  return {
    user,
    accessToken,
    refreshToken: rawRefreshToken,
  };
}

/**
 * Admin-initiated enrollment generation for an agent or admin.
 */
export async function createTotpEnrollmentLink(targetUserId) {
  const user = await User.findById(targetUserId);
  if (!user || !['care_agent', 'admin'].includes(user.role)) {
    throw new AppError(ERROR_CODES.NOT_FOUND, 'Agent or Admin user not found', 404);
  }

  const { secretBase32, uri, encryptedSecret } = generateTotpSecret(user.email);
  const rawEnrollmentToken = generateRandomToken(32);
  const tokenHash = hashToken(rawEnrollmentToken);

  // Store secret temporarily with the enrollment token
  await AuthToken.create({
    userId: user._id,
    type: 'totp_enrollment',
    tokenHash,
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
  });

  // Temporarily store encrypted secret on user until first confirmed code
  user.totpSecret = encryptedSecret;
  await user.save();

  return {
    enrollmentToken: rawEnrollmentToken,
    secretBase32,
    totpUri: uri,
  };
}

/**
 * First-time enrollment confirmation.
 */
export async function confirmTotpEnrollment({ enrollmentToken, totpCode }) {
  const tokenHash = hashToken(enrollmentToken);
  const authToken = await AuthToken.findOne({
    tokenHash,
    type: 'totp_enrollment',
    usedAt: null,
    expiresAt: { $gt: new Date() },
  });

  if (!authToken) {
    throw new AppError(ERROR_CODES.BAD_REQUEST, 'Invalid or expired TOTP enrollment token', 400);
  }

  const user = await User.findById(authToken.userId).select('+totpSecret +lastTotpStep');
  if (!user || !user.totpSecret) {
    throw new AppError(ERROR_CODES.NOT_FOUND, 'User not found', 404);
  }

  const result = verifyTotpCode({
    code: totpCode,
    encryptedSecret: user.totpSecret,
    lastStep: 0,
    email: user.email,
  });

  if (!result.valid) {
    throw new AppError(ERROR_CODES.INVALID_TOTP, 'Invalid verification code for enrollment', 400);
  }

  authToken.usedAt = new Date();
  await authToken.save();

  user.lastTotpStep = result.newStep;
  await user.save();

  return { message: 'TOTP authentication successfully enrolled. You can now log in.' };
}
