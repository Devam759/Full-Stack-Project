# API Specification

Base URL: `https://api.<domain>/v1`. JSON only. Authentication uses `Authorization: Bearer <accessToken>`. Money endpoints require an `Idempotency-Key` header.

## Standard error format

```
{ "error": { "code": "BOOKING_DATES_TAKEN", "message": "Readable message", "details": {} } }
```

Status codes: 400 validation, 401 not signed in, 403 not allowed, 404 not found, 409 conflict, 429 rate limit, 500 server error.

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

- `GET /wallet`
- `GET /wallet/transactions`
- `POST /wallet/add` amountPaise
- `POST /wallet/withdraw` amountPaise

## Bookings

- `POST /bookings` itemId, startDate, endDate
- `GET /bookings?role=borrower|lender&status=`
- `GET /bookings/:id`
- `POST /bookings/:id/accept`, `POST /bookings/:id/reject`
- `POST /bookings/:id/cancel` reason
- `POST /bookings/:id/extension`, `POST /bookings/:id/extension/approve|reject`

## Handover and return

- `POST /bookings/:id/handover/qr` lender requests a rotating QR for pickup
- `POST /bookings/:id/handover/scan` borrower submits scanned token and current position
- `POST /bookings/:id/handover/code` fallback 6-digit code
- `POST /bookings/:id/return/qr`, `POST /bookings/:id/return/scan`
- `POST /bookings/:id/photos` registers condition photos
- `POST /bookings/:id/return/confirm` lender: `{ outcome: "ok" | "problem", note }`

## Chat

- `GET /bookings/:id/messages`
- `POST /bookings/:id/messages` text or pin
- `POST /bookings/:id/pin/confirm`
- Socket events: `message:new`, `pin:proposed`, `pin:confirmed`, `booking:updated`, `notification:new`

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
