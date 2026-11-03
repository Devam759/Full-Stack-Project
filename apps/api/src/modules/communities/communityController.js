import * as communityService from './communityService.js';

export async function getNearby(req, res, next) {
  try {
    const { lat, lng, radius } = req.query;
    const userId = req.user?._id;
    const communities = await communityService.getNearbyCommunities({
      lat: Number(lat),
      lng: Number(lng),
      radius: radius ? Number(radius) : 10000,
      userId,
    });
    res.status(200).json({ communities });
  } catch (err) {
    next(err);
  }
}

export async function search(req, res, next) {
  try {
    const { q, city, cursor, limit } = req.query;
    const userId = req.user?._id;
    const result = await communityService.searchCommunities({
      q,
      city,
      cursor,
      limit: limit ? Number(limit) : 20,
      userId,
    });
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

export async function getDetail(req, res, next) {
  try {
    const userId = req.user?._id;
    const community = await communityService.getCommunityDetail(req.params.id, userId);
    res.status(200).json({ community });
  } catch (err) {
    next(err);
  }
}

export async function create(req, res, next) {
  try {
    const community = await communityService.createCommunity({
      userId: req.user._id,
      ...req.body,
    });
    res.status(201).json({ community });
  } catch (err) {
    next(err);
  }
}

export async function join(req, res, next) {
  try {
    const result = await communityService.joinCommunity({
      communityId: req.params.id,
      userId: req.user._id,
      inviteCode: req.body?.inviteCode,
    });
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

export async function leave(req, res, next) {
  try {
    await communityService.leaveCommunity(req.params.id, req.user._id);
    res.status(200).json({ message: 'Left community successfully' });
  } catch (err) {
    next(err);
  }
}

export async function cancelRequest(req, res, next) {
  try {
    await communityService.cancelJoinRequest(req.params.id, req.user._id);
    res.status(200).json({ message: 'Join request cancelled' });
  } catch (err) {
    next(err);
  }
}

export async function getPendingRequests(req, res, next) {
  try {
    const requests = await communityService.getPendingRequests(req.params.id, req.user._id);
    res.status(200).json({ requests });
  } catch (err) {
    next(err);
  }
}

export async function approveRequest(req, res, next) {
  try {
    await communityService.approveRequest(req.params.id, req.user._id, req.params.userId);
    res.status(200).json({ message: 'Member request approved' });
  } catch (err) {
    next(err);
  }
}

export async function rejectRequest(req, res, next) {
  try {
    await communityService.rejectRequest(req.params.id, req.user._id, req.params.userId);
    res.status(200).json({ message: 'Member request rejected' });
  } catch (err) {
    next(err);
  }
}

export async function removeMember(req, res, next) {
  try {
    await communityService.removeMember(req.params.id, req.user._id, req.params.userId);
    res.status(200).json({ message: 'Member removed from community' });
  } catch (err) {
    next(err);
  }
}

export async function transferOwnership(req, res, next) {
  try {
    await communityService.transferOwnership(req.params.id, req.user._id, req.body.newOwnerId);
    res.status(200).json({ message: 'Ownership transferred successfully' });
  } catch (err) {
    next(err);
  }
}

export async function deleteCommunity(req, res, next) {
  try {
    await communityService.deleteCommunity(req.params.id, req.user._id);
    res.status(200).json({ message: 'Community deleted successfully' });
  } catch (err) {
    next(err);
  }
}

export async function regenerateInviteCode(req, res, next) {
  try {
    const result = await communityService.regenerateInviteCode(req.params.id, req.user._id);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

export async function getMembers(req, res, next) {
  try {
    const members = await communityService.getCommunityMembers(req.params.id, req.user._id);
    res.status(200).json({ members });
  } catch (err) {
    next(err);
  }
}
