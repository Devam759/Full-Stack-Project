import * as userService from './userService.js';

export async function getMe(req, res) {
  res.status(200).json({ user: req.user });
}

export async function updateMe(req, res, next) {
  try {
    const updatedUser = await userService.updateProfile(req.user, req.body);
    res.status(200).json({ user: updatedUser });
  } catch (err) {
    next(err);
  }
}

export async function getPublicProfile(req, res, next) {
  try {
    const profile = await userService.getPublicProfile(req.params.id);
    res.status(200).json({ profile });
  } catch (err) {
    next(err);
  }
}

export async function blockUser(req, res, next) {
  try {
    await userService.blockUser(req.user._id, req.params.id);
    res.status(200).json({ message: 'User blocked successfully' });
  } catch (err) {
    next(err);
  }
}

export async function unblockUser(req, res, next) {
  try {
    await userService.unblockUser(req.user._id, req.params.id);
    res.status(200).json({ message: 'User unblocked successfully' });
  } catch (err) {
    next(err);
  }
}

export async function getBlockedUsers(req, res, next) {
  try {
    const blocks = await userService.getBlockedUsers(req.user._id);
    res.status(200).json({ blocks });
  } catch (err) {
    next(err);
  }
}

export async function deleteMe(req, res, next) {
  try {
    await userService.deleteAccount(req.user._id, req.body.password);
    res.clearCookie('refreshToken', { path: '/v1/auth' });
    res.status(200).json({ message: 'Account deleted successfully' });
  } catch (err) {
    next(err);
  }
}
