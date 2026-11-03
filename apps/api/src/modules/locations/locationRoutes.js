import { Router } from 'express';
import { z } from 'zod';
import validate from '../../common/validate.js';
import getGeocoder from '../../services/geocoder/index.js';

export const locationRouter = Router();

const searchSchema = z.object({
  q: z.string().trim().min(2, 'Search query must be at least 2 characters'),
});

const reverseSchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
});

locationRouter.get('/search', validate({ query: searchSchema }), async (req, res, next) => {
  try {
    const geocoder = getGeocoder();
    const results = await geocoder.search(req.query.q);
    res.status(200).json({ results });
  } catch (err) {
    next(err);
  }
});

locationRouter.get('/reverse', validate({ query: reverseSchema }), async (req, res, next) => {
  try {
    const geocoder = getGeocoder();
    const result = await geocoder.reverse(Number(req.query.lat), Number(req.query.lng));
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
});

export default locationRouter;
