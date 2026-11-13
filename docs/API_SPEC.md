# API Specification

Base URL: `https://api.<domain>/v1`. JSON only. Authentication uses `Authorization: Bearer <accessToken>`. Money endpoints require an `Idempotency-Key` header.

## Standard error format

```json
{
  "error": {
    "code": "BOOKING_DATES_TAKEN",
    "message": "Readable message",
    "details": {}
  }
}
```

### Error codes:

- **400 Bad Request**: `VALIDATION_ERROR`, `BAD_REQUEST`, `INVALID_IDEMPOTENCY_KEY`
- **401 Unauthorized**: `UNAUTHORIZED`, `INVALID_CREDENTIALS`, `TOKEN_EXPIRED`, `TOKEN_REVOKED`, `TOTP_REQUIRED`, `INVALID_TOTP`
- **403 Forbidden**: `FORBIDDEN`, `EMAIL_NOT_VERIFIED`, `ACCOUNT_BANNED`, `ACCOUNT_FROZEN`, `UNDERAGE`
- **404 Not Found**: `NOT_FOUND`, `USER_NOT_FOUND`, `ITEM_NOT_FOUND`, `COMMUNITY_NOT_FOUND`, `BOOKING_NOT_FOUND`
- **409 Conflict**: `CONFLICT`, `BOOKING_DATES_TAKEN`, `INVALID_BOOKING_TRANSITION`, `INSUFFICIENT_FUNDS`, `WALLET_CAP_EXCEEDED`, `IDEMPOTENCY_KEY_REUSE`, `IDEMPOTENCY_IN_PROGRESS`, `OPERATION_ALREADY_APPLIED`
- **429 Rate Limited**: `RATE_LIMITED`
- **500 Server Error**: `INTERNAL_ERROR`, `LEDGER_INVARIANT_VIOLATION`

## Pagination

`?limit=20&cursor=<opaque>`. Responses include `nextCursor`.

## Auth

- `POST /auth/register` name, email, password, photoUrl
- `POST /auth/verify-email`
- `POST /auth/login`
- `POST /auth/refresh`
- `POST /auth/logout`
- `POST /auth/forgot-password`, `POST /auth/reset-password`
- `POST /portal/auth/login` and `POST /portal/auth/totp` (agents and admin)

## Uploads

- `POST /uploads/sign` returns a signed upload request for the image service (type: profile, item, handover).

## Users

- `GET /users/me`, `PATCH /users/me`
- `GET /users/:id` public profile with trust score and ratings
- `POST /users/:id/block`, `DELETE /users/:id/block`
- `DELETE /users/me` blocked while bookings are open or money is frozen

## Communities

- `GET /communities/nearby?lat&lng&radius`
- `GET /communities/:id`
- `POST /communities`
- `POST /communities/:id/join`, `DELETE /communities/:id/join`
- `GET /communities/:id/requests`, `POST /communities/:id/requests/:userId/approve|reject` (private, owner)
- `DELETE /communities/:id/members/:userId` (owner)

## Items

- `GET /items?q&category&lat&lng&radius&communityId&minPrice&maxPrice&from&to`
- `GET /items/:id`
- `GET /items/:id/availability?month=`
- `POST /items`, `PATCH /items/:id`, `DELETE /items/:id` (blocked while a booking is open)
- `GET /users/me/items`

## Wallet (demo)

All wallet endpoints require authentication (`Authorization: Bearer <token>`) and verified email (`EMAIL_NOT_VERIFIED` 403 returned otherwise). Blocked for banned or frozen accounts.

### Headers

- `Idempotency-Key`: Required on `POST /wallet/add` and `POST /wallet/withdraw`. Must be 8-128 characters, matching `/^[A-Za-z0-9_-]+$/`.
- `X-Idempotent-Replay`: Returned as `true` on duplicate request replay.

### Endpoints

- `GET /wallet`
  - Response: `{ "availablePaise": 50000, "frozenPaise": 0, "pendingPaise": 0, "demo": true }`
- `GET /wallet/transactions?limit=20&cursor=<base64>`
  - Keyset cursor pagination sorted descending by `(createdAt, _id)`.
  - Filters strictly to authenticated user's entries (counterparty IDs stripped).
  - Response: `{ "items": [{ "id": "...", "amountPaise": 50000, "balanceAfterPaise": 50000, "account": "available", "type": "deposit_funds", "createdAt": "..." }], "nextCursor": "...", "demo": true }`
- `POST /wallet/add`
  - Request body: `{ "amountPaise": 50000 }` (min ₹100, max ₹50,000, balance cap ₹50,000)
  - Response: `{ "availablePaise": 50000, "frozenPaise": 0, "pendingPaise": 0, "addedPaise": 50000, "demo": true }`
- `POST /wallet/withdraw`
  - Request body: `{ "amountPaise": 20000 }` (min ₹100, max ₹50,000, must be <= available balance)
  - Response: `{ "availablePaise": 30000, "frozenPaise": 0, "pendingPaise": 0, "withdrawnPaise": 20000, "demo": true }`

## Bookings

All booking lifecycle endpoints require authentication (`Authorization: Bearer <token>`) and verified email (`EMAIL_NOT_VERIFIED` 403 returned otherwise). Blocked for banned or frozen accounts. Mutating endpoints require an `Idempotency-Key` header (8-128 characters matching `/^[A-Za-z0-9_-]+$/`).

### Headers

- `Idempotency-Key`: Required on `POST /bookings`, `POST /bookings/:id/accept`, `POST /bookings/:id/reject`, `POST /bookings/:id/cancel`, `POST /bookings/:id/extensions`, `POST /bookings/:id/extensions/accept`, `POST /bookings/:id/extensions/reject`.
- `X-Idempotent-Replay`: Returned as `true` on duplicate request replay.

### Endpoints

- `POST /bookings`
  - Request body: `{ "itemId": "64f1...", "startDate": "YYYY-MM-DD", "endDate": "YYYY-MM-DD" }`
  - Validation: dates in YYYY-MM-DD format, `startDate <= endDate`, within item min/max days, borrower not owner, borrower member of item's community.
  - Response: `{ "booking": { ... }, "demo": true }` (status `requested`)
- `GET /bookings?role=borrower|lender&status=&limit=20&cursor=`
  - Keyset cursor pagination sorted descending by `(createdAt, _id)`.
  - Response: `{ "items": [ ... ], "nextCursor": "...", "demo": true }`
- `GET /bookings/:id`
  - Accessible only to booking borrower, booking lender, or admins.
  - Response: `{ "booking": { ... }, "demo": true }`
- `POST /bookings/:id/accept`
  - Lender only. Secures `ItemDayLock` for all days in range and freezes funds via `ledgerService.freezeBookingFunds`.
  - Concurrency protected: auto-rejects overlapping pending requests; fails with `409 BOOKING_DATES_TAKEN` if another booking locked any day.
  - Response: `{ "booking": { ... }, "demo": true }` (status `accepted`)
- `POST /bookings/:id/reject`
  - Lender only (status `requested`).
  - Request body: `{ "reason": "Optional rejection reason" }`
  - Response: `{ "booking": { ... }, "demo": true }` (status `cancelled`)
- `POST /bookings/:id/cancel`
  - Borrower or Lender.
  - Request body: `{ "reason": "Required cancellation reason" }`
  - Refund: If cancelled when `accepted` before pickup, full refund is issued via `ledgerService.refundCancelledBooking` and all day locks are released. Late cancellations trigger trust score penalty event.
  - Response: `{ "booking": { ... }, "demo": true }` (status `cancelled`)
- `POST /bookings/:id/extensions`
  - Borrower only (when status is `accepted` or `picked_up`).
  - Request body: `{ "requestedEndDate": "YYYY-MM-DD" }` (must be > current `endDate`, within max 3 extensions).
  - Holds additional rental funds via `ledgerService.holdExtensionFunds`.
  - Response: `{ "booking": { ... }, "extension": { ... }, "demo": true }`
- `POST /bookings/:id/extensions/accept`
  - Lender only. Acquires additional `ItemDayLock` records and marks extension accepted.
  - Response: `{ "booking": { ... }, "demo": true }`
- `POST /bookings/:id/extensions/reject`
  - Lender only. Releases extension funds hold back to borrower available balance.
  - Request body: `{ "reason": "Optional reason" }`
  - Response: `{ "booking": { ... }, "demo": true }`

## Handover and return

- `POST /bookings/:id/handover/qr` lender requests a rotating QR for pickup
- `POST /bookings/:id/handover/scan` borrower submits scanned token and current position
- `POST /bookings/:id/handover/code` fallback 6-digit code
- `POST /bookings/:id/return/qr`, `POST /bookings/:id/return/scan`
- `POST /bookings/:id/photos` registers condition photos
- `POST /bookings/:id/return/confirm` lender: `{ outcome: "ok" | "problem", note }`

## Chat

- `GET /v1/bookings/:id/messages` (Query: `limit`, `before`, `after`, `cursor`):
  - Returns `{ messages: [...], nextCursor, hasMore }`.
  - Accessible only to booking participants (`borrowerId` or `lenderId`).
  - Read-only history when booking status is terminal (`completed`, `cancelled`, `expired`).
- `POST /v1/bookings/:id/messages`:
  - Body: `{ clientMessageId, type: "text" | "pin", text, pin: { latitude, longitude, addressText } }`.
  - Header: `Idempotency-Key` or body `clientMessageId` (enforced via unique index per conversation and sender).
  - Proposing a new pin automatically marks prior proposed pins as `superseded`, while preserving any existing confirmed pin in `conversation.confirmedPin` until a new pin is confirmed.
  - Sending refused with `400 BOOKING_TERMINAL_CHAT_CLOSED` if booking status is `completed`, `cancelled`, or `expired`.
- `POST /v1/bookings/:id/pin/confirm`:
  - Body: `{ messageId }`.
  - Proposer cannot confirm their own pin (`403 CANNOT_CONFIRM_OWN_PIN`); only the other participant can confirm.
  - Atomically marks target pin as `confirmed`, prior confirmed pins as `superseded`, and sets `conversation.confirmedPin`.
- `POST /v1/bookings/:id/messages/read`:
  - Body: `{ messageIds?: string[] }`. Marks unread messages as read by current participant and broadcasts `message:read`.
- Socket Events: `message:new`, `pin:proposed`, `pin:confirmed`, `booking:updated`, `notification:new`, `message:read`.
  - Inbound: `conversation:join` (`{ conversationId }`), `message:send` (`{ conversationId, clientMessageId, type, text, pin }`, ack callback), `pin:confirm` (`{ conversationId, messageId }`, ack callback), `message:read` (`{ conversationId, messageIds }`).
  - Outbound: `message:new`, `pin:proposed`, `pin:confirmed`, `booking:updated` (emitted on all booking lifecycle transitions), `notification:new`, `message:read`.
- Error Codes: `CANNOT_CONFIRM_OWN_PIN`, `PIN_OUT_OF_BOUNDS`, `BOOKING_TERMINAL_CHAT_CLOSED`, `MESSAGE_ALREADY_EXISTS`, `TOO_MANY_CONNECTIONS`, `RATE_LIMITED`.

## Ratings

- `POST /bookings/:id/rating`
- `GET /users/:id/ratings`

## Reports and blocks

- `POST /reports` targetType, targetId, reason, details

## Notifications

- `GET /notifications`, `POST /notifications/:id/read`, `POST /notifications/read-all`

## Disputes (users)

- `POST /bookings/:id/disputes`
- `GET /disputes/:id` (participants only)
- `POST /disputes/:id/appeal`

## Care portal (role care_agent or admin)

- `GET /care/disputes?status=`, `GET /care/disputes/:id` full case file
- `POST /care/disputes/:id/assign`
- `POST /care/disputes/:id/decision` depositToLenderPaise, depositToBorrowerPaise, rentOutcome, note
- `GET /care/reports`, `POST /care/reports/:id/action`
- `GET /care/users/:id` lookup with history

## Admin portal (role admin)

- `GET /admin/analytics/overview` users, items, bookings, volume, commission earned, open disputes
- `GET /admin/users`, `POST /admin/users/:id/ban|unban|reverse-strike`
- `GET /admin/communities`, `POST /admin/communities/:id/suspend|restore`
- `GET /admin/agents`, `POST /admin/agents`, `DELETE /admin/agents/:id`
- `GET /admin/appeals`, `POST /admin/appeals/:id/decide`
- `GET /admin/ads`, `PATCH /admin/ads/:placement`
- `GET /admin/audit-log`
- `GET /admin/ledger/reconciliation`

## Health

- `GET /health`, `GET /ready`
