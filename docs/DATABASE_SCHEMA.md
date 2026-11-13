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

`itemId, lenderId, borrowerId, startDate, endDate, dueAt, days, rentPaise, depositPaise, lateFeePerDayPaise, commissionBps, status, statusHistory[], pickupAt?, returnAt?, lateChargePaise, extensions[] { id, requestedEndDate, extraDays, extraRentPaise, status, requestedAt, respondedAt?, expiresAt?, rejectionReason? }, cancelledBy?, cancelReason?, handoverCodeHash?, expiresAt`
Indexes: `(borrowerId, status)`, `(lenderId, status)`, `(itemId, startDate, endDate)`, `(status, expiresAt)`, `(status, dueAt)`.

## handovers

`bookingId, type (pickup|return), qrNonce, qrExpiresAt, scannedBy, scannedAt, geo (distance between phones only), photos[] { by, url, capturedAt }, fallbackCodeUsed`

## wallets

`userId (unique), availablePaise, frozenPaise, pendingPaise, version`

## ledger_entries

`txnId, bookingId?, account, userId?, amountPaise (signed), balanceAfterPaise, type, meta`
Indexes: `txnId`, `(userId, createdAt)`. Append-only: no update or delete.

## ledger_operations

`bookingId, operationType, opRef, createdAt`
Unique index: `(bookingId, operationType, opRef)`. Prevents duplicate money movements across retries and concurrent workers.

## idempotency_keys

`userId, key, requestHash, statusCode, responseBody, createdAt, expiresAt (TTL)`
Indexes: `(userId, key)` unique, `expiresAt` TTL (86400s).

## reconciliation_runs

`runId, startedAt, completedAt, status, totalWalletsChecked, mismatchesCount, mismatches[], orphanLedgerUsersCount, orphanLedgerUsers[], globalLedgerSum, durationMs, error?`

## domain_events

`eventKey (unique), type, bookingId?, actorId?, payload, timestamp, status (pending|processing|processed|failed|dead_letter), retryCount, nextRetryAt, processedAt, error?, lockedAt`
Indexes: `eventKey` unique, `(bookingId, type)`, `(status, nextRetryAt, lockedAt, createdAt)`.

## conversations

`bookingId (unique), participantIds[2], lastMessageAt, confirmedPin? { lat, lng, label, proposedBy, confirmedBy, confirmedAt }, createdAt, updatedAt`
Indexes: `bookingId` unique, `(participantIds)`.

## messages

`conversationId, bookingId, senderId, clientMessageId, type (text|pin|system), text?, pin? { lat, lng, label, status: proposed|confirmed|superseded }, readBy[], createdAt, updatedAt`
Indexes: `(conversationId, createdAt)`, `(bookingId, createdAt)`, `(conversationId, senderId, clientMessageId)` unique.

## socket_sessions (Redis)

Tracked in Redis sorted set `user_sockets:${userId}`:

- Member: `socket.id`
- Score: timestamp of last heartbeat (ms)
- Heartbeat: refreshed every 2 seconds by active sockets
- Prune window: entries older than 5,000 ms (`HEARTBEAT_TTL_MS`) pruned on connect via `ZREMRANGEBYSCORE`
- Limit: `SOCKET_MAX_CONNECTIONS_PER_USER` (5 concurrent connections)

## notifications

`userId, type, title, body, link?, metadata, readAt?, emailSent, dedupeKey? (unique sparse), createdAt, updatedAt`
Indexes: `(userId, readAt, createdAt: -1)`, `(createdAt)` with TTL index (expireAfterSeconds: 7776000 [90 days]), `dedupeKey` unique sparse.

## blocks

`blockerId, blockedId` unique pair.

## audit_logs (append-only)

`actorId, actorRole, action, targetType, targetId, before, after, ip, createdAt`

## refresh_tokens

`userId, tokenHash, familyId, expiresAt, revokedAt?, userAgent` with a TTL index.

## ad_settings

`placement, enabled, adsenseSlotId, pages[]`
