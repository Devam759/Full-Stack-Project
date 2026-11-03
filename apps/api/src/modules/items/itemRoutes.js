/**
 * @file apps/api/src/modules/items/itemRoutes.js
 * Express router for item management, search, and availability.
 */

import { Router } from 'express';
import validate from '../../common/validate.js';
import { authenticate, requireVerifiedEmail } from '../../common/authMiddleware.js';
import {
  createItemSchema,
  updateItemSchema,
  itemSearchQuerySchema,
  itemAvailabilityQuerySchema,
} from '@borrowloop/shared';
import * as itemController from './itemController.js';

export const itemRouter = Router();

itemRouter.post(
  '/',
  authenticate(),
  requireVerifiedEmail,
  validate({ body: createItemSchema }),
  itemController.createItem,
);

itemRouter.get(
  '/',
  authenticate(),
  validate({ query: itemSearchQuerySchema }),
  itemController.searchItems,
);

itemRouter.get('/:id', authenticate(), itemController.getItemById);

itemRouter.patch(
  '/:id',
  authenticate(),
  validate({ body: updateItemSchema }),
  itemController.updateItem,
);

itemRouter.delete('/:id', authenticate(), itemController.deleteItem);

itemRouter.get(
  '/:id/availability',
  authenticate(),
  validate({ query: itemAvailabilityQuerySchema }),
  itemController.getItemAvailability,
);

export default itemRouter;
