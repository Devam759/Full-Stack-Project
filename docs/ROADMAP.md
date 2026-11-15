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
| 8     | Disputes, care portal, reports, moderation                               | Agent decides a case and money moves correctly | Completed |
| 9     | Admin portal, analytics, audit log, ads placeholders and consent         | Admin sees live numbers                        | Completed |
| 10    | PWA, polish, accessibility, seed data, load test, API docs, deployment   | Public URL, load test results documented       | Next up   |

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

---

## Phase 8 Deliverables Summary (Completed)

- **8a: Contracts, State Machine & Foundations**:
  - Centralized dispute and report constants in `BUSINESS_CONFIG` (`DISPUTES.REASONS`, `DISPUTES.STATUSES`, `DISPUTES.APPEAL_WINDOW_DAYS: 7`, `REPORTS.CARE_ACTIONS`, single `ITEM_REPORTS_HIDE_THRESHOLD: 3`).
  - Added ledger entry types (`dispute_settlement`, `deposit_compensation`, `dispute_refund`) and notification types.
  - Booking state machine transitions: `OPEN_CONDITION_DISPUTE` (picked_up -> disputed, borrower only), `OPEN_NO_SHOW_DISPUTE` (accepted -> disputed, borrower/lender), `RESOLVE_DISPUTE` (disputed -> completed, care/admin), `RESOLVE_NO_SHOW_DISPUTE` (disputed -> cancelled, care/admin).
  - Transactional audit log writer `writeAuditLogTx(entry, { session })` guaranteeing all money decisions write an immutable audit log inside the caller's transaction.
  - Idempotent `strikeService.applyStrike` with explicit `eventKey` deduplication, and fixed `reverseStrike` to prevent un-freezing frozen accounts.
  - Removed offline/mock login bypass in `apps/portal/src/App.jsx`.
- **8b: Dispute Model & User Dispute Lifecycle**:
  - `Dispute.js` Mongoose model with unique `bookingId`, indexes on status/createdAt, evidence history, structured decision metadata, and appeal fields.
  - Outbox consumer handling `dispute.requested` idempotently with handover photo attachment and email/in-app notifications.
  - Backfill migration script `scripts/backfill-disputes.js`.
  - User endpoints: `POST /v1/bookings/:id/disputes` with Idempotency-Key, `POST /v1/disputes/:id/evidence` with signed Cloudinary uploads and photo cap enforcement, `GET /v1/disputes/:id` and `GET /v1/bookings/:id/dispute`.
- **8c: Atomic Dispute Settlement**:
  - `settleDisputeDecision` in `ledgerService.js` guarded with settle-once `LedgerOperation` (`operationType: 'dispute_settlement'`).
  - Zero-sum double-entry ledger guarantee across `lender_escrow`, `borrower_escrow`, `platform_revenue`, `lender_balance`, `borrower_balance`, and `dispute_reserve`.
  - Precise business math: 15% platform commission on late charges and rent, 0% commission on deposit compensation to lender.
- **8d: Care Portal API & Dispute Jobs**:
  - Staff routes protected by `authenticate(TOKEN_AUDIENCES.PORTAL)` and `requireRole('care_agent', 'admin')`.
  - `GET /v1/care/disputes` with status filtering and cursor pagination; `GET /v1/care/disputes/:id` with complete case file; `POST /v1/care/disputes/:id/assign` with conflict-of-interest check; `POST /v1/care/disputes/:id/decision` executing atomic settlement, trust penalties, and transactional audit logging.
  - User appeal route: `POST /v1/disputes/:id/appeal` validating the 7-day appeal window.
  - Worker jobs: `escalateDisputesJob` (flags unassigned disputes >24h) and `closeDisputesJob` (closes decided disputes after 7 days if no appeal).
- **8e: Reports & Content Moderation**:
  - `Report.js` model with unique compound index `(reporterUserId, targetType, targetId)`.
  - `POST /v1/reports` with target validation, rate limiting (10/hour), and automatic item hiding at 3 reports (`item_auto_hidden` domain event and notification).
  - Care moderation endpoints: `GET /v1/care/reports` with cursor pagination, `POST /v1/care/reports/:id/action` supporting `dismiss`, `hide_item`, `remove_item`, `restore_item`, `warn_user`, `strike_user`.
  - `GET /v1/care/users/:id` providing care agents full trust event history, active bookings, strike counts, and audit logs.
- **8f: Care Portal Frontend**:
  - Portal UI in `apps/portal/src/components/`: `DisputeQueue.jsx`, `CaseFileView.jsx`, `ModerationQueue.jsx`, `UserLookup.jsx`.
  - Live split computation, internal notes, Demo money visual cues, and zero mock auth fallbacks.
- **8g: User Web App Integration**:
  - `ReportModal.jsx` (item, user, message reporting with config reasons).
  - `OpenDisputeModal.jsx` (condition mismatch & no-show with signed dispute uploads).
  - `DisputeDetailScreen.jsx` (dispute timeline, evidence gallery, add evidence, decision finding banner, Demo money labels, 7-day appeal submission).
  - Embedded report buttons in `BookingDetailScreen.jsx`, `ItemDetailScreen.jsx`, and `ChatPanel.jsx`.
- **8h: Verification & Multi-Subsystem Audit**:
  - Invariants audit (`scripts/run-invariants-audit.js`) verified all 13 categories satisfied (zero paise imbalance, zero negative balances, zero duplicate refunds, zero orphaned locks, zero stuck events).
  - Monorepo linting (`npm run lint`) and code formatting (`npm run format:check`) 100% clean.

---

## Phase 9 Deliverables Summary (Completed)

- **9a: Contracts, Config, Models & Security Fixes**:
  - Added config constants for `ADMIN`, `APPEALS`, and `ADS` in `packages/shared/src/config.js` (`ALLOWED_SCREENS`, `RESTRICTED_SCREENS`, `CONSENT_MAX_AGE_DAYS: 180`, regexes for AdSense client ID and slot ID).
  - Added new ledger operation type `appeal_reversal` and notifications (`appeal_decided`, `user_banned`, `user_unbanned`, `strike_reversed`, `community_suspended`, `community_restored`, `staff_invited`, `staff_removed`).
  - Created `AdSetting.js` and `SystemSetting.js` Mongoose models; updated `Item.js` (`owner_banned`) and `Dispute.js` (`appeal` subdocument with `unrecoveredPaise`, `revisedDecision`, `originalSettlementSnapshot`).
  - Pure calculation engine `computeDisputeSettlement` in `packages/shared/src/disputeSettlement.js` sharing dispute settlement maths across care decisions and admin appeals.
  - Added security guards: append-only immutable Mongoose middleware on `AuditLog`, Redis-backed rate limiting and step deduplication for portal TOTP verification, and deterministic event keys for strike reversals.
- **9b: Analytics, Audit Log & Reconciliation**:
  - `GET /v1/admin/analytics/overview` utilizing single `$facet` aggregation pipelines, Redis 60s caching, Demo money labels, and derived metrics (dispute ratio, rented now, volume, deposits held, commission earned).
  - `GET /v1/admin/audit-log` with cursor pagination, date/action filtering, before/after JSON diffs, and strict PII masking (`a***@g***.com`, zero coordinates/secrets).
  - `GET /v1/admin/ledger/reconciliation` and `POST /v1/admin/ledger/reconciliation/run` with 5-minute cooldown guard (429) and BullMQ worker queue dispatch.
- **9c: User Moderation, Communities & Care Agents**:
  - User moderation: `GET /v1/admin/users`, `GET /v1/admin/users/:id` (with audit row), `POST /v1/admin/users/:id/ban` (refused with 409 `USER_HAS_ACTIVE_BOOKINGS` if user has active rentals; cancels pending/accepted bookings with borrower refunds, hides items with `owner_banned`, revokes refresh tokens, disconnects live sockets), `POST /v1/admin/users/:id/unban`, and `POST /v1/admin/users/:id/reverse-strike`.
  - Community moderation: `GET /v1/admin/communities` with cursor pagination and zero owner email leaks, `POST .../suspend`, `POST .../restore`.
  - Care agent lifecycle: `GET /v1/admin/agents`, `POST /v1/admin/agents` (promotes verified user, emails TOTP enrollment link without exposing secret to admin), `DELETE /v1/admin/agents/:id` (demotes agent, clears TOTP, resets assigned disputes to `opened`, protects last admin).
- **9d: Dispute Appeals & Money Reversal**:
  - `settleAppealDecision` in `ledgerService.js`: double-entry zero-sum reversal capping debits at available wallet balances, deducting unrecovered shortfalls from the highest gainer, and recording `unrecoveredPaise`.
  - `GET /v1/admin/appeals` with cursor pagination, `POST /v1/admin/appeals/:id/preview` (computes live deltas and detects shortfalls), and `POST /v1/admin/appeals/:id/decide` (`upheld` vs `overturned`, enforcing conflict of interest 403, no-show refund rules, and mandatory `acknowledgeShortfall: true`).
- **9e: Ads Configuration API**:
  - Admin routes: `GET /v1/admin/ads`, `PATCH /v1/admin/ads/:placement` (validates slot format, invalidates cache, writes audit row), `POST /v1/admin/ads/master` (requires explicit `confirm: 'ENABLE_ADS'`, validates client ID format).
  - Public cached route: `GET /v1/ads/config` (60s Redis cache; defaults to off, returning zero active placements when master is off).
- **9f: Portal Admin Frontend**:
  - Full suite of admin interfaces in `apps/portal/src/components/admin/`: `AdminOverview.jsx`, `AdminUsers.jsx`, `AdminCommunities.jsx`, `AdminStaff.jsx`, `AdminAppeals.jsx`, `AdminReconciliation.jsx`, `AdminAuditLog.jsx`, `AdminAds.jsx`.
  - Strict role-based routing: care agents cannot access admin tabs (403); admins land on overview with admin badge and masked email.
- **9g: User Web App Ads & Consent**:
  - `adConsent.js`: 180-day consent expiry, accept, decline, and withdraw helper functions.
  - UI components: `ConsentBanner.jsx`, `AdPreferencesModal.jsx`, and `AdSlot.jsx` (enforces screen allowlist/denylist, checks master enabled, injects AdSense script tag once lazily into `head`).
  - Placements integrated on `ItemsBrowseScreen.jsx` (`home_banner`, `search_results`) and `ItemDetailScreen.jsx` (`item_sidebar`), with footer "Ad preferences" withdrawal link.
- **9h: Verification, Invariants Audit & Sign-Off**:
  - Invariants audit (`scripts/run-invariants-audit.js`) expanded to 14 invariant categories including Invariant 14: "Admin Audit Log Integrity" (verifies all admin audit records have an actor, reason, and valid target). All 14/14 satisfied with 0 mismatches.
  - Full test suites pass across all packages and apps: 100% clean formatting and linting.
