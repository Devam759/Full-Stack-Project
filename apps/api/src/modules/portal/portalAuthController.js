import * as portalAuthService from './portalAuthService.js';
import { BUSINESS_CONFIG } from '@borrowloop/shared';
import config from '../../config/index.js';

const PORTAL_REFRESH_COOKIE = 'portalRefreshToken';

function setPortalCookie(res, token) {
  const isProd = config.NODE_ENV === 'production';
  res.cookie(PORTAL_REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    maxAge: BUSINESS_CONFIG.REFRESH_TOKEN_EXPIRY_SECONDS * 1000,
    path: '/v1/portal',
  });
}

export async function login(req, res, next) {
  try {
    const result = await portalAuthService.portalLogin(req.body);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

export async function totp(req, res, next) {
  try {
    const userAgent = req.headers['user-agent'];
    const result = await portalAuthService.verifyPortalTotp({
      tempToken: req.body.tempToken,
      totpCode: req.body.totpCode,
      userAgent,
    });

    setPortalCookie(res, result.refreshToken);

    const responsePayload = {
      user: result.user,
      accessToken: result.accessToken,
    };

    if (BUSINESS_CONFIG.ALLOW_REFRESH_TOKEN_BODY_FALLBACK) {
      responsePayload.refreshToken = result.refreshToken;
    }

    res.status(200).json(responsePayload);
  } catch (err) {
    next(err);
  }
}

export async function enroll(req, res, next) {
  try {
    const result = await portalAuthService.confirmTotpEnrollment(req.body);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}
