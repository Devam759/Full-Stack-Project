import { BUSINESS_CONFIG } from '@borrowloop/shared';
import * as authService from './authService.js';
import config from '../../config/index.js';

const REFRESH_COOKIE_NAME = 'refreshToken';

function setRefreshCookie(res, token) {
  const isProd = config.NODE_ENV === 'production';
  res.cookie(REFRESH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    maxAge: BUSINESS_CONFIG.REFRESH_TOKEN_EXPIRY_SECONDS * 1000,
    path: '/v1/auth',
  });
}

function clearRefreshCookie(res) {
  res.clearCookie(REFRESH_COOKIE_NAME, {
    path: '/v1/auth',
  });
}

export async function register(req, res, next) {
  try {
    const result = await authService.registerUser(req.body);
    res.status(201).json({
      message: 'Account created successfully. Please check your email for the verification link.',
      user: result.user,
      verificationToken: result.verificationToken, // Returned in test mode only
    });
  } catch (err) {
    next(err);
  }
}

export async function verifyEmail(req, res, next) {
  try {
    const user = await authService.verifyEmail(req.body.token);
    res.status(200).json({
      message: 'Email verified successfully. You can now log in.',
      user,
    });
  } catch (err) {
    next(err);
  }
}

export async function resendVerification(req, res, next) {
  try {
    const verificationToken = await authService.resendVerification(req.body.email);
    res.status(200).json({
      message: 'If the email exists and is unverified, a verification link has been sent.',
      verificationToken,
    });
  } catch (err) {
    next(err);
  }
}

export async function login(req, res, next) {
  try {
    const { email, password } = req.body;
    const ip = req.ip || req.connection.remoteAddress;
    const userAgent = req.headers['user-agent'];

    const result = await authService.loginUser({ email, password, ip, userAgent });

    setRefreshCookie(res, result.refreshToken);

    const responsePayload = {
      user: result.user,
      accessToken: result.accessToken,
      requiresPhoto: result.requiresPhoto,
    };

    if (BUSINESS_CONFIG.ALLOW_REFRESH_TOKEN_BODY_FALLBACK) {
      responsePayload.refreshToken = result.refreshToken;
    }

    res.status(200).json(responsePayload);
  } catch (err) {
    next(err);
  }
}

export async function refresh(req, res, next) {
  try {
    const tokenFromCookie = req.cookies?.[REFRESH_COOKIE_NAME];
    const tokenFromBody = BUSINESS_CONFIG.ALLOW_REFRESH_TOKEN_BODY_FALLBACK
      ? req.body?.refreshToken
      : undefined;

    const rawToken = tokenFromCookie || tokenFromBody;
    const userAgent = req.headers['user-agent'];
    const origin = req.headers.origin;

    const result = await authService.rotateRefreshToken({ rawToken, userAgent, origin });

    setRefreshCookie(res, result.refreshToken);

    const responsePayload = {
      accessToken: result.accessToken,
      user: result.user,
    };

    if (BUSINESS_CONFIG.ALLOW_REFRESH_TOKEN_BODY_FALLBACK) {
      responsePayload.refreshToken = result.refreshToken;
    }

    res.status(200).json(responsePayload);
  } catch (err) {
    next(err);
  }
}

export async function logout(req, res, next) {
  try {
    const rawToken = req.cookies?.[REFRESH_COOKIE_NAME] || req.body?.refreshToken;
    await authService.logoutUser(rawToken);
    clearRefreshCookie(res);
    res.status(200).json({ message: 'Logged out successfully' });
  } catch (err) {
    next(err);
  }
}

export async function forgotPassword(req, res, next) {
  try {
    const resetToken = await authService.forgotPassword(req.body.email);
    res.status(200).json({
      message: 'If the email exists, a password reset link has been dispatched.',
      resetToken, // for testing
    });
  } catch (err) {
    next(err);
  }
}

export async function resetPassword(req, res, next) {
  try {
    await authService.resetPassword({
      rawToken: req.body.token,
      newPassword: req.body.newPassword,
    });
    res.status(200).json({ message: 'Password has been reset successfully. Please log in.' });
  } catch (err) {
    next(err);
  }
}

export async function changePassword(req, res, next) {
  try {
    await authService.changePassword({
      userId: req.user._id,
      currentPassword: req.body.currentPassword,
      newPassword: req.body.newPassword,
    });
    res.status(200).json({ message: 'Password changed successfully.' });
  } catch (err) {
    next(err);
  }
}
