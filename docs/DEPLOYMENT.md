# Deployment

You will deploy this yourself. This file lists what the code expects.

## Environments

`local`, `staging`, `production`. Each has its own database, Redis and keys.

## Hosting

| Part                                  | Host                                                   |
| ------------------------------------- | ------------------------------------------------------ |
| User app (`apps/web`)                 | Vercel                                                 |
| Care and admin portal (`apps/portal`) | Vercel (separate project)                              |
| API (`apps/api`)                      | Render web service, 2 or more instances for production |
| Worker (`apps/worker`)                | Render background worker                               |
| Database                              | MongoDB Atlas (replica set, transactions required)     |
| Redis                                 | A managed Redis service                                |
| Images and CDN                        | Cloudinary or similar                                  |

## Domains

Use one custom domain with `app.`, `portal.` and `api.` sub-domains so cookies work (see `ARCHITECTURE.md`, section 9).

## Environment variables

API and worker:
`NODE_ENV, PORT, MONGODB_URI, REDIS_URL, JWT_ACCESS_SECRET, JWT_REFRESH_SECRET, JWT_AUDIENCE, CLIENT_ORIGINS, PORTAL_ORIGIN, IMAGE_CLOUD_NAME, IMAGE_API_KEY, IMAGE_API_SECRET, EMAIL_PROVIDER_KEY, EMAIL_FROM, SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_SECURE, SENTRY_DSN, GEOCODER_URL, GEOCODER_KEY, ALLOW_DEMO_MONEY, OUTBOX_POLL_INTERVAL_MS`
Web and portal:
`VITE_API_URL, VITE_SOCKET_URL, VITE_MAPS_TILE_URL, VITE_ADSENSE_CLIENT_ID, VITE_ADS_ENABLED`

## WebSocket Configuration & Multi-Instance Scaling

- **Sticky Sessions vs WebSocket-only**: When running multiple API instances on hosts that do not support HTTP sticky sessions (e.g., Render web services without session affinity), clients must configure the WebSocket transport directly:
  ```js
  io(SOCKET_URL, { transports: ['websocket'], reconnection: true });
  ```
- **Redis Adapter**: Every API instance connects to the central Redis instance using `@socket.io/redis-adapter` so room events (`user:<id>`, `conversation:<id>`) fan out transparently across all nodes.
- **Failover & Reconnection**: On node failure or rolling deploys, clients automatically reconnect to surviving instances and fetch missed messages via keyset cursor pagination (`GET /bookings/:id/messages?direction=after&cursor=<id>`).

## Worker Architecture and Independence

The background worker (`apps/worker`) depends only on workspace packages (`@borrowloop/shared`, `@borrowloop/server-core`) and external dependencies. It deploys independently without mounting or requiring the `apps/api` source tree. Both email consumption and booking lifecycle expiry run as BullMQ workers in this process.

## Release steps

1. Merge to `main` after CI passes (lint, tests, build).
2. Deploy staging, run the smoke test.
3. Promote to production.
4. Check `/health` and `/ready`, then watch errors and queue depth.

## Operations

- Daily database backups and one tested restore.
- Alerts for error rate, slow responses, queue backlog and ledger mismatch.
- Keep a rollback plan for every release.

## Before any public launch

- Replace demo money with a legally approved real-money method.
- Legal review of terms, privacy policy, prohibited items and money handling.
- Switch on ads only after the site meets AdSense requirements (check Google's current rules, including domain requirements).
