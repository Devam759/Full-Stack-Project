import { AppError, ERROR_CODES, BUSINESS_CONFIG } from '@borrowloop/shared';
import { verifyAccessToken } from './jwt.js';
import User from '../models/User.js';

const { TOKEN_AUDIENCES } = BUSINESS_CONFIG;

/**
 * Middleware to authenticate requests using a JWT access token.
 * Validates token audience and active user status.
 *
 * @param {string} [expectedAudience=TOKEN_AUDIENCES.USER]
 */
export function authenticate(expectedAudience = TOKEN_AUDIENCES.USER) {
  return async (req, _res, next) => {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return next(
        new AppError(ERROR_CODES.UNAUTHORIZED, 'Missing or invalid Authorization header', 401),
      );
    }

    const token = authHeader.substring(7).trim();

    try {
      const decoded = verifyAccessToken(token, expectedAudience);

      const user = await User.findById(decoded.sub);
      if (!user) {
        return next(new AppError(ERROR_CODES.UNAUTHORIZED, 'User no longer exists', 401));
      }

      if (user.status === 'banned') {
        return next(new AppError(ERROR_CODES.ACCOUNT_BANNED, 'Account has been banned', 403));
      }

      if (user.status === 'frozen') {
        return next(new AppError(ERROR_CODES.ACCOUNT_FROZEN, 'Account has been frozen', 403));
      }

      if (user.status === 'deleted') {
        return next(new AppError(ERROR_CODES.UNAUTHORIZED, 'Account has been deleted', 401));
      }

      req.user = user;
      return next();
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        return next(new AppError(ERROR_CODES.TOKEN_EXPIRED, 'Access token has expired', 401));
      }
      return next(new AppError(ERROR_CODES.UNAUTHORIZED, 'Invalid access token', 401));
    }
  };
}

/**
 * Middleware requiring user to have verified their email address.
 */
export function requireVerifiedEmail(req, _res, next) {
  if (!req.user) {
    return next(new AppError(ERROR_CODES.UNAUTHORIZED, 'Authentication required', 401));
  }

  if (!req.user.emailVerified) {
    return next(
      new AppError(
        ERROR_CODES.EMAIL_NOT_VERIFIED,
        'Email verification is required to perform this action',
        403,
      ),
    );
  }

  return next();
}

/**
 * Middleware requiring specific role(s).
 * @param {...string} allowedRoles
 */
export function requireRole(...allowedRoles) {
  return (req, _res, next) => {
    if (!req.user) {
      return next(new AppError(ERROR_CODES.UNAUTHORIZED, 'Authentication required', 401));
    }

    if (!allowedRoles.includes(req.user.role)) {
      return next(
        new AppError(ERROR_CODES.FORBIDDEN, 'Insufficient permissions for this resource', 403),
      );
    }

    return next();
  };
}

/**
 * Middleware requiring profile photo completion (Step 2 of onboarding).
 */
export function requireCompleteProfile(req, _res, next) {
  if (!req.user) {
    return next(new AppError(ERROR_CODES.UNAUTHORIZED, 'Authentication required', 401));
  }

  if (!req.user.photoUrl) {
    return next(
      new AppError(
        ERROR_CODES.BAD_REQUEST,
        'Profile photo must be uploaded before continuing',
        400,
        { step: 'photo_required' },
      ),
    );
  }

  return next();
}
