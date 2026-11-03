import { Router } from 'express';
import {
  registerSchema,
  loginSchema,
  verifyEmailSchema,
  resendVerificationSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  changePasswordSchema,
} from '@borrowloop/shared';
import validate from '../../common/validate.js';
import createRateLimiter from '../../common/rateLimiter.js';
import { authenticate } from '../../common/authMiddleware.js';
import { getRedisClient } from '../../redis.js';
import * as authController from './authController.js';

export const authRouter = Router();

const redis = getRedisClient();

// Stricter rate limiters for authentication boundaries
const registerLimiter = createRateLimiter({
  redis,
  windowSeconds: 3600, // 1 hour
  maxRequests: 10,
  keyPrefix: 'rl:auth:register',
});

const loginLimiter = createRateLimiter({
  redis,
  windowSeconds: 60,
  maxRequests: 10,
  keyPrefix: 'rl:auth:login',
});

const passwordResetLimiter = createRateLimiter({
  redis,
  windowSeconds: 3600,
  maxRequests: 5,
  keyPrefix: 'rl:auth:reset',
});

authRouter.post(
  '/register',
  registerLimiter,
  validate({ body: registerSchema }),
  authController.register,
);
authRouter.post('/verify-email', validate({ body: verifyEmailSchema }), authController.verifyEmail);
authRouter.post(
  '/resend-verification',
  registerLimiter,
  validate({ body: resendVerificationSchema }),
  authController.resendVerification,
);
authRouter.post('/login', loginLimiter, validate({ body: loginSchema }), authController.login);
authRouter.post('/refresh', authController.refresh);
authRouter.post('/logout', authController.logout);
authRouter.post(
  '/forgot-password',
  passwordResetLimiter,
  validate({ body: forgotPasswordSchema }),
  authController.forgotPassword,
);
authRouter.post(
  '/reset-password',
  passwordResetLimiter,
  validate({ body: resetPasswordSchema }),
  authController.resetPassword,
);
authRouter.post(
  '/change-password',
  authenticate(),
  validate({ body: changePasswordSchema }),
  authController.changePassword,
);

export default authRouter;
