import { Router } from 'express';
import { z } from 'zod';
import { AppError, ERROR_CODES } from '@borrowloop/shared';
import validate from '../../common/validate.js';
import { authenticate } from '../../common/authMiddleware.js';
import { generateUploadSignature } from '../../services/uploadService.js';
import { Booking } from '@borrowloop/server-core';

export const uploadRouter = Router();

const signUploadSchema = z
  .object({
    type: z.enum(['profile', 'item', 'handover']),
    bookingId: z
      .string()
      .regex(/^[0-9a-fA-F]{24}$/, 'Invalid bookingId')
      .optional(),
    stage: z.enum(['pickup', 'return']).optional(),
  })
  .refine(
    (data) => {
      if (data.type === 'handover') {
        return Boolean(data.bookingId && data.stage);
      }
      return true;
    },
    {
      message: 'bookingId and stage are required for handover uploads',
      path: ['bookingId'],
    },
  );

uploadRouter.post(
  '/sign',
  authenticate(),
  validate({ body: signUploadSchema }),
  async (req, res, next) => {
    try {
      const { type, bookingId, stage } = req.body;
      const userId = req.user._id.toString();

      if (type === 'handover') {
        const booking = await Booking.findById(bookingId).lean();
        if (!booking) {
          throw new AppError(ERROR_CODES.BOOKING_NOT_FOUND, 'Booking not found', 404);
        }

        const borrowerIdStr = (booking.borrowerId?._id || booking.borrowerId).toString();
        const lenderIdStr = (booking.lenderId?._id || booking.lenderId).toString();

        if (userId !== borrowerIdStr && userId !== lenderIdStr) {
          throw new AppError(
            ERROR_CODES.FORBIDDEN,
            'Only booking participants may upload handover photos',
            403,
          );
        }
      }

      const signaturePayload = generateUploadSignature(type, userId, { bookingId, stage });
      res.status(200).json(signaturePayload);
    } catch (err) {
      next(err);
    }
  },
);

export default uploadRouter;
