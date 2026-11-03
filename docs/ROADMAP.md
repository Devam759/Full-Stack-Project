# Roadmap and Team Split

Build one phase at a time. Each phase ends with working, tested features on the staging site.

| Phase | Content                                                                  | Done when                                      |
| ----- | ------------------------------------------------------------------------ | ---------------------------------------------- |
| 0     | Monorepo, tooling, CI, config, brand tokens, shared package              | CI passes, apps start                          |
| 1     | Auth, profile photo, email verification, portal login with TOTP          | User can register, verify, log in and refresh  |
| 2     | Communities, location prompt, nearby communities, join and private rules | New user sees nearby communities and joins     |
| 3     | Items, uploads, search (text and distance), availability calendar        | Lender lists, borrower finds with filters      |
| 4     | Wallet, ledger, demo add and withdraw, cap, reconciliation               | Ledger invariants pass in tests                |
| 5     | Booking lifecycle, locks, accept and reject, cancel, expiry, extension   | Full state machine tested                      |
| 6     | Chat, map pin, real-time notifications, email, background jobs           | Messages and alerts arrive on two instances    |
| 7     | QR handover and return, photos, ratings, trust score, strikes            | Complete borrow works end to end               |
| 8     | Disputes, care portal, reports, moderation                               | Agent decides a case and money moves correctly |
| 9     | Admin portal, analytics, audit log, ads placeholders and consent         | Admin sees live numbers                        |
| 10    | PWA, polish, accessibility, seed data, load test, API docs, deployment   | Public URL, load test results documented       |

## Team of three (suggested split)

- Person A, backend core: phases 1, 4, 5, 7 (auth, ledger, bookings, handover). Owns money correctness.
- Person B, user app: phases 2, 3, 6 (frontend for communities, items, chat, notifications) plus the PWA.
- Person C, portals and platform: phases 8, 9, 10 (care and admin portals, worker, CI, deployment, load tests).
  All three review each other's money and booking code.

## Working agreements

- Short branches, pull requests with review, no direct commits to `main`.
- The shared package is the contract for validation schemas and constants. Change it first, then the apps.
- Demo to faculty after phases 5, 7 and 10.
