# Database Schema (MongoDB)

All money fields end in `Paise` and are integers. All timestamps are UTC. Every collection has `createdAt` and `updatedAt`.

## users

`name, email (unique, lowercase), emailVerified, passwordHash, photoUrl, phone?, role (user|care_agent|admin), status (active|banned|frozen|deleted), banUntil?, strikes, trustScore, ratingAvg, ratingCount, approxLocation (GeoJSON, rounded), lastLoginAt, totpSecret? (agents and admin)`
Indexes: `email` unique, `approxLocation` 2dsphere.

## communities

`name (unique), slug, description, type (public|private), ownerId, location (GeoJSON), city, memberCount, inviteCode?, status (active|suspended)`
Indexes: `location` 2dsphere, `slug` unique.

## memberships

`communityId, userId, role (member|moderator|owner), status (active|pending|removed)`
Indexes: `(communityId, userId)` unique, `(userId)`.

## items

`ownerId, title, description, category, condition, photos[], rentPerDayPaise, depositPaise, lateFeePerDayPaise?, minDays, maxDays, communityIds[], location (GeoJSON, approximate), status (active|paused|hidden|removed), reportCount, ratingAvg, ratingCount`
Indexes: `location` 2dsphere, text on `title, description`, `(communityIds, status, category, createdAt)`, `(ownerId, status)`.

## item_day_locks

`itemId, day (YYYY-MM-DD), bookingId`
Indexes: `(itemId, day)` unique.

## bookings

`itemId, lenderId, borrowerId, startDate, endDate, dueAt, days, rentPaise, depositPaise, lateFeePerDayPaise, commissionBps, status, statusHistory[], pickupAt?, returnAt?, lateChargePaise, extension? { requestedEndDate, extraRentPaise, status }, cancelledBy?, cancelReason?, handoverCodeHash?, expiresAt`
Indexes: `(borrowerId, status)`, `(lenderId, status)`, `(itemId, startDate, endDate)`, `(status, expiresAt)`, `(status, dueAt)`.

## handovers

`bookingId, type (pickup|return), qrNonce, qrExpiresAt, scannedBy, scannedAt, geo (distance between phones only), photos[] { by, url, capturedAt }, fallbackCodeUsed`

## wallets

`userId (unique), availablePaise, frozenPaise, pendingPaise, version`

## ledger_entries

`txnId, bookingId?, account, userId?, amountPaise (signed), type, idempotencyKey, meta`
Indexes: `txnId`, `(userId, createdAt)`, `idempotencyKey` unique where present. Append-only: no update or delete.

## conversations and messages

conversations: `bookingId, participantIds[2], lastMessageAt`
messages: `conversationId, senderId, type (text|pin|system), text?, pin? { lat, lng, label }, readBy[], createdAt`
Indexes: `(conversationId, createdAt)`.

## ratings

`bookingId, fromUserId, toUserId, stars, comment?, visibleAt, revealed`
Indexes: `(bookingId, fromUserId)` unique, `(toUserId, revealed)`.

## disputes

`bookingId, type (damage|not_returned|no_show|other), raisedBy, status (open|in_review|decided|appealed|closed), assignedAgentId?, decision { depositToLenderPaise, depositToBorrowerPaise, rentOutcome, note }, decidedAt, appeal? { by, reason, status, decidedBy }`

## reports

`targetType (item|user|message), targetId, reporterId, reason, details?, status (open|actioned|dismissed), reviewedBy?`
Indexes: `(targetType, targetId)`, `(status)`.

## notifications

`userId, type, title, body, link, readAt?, emailSent` with a TTL index for old rows.

## blocks

`blockerId, blockedId` unique pair.

## audit_logs (append-only)

`actorId, actorRole, action, targetType, targetId, before, after, ip, createdAt`

## refresh_tokens

`userId, tokenHash, familyId, expiresAt, revokedAt?, userAgent` with a TTL index.

## ad_settings

`placement, enabled, adsenseSlotId, pages[]`
