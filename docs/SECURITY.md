# Security and Privacy Requirements

## Authentication and sessions

- Passwords hashed with argon2id or bcrypt (cost 12 or higher). Minimum length 8 with a breached-password check if possible.
- Email confirmation before a user can list items or book.
- Access token about 15 minutes. Refresh token rotated on every use with reuse detection. Revoke the whole token family on reuse.
- Lock or slow down logins after repeated failures. Use the same response for unknown email and wrong password.
- Password reset links are single use and expire quickly.
- Agents and admin: separate login, mandatory two-step verification (TOTP), shorter sessions.

## Authorisation

- Check role and ownership on every endpoint, not only in the interface.
- Users see only their own bookings, chats, wallet and disputes. Care agents see only the cases they open. Every care or admin read of a case is logged.

## Real-time & WebSocket Authorisation Rules

- **Handshake Authentication**: Every WebSocket connection must supply a valid JWT access token. Expired tokens, signature mismatches, or wrong audience are rejected with connection errors.
- **Status Guards**: Banned, frozen, and deleted users are strictly rejected at the handshake layer.
- **Room Authorization & Chat Access**: Clients can only join `conversation:<id>` or access `/v1/bookings/:id/messages` if they are verified participants (`borrowerId` or `lenderId`) in the underlying booking. Care agents see only the dispute cases they open/are assigned to (deferred to Phase 8). An admin or care agent who is personally a participant in a booking uses the standard participant routes for their own bookings; non-participant staff access without an active assigned dispute is strictly forbidden.
- **Block Protection**: If either party in a conversation has blocked the other, room joins are refused with `BLOCKED`.
- **Mid-Session Cutoff**: When a user's account is banned, frozen, or deleted, all active WebSocket connections across all nodes are immediately severed using `disconnectUser`.
- **Resource Protection**: Maximum 5 concurrent WebSocket connections per user; 10 KB maximum event payload limit; per-event Zod validation with structured error acks; Redis rate limiting on message send and pin confirmation.
- **Privacy Enforcement**: Messages, in-app notifications, and emails must NEVER reveal user wallet balances or exact home addresses. Emails must NEVER reveal meetup pin coordinates.

## Input and API safety

- Zod validation for all input. Reject unknown fields.
- Sanitise against NoSQL operator injection.
- Helmet headers, a strict CORS allow-list, request size limits.
- Rate limits stored in Redis: stricter on login, register, wallet, chat and reports.
- Idempotency keys on money and booking endpoints.

## Money integrity

- Ledger is append-only. No update or delete routes.
- Nightly reconciliation job. Alert on any mismatch.
- Admin actions that change money create ledger entries and audit logs.

## Uploads

- Signed uploads only. Limit type (JPEG, PNG, WebP) and size.
- Remove location metadata (EXIF) from images before they are served. Verify the chosen image provider's option for this.
- Handover photos must be captured in the app and carry a server timestamp.
- Add an image moderation step or a manual review path for reported images.

## Location privacy

- Store approximate locations only. Never show exact addresses or coordinates of homes.
- Show distance bands such as "about 2 km".
- Meeting pins are visible only to the two people in the booking.
- Suggest public meeting places. Provide block and report features and a safety tips page.

## Handover QR

- QR token is bound to one booking, expires in 30 seconds and is single use.
- Check that both phones are near each other. Provide the 6-digit fallback code with limited attempts.

## Personal data

- Collect only what is needed. Show a clear privacy policy and terms (including minimum age 18 and the demo-money notice).
- Provide account deletion and data export.
- India's Digital Personal Data Protection Act applies once real users are involved. Get legal review before the public launch.
- Show a cookie and ads consent banner before ads load.

## Secrets and operations

- Keep secrets in environment variables only. Never commit them.
- Rotate keys when a team member leaves. Run dependency audits in CI.
- Take regular database backups. Test one restore.
