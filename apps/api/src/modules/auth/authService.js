import { v4 as uuidv4 } from 'uuid';
import { AppError, ERROR_CODES, BUSINESS_CONFIG } from '@borrowloop/shared';
import User from '../../models/User.js';
import RefreshToken from '../../models/RefreshToken.js';
import AuthToken from '../../models/AuthToken.js';
import {
  hashPassword,
  verifyPassword,
  hashToken,
  generateRandomToken,
  DUMMY_ARGON2_HASH,
} from '../../common/crypto.js';
import { signAccessToken } from '../../common/jwt.js';
import { queueEmail } from '../../jobs/emailQueue.js';
import config from '../../config/index.js';

const { TOKEN_AUDIENCES } = BUSINESS_CONFIG;

// In-memory or Redis-backed failed login attempts tracking for slowdown
const loginAttemptsMap = new Map();

/**
 * Registers a new user (Step 1 of Onboarding).
 * Profile photo upload is Step 2 after login.
 */
export async function registerUser({ name, email, password }) {
  const existingUser = await User.findOne({ email });
  if (existingUser) {
    throw new AppError(ERROR_CODES.CONFLICT, 'An account with this email already exists', 409, {
      field: 'email',
    });
  }

  const passwordHash = await hashPassword(password);

  const user = await User.create({
    name,
    email,
    passwordHash,
    emailVerified: false,
    photoUrl: null, // Photo required in Step 2
    termsAcceptedAt: new Date(),
    ageConfirmedAt: new Date(),
  });

  // Generate email verification token (valid for 24h)
  const rawVerificationToken = generateRandomToken(32);
  const tokenHash = hashToken(rawVerificationToken);

  await AuthToken.create({
    userId: user._id,
    type: 'email_verification',
    tokenHash,
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  });

  const verifyUrl = `${config.CLIENT_ORIGINS[0]}/verify-email?token=${rawVerificationToken}`;

  await queueEmail({
    to: user.email,
    subject: 'Verify your email on BorrowLoop',
    text: `Hello ${user.name},\n\nPlease verify your email by clicking: ${verifyUrl}\n\nWelcome to BorrowLoop!`,
    html: `<p>Hello ${user.name},</p><p>Please verify your email by clicking <a href="${verifyUrl}">here</a>.</p>`,
  });

  return {
    user,
    verificationToken: process.env.NODE_ENV === 'test' ? rawVerificationToken : undefined,
  };
}

/**
 * Verifies email using verification token.
 */
export async function verifyEmail(rawToken) {
  const tokenHash = hashToken(rawToken);
  const authToken = await AuthToken.findOne({
    tokenHash,
    type: 'email_verification',
    usedAt: null,
    expiresAt: { $gt: new Date() },
  });

  if (!authToken) {
    throw new AppError(ERROR_CODES.BAD_REQUEST, 'Invalid or expired verification link', 400);
  }

  authToken.usedAt = new Date();
  await authToken.save();

  const user = await User.findById(authToken.userId);
  if (!user) {
    throw new AppError(ERROR_CODES.NOT_FOUND, 'User not found', 404);
  }

  user.emailVerified = true;
  await user.save();

  return user;
}

/**
 * Resends email verification link.
 */
export async function resendVerification(email) {
  const user = await User.findOne({ email });
  if (!user || user.emailVerified) {
    return; // Silent return
  }

  const rawVerificationToken = generateRandomToken(32);
  const tokenHash = hashToken(rawVerificationToken);

  await AuthToken.create({
    userId: user._id,
    type: 'email_verification',
    tokenHash,
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  });

  const verifyUrl = `${config.CLIENT_ORIGINS[0]}/verify-email?token=${rawVerificationToken}`;

  await queueEmail({
    to: user.email,
    subject: 'Verify your email on BorrowLoop',
    text: `Hello ${user.name},\n\nPlease verify your email by clicking: ${verifyUrl}`,
    html: `<p>Hello ${user.name},</p><p>Please verify your email by clicking <a href="${verifyUrl}">here</a>.</p>`,
  });

  return process.env.NODE_ENV === 'test' ? rawVerificationToken : undefined;
}

/**
 * Logs in a user with IP+Email slowdown and dummy hash comparison.
 */
export async function loginUser({ email, password, ip, userAgent }) {
  const key = `${ip || 'unknown'}:${email}`;
  const now = Date.now();
  const attemptData = loginAttemptsMap.get(key) || { count: 0, resetAt: now + 15 * 60 * 1000 };

  if (now > attemptData.resetAt) {
    attemptData.count = 0;
    attemptData.resetAt = now + 15 * 60 * 1000;
  }

  // Progressive slowdown if repeated failures
  if (attemptData.count > 0 && process.env.NODE_ENV !== 'test') {
    const delayMs = Math.min(2000, attemptData.count * 400);
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  const user = await User.findOne({ email }).select('+passwordHash');

  if (!user) {
    // Dummy hash computation to prevent timing attacks
    await verifyPassword(DUMMY_ARGON2_HASH, password);
    attemptData.count += 1;
    loginAttemptsMap.set(key, attemptData);
    throw new AppError(ERROR_CODES.INVALID_CREDENTIALS, 'Invalid email or password', 401);
  }

  const isPasswordValid = await verifyPassword(user.passwordHash, password);
  if (!isPasswordValid) {
    attemptData.count += 1;
    loginAttemptsMap.set(key, attemptData);
    throw new AppError(ERROR_CODES.INVALID_CREDENTIALS, 'Invalid email or password', 401);
  }

  // Reset attempt count on success
  loginAttemptsMap.delete(key);

  if (user.status === 'banned') {
    throw new AppError(ERROR_CODES.ACCOUNT_BANNED, 'Account has been banned', 403);
  }
  if (user.status === 'frozen') {
    throw new AppError(ERROR_CODES.ACCOUNT_FROZEN, 'Account has been frozen', 403);
  }
  if (user.status === 'deleted') {
    throw new AppError(ERROR_CODES.UNAUTHORIZED, 'Account has been deleted', 401);
  }

  // Issue Refresh Token
  const rawRefreshToken = generateRandomToken(40);
  const familyId = uuidv4();
  const tokenHash = hashToken(rawRefreshToken);
  const expiresAt = new Date(Date.now() + BUSINESS_CONFIG.REFRESH_TOKEN_EXPIRY_SECONDS * 1000);

  await RefreshToken.create({
    userId: user._id,
    tokenHash,
    familyId,
    expiresAt,
    userAgent: userAgent || 'unknown',
  });

  // Issue Access Token
  const accessToken = signAccessToken(
    { sub: user._id.toString(), role: user.role },
    TOKEN_AUDIENCES.USER,
  );

  user.lastLoginAt = new Date();
  await user.save();

  return {
    user,
    accessToken,
    refreshToken: rawRefreshToken,
    requiresPhoto: !user.photoUrl,
  };
}

/**
 * Rotates refresh token with reuse detection and Origin verification.
 */
export async function rotateRefreshToken({ rawToken, userAgent, origin }) {
  if (!rawToken) {
    throw new AppError(ERROR_CODES.UNAUTHORIZED, 'Refresh token required', 401);
  }

  // Origin check for CSRF prevention on cookie-based refresh
  const allowedOrigins = [...config.CLIENT_ORIGINS, config.PORTAL_ORIGIN].filter(Boolean);
  if (origin && !allowedOrigins.includes(origin)) {
    throw new AppError(ERROR_CODES.FORBIDDEN, 'Invalid origin for token refresh', 403);
  }

  const tokenHash = hashToken(rawToken);
  const existingToken = await RefreshToken.findOne({ tokenHash });

  if (!existingToken) {
    throw new AppError(ERROR_CODES.UNAUTHORIZED, 'Invalid or expired refresh token', 401);
  }

  // REUSE DETECTION: If this token was already revoked, someone is replaying it!
  if (existingToken.revokedAt !== null) {
    // Invalidate entire family immediately
    await RefreshToken.updateMany({ familyId: existingToken.familyId }, { revokedAt: new Date() });
    throw new AppError(
      ERROR_CODES.TOKEN_REVOKED,
      'Refresh token reuse detected. All sessions in this family have been terminated.',
      401,
    );
  }

  // Revoke current token
  existingToken.revokedAt = new Date();
  await existingToken.save();

  // Find user to ensure still active
  const user = await User.findById(existingToken.userId);
  if (!user || user.status !== 'active') {
    throw new AppError(ERROR_CODES.UNAUTHORIZED, 'User no longer active', 401);
  }

  // Generate new refresh token within SAME family
  const newRawRefreshToken = generateRandomToken(40);
  const newHash = hashToken(newRawRefreshToken);
  const expiresAt = new Date(Date.now() + BUSINESS_CONFIG.REFRESH_TOKEN_EXPIRY_SECONDS * 1000);

  await RefreshToken.create({
    userId: user._id,
    tokenHash: newHash,
    familyId: existingToken.familyId,
    expiresAt,
    userAgent: userAgent || 'unknown',
  });

  const audience = user.role === 'user' ? TOKEN_AUDIENCES.USER : TOKEN_AUDIENCES.PORTAL;
  const accessToken = signAccessToken({ sub: user._id.toString(), role: user.role }, audience);

  return {
    accessToken,
    refreshToken: newRawRefreshToken,
    user,
  };
}

/**
 * Logs out user by revoking token family.
 */
export async function logoutUser(rawToken) {
  if (!rawToken) return;
  const tokenHash = hashToken(rawToken);
  const tokenDoc = await RefreshToken.findOne({ tokenHash });
  if (tokenDoc) {
    await RefreshToken.updateMany({ familyId: tokenDoc.familyId }, { revokedAt: new Date() });
  }
}

/**
 * Initiates forgot password flow.
 */
export async function forgotPassword(email) {
  const user = await User.findOne({ email });
  if (!user) {
    return; // Do not reveal user existence
  }

  const rawResetToken = generateRandomToken(32);
  const tokenHash = hashToken(rawResetToken);

  await AuthToken.create({
    userId: user._id,
    type: 'password_reset',
    tokenHash,
    expiresAt: new Date(Date.now() + 15 * 60 * 1000), // 15 mins
  });

  const resetUrl = `${config.CLIENT_ORIGINS[0]}/reset-password?token=${rawResetToken}`;

  await queueEmail({
    to: user.email,
    subject: 'Password Reset Request for BorrowLoop',
    text: `Hello ${user.name},\n\nYou requested a password reset. Click the link below to set a new password:\n${resetUrl}\n\nThis link expires in 15 minutes.`,
    html: `<p>Hello ${user.name},</p><p>Click <a href="${resetUrl}">here</a> to reset your password. This link expires in 15 minutes.</p>`,
  });

  return process.env.NODE_ENV === 'test' ? rawResetToken : undefined;
}

/**
 * Resets password with single-use reset token and revokes active sessions.
 */
export async function resetPassword({ rawToken, newPassword }) {
  const tokenHash = hashToken(rawToken);
  const authToken = await AuthToken.findOne({
    tokenHash,
    type: 'password_reset',
    usedAt: null,
    expiresAt: { $gt: new Date() },
  });

  if (!authToken) {
    throw new AppError(ERROR_CODES.BAD_REQUEST, 'Invalid or expired password reset link', 400);
  }

  authToken.usedAt = new Date();
  await authToken.save();

  const user = await User.findById(authToken.userId);
  if (!user) {
    throw new AppError(ERROR_CODES.NOT_FOUND, 'User not found', 404);
  }

  user.passwordHash = await hashPassword(newPassword);
  await user.save();

  // Revoke all refresh tokens for security
  await RefreshToken.updateMany({ userId: user._id }, { revokedAt: new Date() });

  return true;
}

/**
 * Changes password for authenticated user.
 */
export async function changePassword({ userId, currentPassword, newPassword }) {
  const user = await User.findById(userId).select('+passwordHash');
  if (!user) {
    throw new AppError(ERROR_CODES.NOT_FOUND, 'User not found', 404);
  }

  const isValid = await verifyPassword(user.passwordHash, currentPassword);
  if (!isValid) {
    throw new AppError(ERROR_CODES.BAD_REQUEST, 'Current password is incorrect', 400, {
      field: 'currentPassword',
    });
  }

  user.passwordHash = await hashPassword(newPassword);
  await user.save();

  // Revoke active refresh tokens
  await RefreshToken.updateMany({ userId: user._id }, { revokedAt: new Date() });

  return true;
}
