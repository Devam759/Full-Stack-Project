# Roadmap and Team Split

Build one phase at a time. Each phase ends with working, tested features on the staging site.

| Phase | Content                                                                  | Done when                                      | Status    |
| ----- | ------------------------------------------------------------------------ | ---------------------------------------------- | --------- |
| 0     | Monorepo, tooling, CI, config, brand tokens, shared package              | CI passes, apps start                          | Completed |
| 1     | Auth, profile photo, email verification, portal login with TOTP          | User can register, verify, log in and refresh  | Completed |
| 2     | Communities, location prompt, nearby communities, join and private rules | New user sees nearby communities and joins     | Completed |
| 3     | Items, uploads, search (text and distance), availability calendar        | Lender lists, borrower finds with filters      | Completed |
| 4     | Wallet, ledger, demo add and withdraw, cap, reconciliation               | Ledger invariants pass in tests                | Completed |
| 5     | Booking lifecycle, locks, accept and reject, cancel, expiry, extension   | Full state machine tested                      | Completed |
| 6     | Chat, map pin, real-time notifications, email, background jobs           | Messages and alerts arrive on two instances    | Completed |
| 7     | QR handover and return, photos, ratings, trust score, strikes            | Complete borrow works end to end               | Completed |
| 8     | Disputes, care portal, reports, moderation                               | Agent decides a case and money moves correctly | Next up   |
| 9     | Admin portal, analytics, audit log, ads placeholders and consent         | Admin sees live numbers                        | Planned   |
| 10    | PWA, polish, accessibility, seed data, load test, API docs, deployment   | Public URL, load test results documented       | Planned   |

## Team of three (suggested split)

- Person A, backend core: phases 1, 4, 5, 7 (auth, ledger, bookings, handover). Owns money correctness.
- Person B, user app: phases 2, 3, 6 (frontend for communities, items, chat, notifications) plus the PWA.
- Person C, portals and platform: phases 8, 9, 10 (care and admin portals, worker, CI, deployment, load tests).
  All three review each other's money and booking code.

## Working agreements

- Short branches, pull requests with review, no direct commits to `main`.
- The shared package is the contract for validation schemas and constants. Change it first, then the apps.
- Demo to faculty after phases 5, 7 and 10.

---

## Phase 7 Deliverables Summary (Completed)

- **7a: Contracts First**:
  - Booking state machine: `PICKUP_HANDOVER` (actor: borrower), `RETURN_HANDOVER` (actor: lender), `REPORT_PROBLEM` (returned -> disputed), `OPEN_NOT_RETURNED_DISPUTE` (picked_up -> disputed on overdue threshold).
  - Business config constants: `HANDOVER` limits (200m max distance, 100m accuracy slack, 25s QR refresh, 15m lockout, 30m photo window, 6 photos max), `RATINGS.COMMENT_MAX_LENGTH: 500`, return confirmation reminder 4h before deadline.
  - Pure calculation engines: `lateCharge.js` and `trustScore.js` with comprehensive unit tests.
  - Zod schemas: `schemas/handoverSchemas.js`, `schemas/ratingSchemas.js`.
  - Mongoose models extended: `completedAt`, `completedBy`, `returnConfirmDeadline`, `disputeReason`, `disputeOpenedAt`. User derived fields cached: `trustScore`, `ratingAvg`, `ratingCount`, `strikes`, `banUntil`.
- **7b: Pickup Handover**:
  - `Handover.js` model storing `distanceMeters`, `geoChecked`, `fallbackCodeUsed`, `photos[]`, and cryptographic hashes (zero coordinate persistence).
  - Rotating HMAC QR tokens (25s TTL) with atomic single-use consumption (`$set: { qrConsumedAt: now }`).
  - Proximity validation (Haversine distance minus capped accuracy allowance <= 200m).
  - 6-digit fallback HMAC code (3 wrong attempts -> 15 min lockout via atomic outside-tx `$inc`).
  - Signed condition photo uploads with folder verification and 30-minute window.
- **7c: Return Handover & Settlement**:
  - Return QR generation (borrower) and scan (lender).
  - Lender return confirmation endpoint (`POST /v1/bookings/:id/return/confirm`) for `'ok'` vs `'problem'`.
  - Atomic ledger settlement: 15% platform commission to `platform_revenue`, security deposit refunded minus late fees, earnings credited to lender, early return unused day locks released.
  - Automated `autoCompleteReturnsJob` for 24-hour review window expiration with 4-hour advance reminder.
- **7d: Late Charges & Not-Returned Dispute**:
  - `lateChargeJob` running hourly computing absolute late charges $f(\text{now})$.
  - Daily notification deduplication by date.
  - Automated dispute opening at `now >= dueAt + OVERDUE_DISPUTE_SECONDS` with borrower freeze (`status: 'frozen'`).
  - Auth middleware allowing frozen accounts read-only access to own bookings and wallet history while blocking mutations.
- **7e: Trust Events, Trust Scores, and Strikes**:
  - Append-only `TrustEvent.js` model and `trustService.recompute(userId)`.
  - Strike ladder (`strikeService.js`): Strike 1 warning -> Strike 2 7-day suspension -> Strike 3 permanent ban.
  - `assertNotSuspended` guard protecting booking creation/acceptance and item listing/relisting.
  - Backfill script `scripts/backfill-trust-events.js`.
- **7f: Blind Ratings**:
  - `Rating.js` model with mutual reveal logic (`isRevealed: true` on second submission or after 7-day window via `revealRatingsJob`).
  - Day 5 reminder notification.
  - Strict HTML sanitization and keyset pagination.
- **7g: Web Frontend**:
  - `QRModal.jsx`, `QRScannerModal.jsx`, `ConditionPhotosUploader.jsx`, `RatingModal.jsx`, `TrustBadge.jsx`, `SuspensionBanner.jsx`.
  - Updated `BookingDetailScreen.jsx`, `ProfileScreen.jsx`, `ItemDetailScreen.jsx` with full handover UI, live socket updates, and Demo money callouts.
- **7h: Multi-Party E2E Tests & Audit**:
  - Multi-party E2E test suite (`apps/api/tests/phase7E2E.test.js`) verifying happy path, damage dispute, not-returned dispute, and ledger invariants.
  - Invariants audit (`scripts/run-invariants-audit.js`) verified 13/13 categories satisfied with 0 mismatches.
