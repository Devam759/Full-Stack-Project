# Architecture (designed for 100,000 users)

## 1. Design targets

These are planning assumptions, not measured results. Confirm them with a load test.

- 100,000 registered users, about 5% active daily (5,000 users).
- Peak of about 500 concurrent users and about 150 API requests per second.
- Up to 2,000 concurrent socket connections.
- Read-heavy traffic (search and browse) at about 9 reads to 1 write.

## 2. Overview

```
Browser (PWA)  --->  Vercel (web, portal)  --->  api.<domain>  (Render, 2+ instances)
                                                   |        |
                                                   |        +--> Redis (cache, rate limit, queues, socket adapter)
                                                   +--> MongoDB Atlas (replica set)
                          Worker (Render) <--- BullMQ queues in Redis
                          Images -> Cloudinary -> CDN
                          Email  -> provider API
```

## 3. Principles

- The API is stateless so any number of instances can run.
- Slow work (email, reminders, late charges, expiry, reconciliation) runs in the worker, never in a request.
- Uploads go straight from the browser to the image service using signed upload requests. The API only stores the resulting URL.
- Images are served from the CDN with resized variants.

## 4. Backend structure

```
api/src
  modules/ auth users communities items bookings wallet chat
           handover disputes reports ratings notifications admin care ads
  common/  errors validation middleware logger config
  jobs/    (producers only)
  sockets/
worker/src  processors for each queue
```

Each module has routes, controller, service, repository and tests. Controllers hold no business logic.

## 5. Data and indexes

- Nearby search: `2dsphere` index on item and community locations.
- Text search: Atlas text index (or Atlas Search) on item title and description.
- Compound indexes for the common queries: `(communityIds, status, category, createdAt)`, `(borrowerId, status)`, `(lenderId, status)`, `(itemId, startDate, endDate)`.
- Unique index on `item_day_locks (itemId, day)`.
- Use cursor pagination. Never use skip with large offsets.
- Use `lean()` reads and field projection on list endpoints.
- TTL indexes for expired tokens and old notifications.

## 6. Caching

- Cache popular reads in Redis for a short time: community list by area, item detail, category counts.
- Invalidate on write.
- Do not cache wallet balances or booking state.

## 7. Real time

- Socket.IO with the `@socket.io/redis-adapter` so events reach users on any instance.
- Rooms: `user:<id>` (private alerts, notifications), `conversation:<id>` (per-booking chat).
- Security & Guards:
  - JWT access token required in handshake auth or Authorization header.
  - Expired tokens, malformed signatures, or wrong audience rejected immediately.
  - Banned, frozen, or deleted users refused connection.
  - `conversation:join` verifies user is in `conversation.participantIds` and verifies neither user has blocked the other via `Block` model.
  - Mid-session cutoff: `disconnectUser(userId, reason)` forcefully disconnects all active sockets when a user is banned, frozen, or blocked.
  - Connection & Payload limits: Maximum 5 concurrent sockets per user in Redis; 10 KB maximum event payload.
  - Rate limiting: Redis sliding window limits on `message:send`, `pin:propose`, and `pin:confirm`.
- Persistence guarantee: Messages are saved to MongoDB before emission. Clients fetch missed messages on reconnect using keyset cursor pagination with zero gaps and zero duplicates.
- If the host does not support sticky sessions, use the WebSocket transport only (`transports: ['websocket']`).

## 8. Background jobs & Transactional Outbox (BullMQ)

- **BullMQ Repeatable Scheduler**: In-process `setInterval` timers are replaced by BullMQ repeatable jobs registered with fixed, deterministic `jobId`s (e.g., `job:pickup_reminders`, `job:due_reminders`, `job:accrue_late_charges`, `job:auto_complete_returns`, `job:reveal_ratings`, `ledger_reconciliation_nightly`, and `booking_lifecycle_expiry_scanner`). All schedules are strictly sourced from `BUSINESS_CONFIG.BACKGROUND_JOBS`. Stale or obsolete repeatable jobs from prior deploys are automatically audited and removed on startup (`removeStaleRepeatableJobs`). Across multiple worker instances, BullMQ's deterministic repeat keys guarantee exactly one job entry per schedule in Redis.
- **Transactional Outbox**: All domain events are saved to `domain_events` inside the same MongoDB transaction that executes the business action.
- **Atomic Claim**: Outbox dispatcher claims pending events via atomic `DomainEvent.findOneAndUpdate`, ensuring multiple worker processes never process the same event. Crashed worker claims lease-expire after 5 minutes (`LEASE_TIMEOUT_MS`). Retries with exponential backoff up to `MAX_RETRIES` (5).
- **Idempotency & Deduplication**: All in-app notifications enforce a unique sparse index on `dedupeKey`. Email jobs enqueued to BullMQ enforce deterministic `jobId: email_${dedupeKey.replace(/:/g, '_')}` so two workers can never send duplicate emails.
- **Distributed Locking**: Every background job runs within `runWithRedisLock` using atomic Redis `SET NX PX` and Lua release scripts.

### Final Background Jobs Table

| Job                                  | Schedule Config Key in `BUSINESS_CONFIG.BACKGROUND_JOBS` | Frequency             | Idempotency / Dedupe Mechanism                       | Status   |
| ------------------------------------ | -------------------------------------------------------- | --------------------- | ---------------------------------------------------- | -------- |
| Expire unanswered requests           | `EXPIRE_REQUESTS_MINUTES`                                | Every 5 minutes       | `status: 'requested'` conditional transition         | Active   |
| Expire bookings without pickup       | `EXPIRE_PICKUPS_MINUTES`                                 | Every 15 minutes      | Settle-once `LedgerOperation`, state machine guard   | Active   |
| Expire unanswered extensions         | `EXPIRE_EXTENSIONS_MINUTES`                              | Every 15 minutes      | Settle-once `LedgerOperation`, extension state guard | Active   |
| Send pickup reminders                | `PICKUP_REMINDERS_MINUTES`                               | Every 15 minutes      | `dedupeKey: notif:pickup_rem:${id}:${uid}:${date}`   | Active   |
| Send due reminders                   | `DUE_REMINDERS_MINUTES`                                  | Every 15 minutes      | `dedupeKey: notif:due_rem:${id}:${uid}:${date}`      | Active   |
| Accrue late charges & open disputes  | `ACCRUE_LATE_CHARGES_MINUTES`                            | Hourly                | Guarded by feature flag (Phase 7 feature)            | Deferred |
| Auto-complete returns after 24 hours | `AUTO_COMPLETE_RETURNS_MINUTES`                          | Every 15 minutes      | Guarded by feature flag (Phase 7 feature)            | Deferred |
| Reveal ratings after 7 days          | `REVEAL_RATINGS_HOURS`                                   | Daily                 | Guarded by feature flag (Phase 7 feature)            | Deferred |
| Ledger reconciliation                | `LEDGER_RECONCILIATION_CRON`                             | Nightly (`0 2 * * *`) | Redis distributed lock, snapshot-read transaction    | Active   |
| Outbox dispatcher                    | `OUTBOX_DISPATCHER_SECONDS`                              | Every 10 seconds      | Atomic `findOneAndUpdate` claim, 5 min lease         | Active   |
| Email sending                        | Worker BullMQ queue `email_queue`                        | On demand             | BullMQ custom `jobId: email_${dedupeKey}`            | Active   |

## 9. Authentication across domains

Vercel and Render use different hosts, and some browsers block cross-site cookies. Use a custom domain with sub-domains of the same site: `app.<domain>`, `portal.<domain>`, `api.<domain>`.

- Access token: short-lived, kept in memory.
- Refresh token: httpOnly, Secure, SameSite=Lax cookie on the API sub-domain, rotated on each use, with reuse detection.
- If no custom domain is available, fall back to sending the refresh token in the request body and storing it carefully. Treat this as a temporary option.

## 10. Observability

- Structured logs (pino) with request IDs.
- Health endpoints: `/health` and `/ready`.
- Error tracking (for example Sentry).
- Metrics: request time, error rate, queue depth, socket count.

## 11. Load testing

- Provide k6 scripts for login, search, item detail, booking request and chat.
- Provide a seed script that creates 100,000 users, 20,000 items and 5,000 communities for realistic tests.
- Record the results in `docs/LOAD_TEST_RESULTS.md` for the presentation.

## 12. Known limits to state honestly

- Free hosting tiers may sleep and will not reach these numbers. The design is ready for 100,000 users. The demo deployment may run smaller.
- Public geocoding services have usage limits. Use a configurable provider.
