import { Router } from 'express';
import { updateProfileSchema, deleteAccountSchema } from '@borrowloop/shared';
import validate from '../../common/validate.js';
import { authenticate } from '../../common/authMiddleware.js';
import * as userController from './userController.js';

export const userRouter = Router();

userRouter.get('/me', authenticate(), userController.getMe);
userRouter.patch(
  '/me',
  authenticate(),
  validate({ body: updateProfileSchema }),
  userController.updateMe,
);
userRouter.delete(
  '/me',
  authenticate(),
  validate({ body: deleteAccountSchema }),
  userController.deleteMe,
);

userRouter.get('/me/blocks', authenticate(), userController.getBlockedUsers);
userRouter.post('/:id/block', authenticate(), userController.blockUser);
userRouter.delete('/:id/block', authenticate(), userController.unblockUser);

userRouter.get('/:id', userController.getPublicProfile);

export default userRouter;
