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

- Socket.IO with the Redis adapter so events reach users on any instance.
- Rooms: `user:<id>`, `conversation:<id>`.
- Messages are saved first, then emitted. Clients fetch missed messages on reconnect.
- If the host does not support sticky sessions, use the WebSocket transport only.

## 8. Background jobs (BullMQ)

| Job                                                  | Frequency               |
| ---------------------------------------------------- | ----------------------- |
| Expire unanswered requests                           | Every 5 minutes         |
| Expire bookings without pickup                       | Every 15 minutes        |
| Send due reminders                                   | Every 15 minutes        |
| Accrue late charges and open "not returned" disputes | Hourly                  |
| Auto-complete returns after 24 hours                 | Every 15 minutes        |
| Reveal ratings after 7 days                          | Daily                   |
| Ledger reconciliation                                | Nightly                 |
| Email sending                                        | On demand, with retries |

Jobs must be idempotent. Use repeatable jobs so only one instance schedules each job.

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
