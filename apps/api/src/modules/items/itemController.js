/**
 * @file apps/api/src/modules/items/itemController.js
 * Controller handlers for Item endpoints.
 */

import * as itemService from './itemService.js';

export async function createItem(req, res, next) {
  try {
    const item = await itemService.createItem(req.user, req.body);
    res.status(201).json(item);
  } catch (err) {
    next(err);
  }
}

export async function updateItem(req, res, next) {
  try {
    const item = await itemService.updateItem(req.user, req.params.id, req.body);
    res.status(200).json(item);
  } catch (err) {
    next(err);
  }
}

export async function deleteItem(req, res, next) {
  try {
    const result = await itemService.deleteItem(req.user, req.params.id);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

export async function getItemById(req, res, next) {
  try {
    const lat = req.query.lat !== undefined ? Number(req.query.lat) : undefined;
    const lng = req.query.lng !== undefined ? Number(req.query.lng) : undefined;
    const requesterCoords = lat !== undefined && lng !== undefined ? { lat, lng } : null;

    const item = await itemService.getItemById(req.user, req.params.id, requesterCoords);
    res.status(200).json(item);
  } catch (err) {
    next(err);
  }
}

export async function searchItems(req, res, next) {
  try {
    const result = await itemService.searchItems(req.user, req.query);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

export async function getItemAvailability(req, res, next) {
  try {
    const availability = await itemService.getItemAvailability(
      req.user,
      req.params.id,
      req.query.month,
    );
    res.status(200).json(availability);
  } catch (err) {
    next(err);
  }
}

export async function getUserItems(req, res, next) {
  try {
    const items = await itemService.getUserItems(req.user._id);
    res.status(200).json(items);
  } catch (err) {
    next(err);
  }
}
