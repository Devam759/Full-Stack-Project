import { Router } from 'express';
import { z } from 'zod';
import validate from '../../common/validate.js';
import { authenticate } from '../../common/authMiddleware.js';
import { generateUploadSignature } from '../../services/uploadService.js';

export const uploadRouter = Router();

const signUploadSchema = z.object({
  type: z.enum(['profile', 'item', 'handover']),
});

uploadRouter.post(
  '/sign',
  authenticate(),
  validate({ body: signUploadSchema }),
  (req, res, next) => {
    try {
      const signaturePayload = generateUploadSignature(req.body.type, req.user._id.toString());
      res.status(200).json(signaturePayload);
    } catch (err) {
      next(err);
    }
  },
);

export default uploadRouter;
