# Antigravity Prompts

Use the master prompt once at the start. Then paste one phase prompt at a time. Do not start a phase until the previous one is tested.

---

## Master prompt

You are a senior full-stack engineer and technical lead. You are building **BorrowLoop (working name)**, a community borrowing platform, using the MERN stack, as a production-quality project that must be deployable, fully working and designed for 100,000 users.

### Step 1: read before you code

Read these files completely: `README.md`, `AGENTS.md` and everything in `docs/`. They are the source of truth. Do not invent business rules. If something is missing or conflicts, stop and ask me a clear question.

### Step 2: the product in brief

People join communities near them (campuses, hostels, neighbourhoods) and lend or borrow everyday items. The borrower pays rent and a security deposit from a demo-money wallet. The deposit and rent are frozen when the lender accepts. Handover and return use rotating QR codes and in-app photos. After a good return the deposit goes back and the lender gets the rent minus 15%. If there is a problem, a customer care agent decides the deposit split in a separate portal. Trust scores, ratings, strikes, reports, chat with a map pin, extensions, cancellations and late charges are all included. The wallet is demo money only, and the product is not public until real money is integrated legally.

### Step 3: architecture you must follow

- Monorepo with `apps/web` (user PWA), `apps/portal` (care and admin), `apps/api`, `apps/worker`, `packages/shared`.
- Plain JavaScript only (ES modules). Do not use TypeScript or `.ts` and `.tsx` files. React with Vite and Tailwind for the apps. Express and Mongoose for the API. MongoDB Atlas with transactions. Redis for cache, rate limits, queues (BullMQ) and the Socket.IO adapter. Leaflet with OpenStreetMap. Direct signed image uploads with CDN delivery.
- Follow `docs/ARCHITECTURE.md`, `docs/DATABASE_SCHEMA.md`, `docs/API_SPEC.md`, `docs/WALLET_AND_PAYMENTS.md`, `docs/BUSINESS_RULES.md` and `docs/SECURITY.md` exactly.
- Money is integer paise, moved only through the ledger service, inside transactions, with idempotency keys. The wallet sits behind a `PaymentProvider` interface.
- Business numbers come only from `packages/shared/src/config.js`.
- Design is clean and minimal, mobile first, and uses brand tokens from one file (see `docs/DESIGN_GUIDELINES.md`). Show "Demo money" wherever money appears.

### Step 4: how to work

- Follow `docs/ROADMAP.md` phase by phase. I will tell you which phase to start.
- Before coding a phase, write a short plan: files, endpoints, collections and tests. Wait for my approval.
- After each phase, report: what you built, how you tested it, how to run it, and any deviation from the documents.
- Every feature needs validation, authorisation checks, tests and updated docs.
- Write integration tests for money and booking flows, including failure cases and race conditions (for example two requests for the same dates at the same time).
- Never hard-code secrets. Provide `.env.example` files.
- Keep commits small and use conventional commit messages.

### Definition of done for the whole project

- All user flows in `docs/PRD.md` work end to end.
- Ledger invariants always hold (sum is zero, no negative balances, each booking settled once).
- Load test scripts and seed script exist and results are recorded.
- API documentation is generated and current.
- The apps are deployable to Vercel and Render with the variables in `docs/DEPLOYMENT.md`.

Reply with "Ready" and a list of any questions about the documents. Do not write code yet.

---

## Phase 0: foundation

Set up the monorepo with workspaces, plain JavaScript with ES modules, ESLint, Prettier, Husky pre-commit, Vitest or Jest, and GitHub Actions CI (lint, test, build). Create `packages/shared` with `config.ts` (all values from `docs/BUSINESS_RULES.md`), shared Zod schemas, error codes and money helpers (all in JavaScript). Create the API skeleton (Express app, config loader, pino logger, error handler, request ID, health and ready routes), the worker skeleton, and the web and portal skeletons with Tailwind and the brand token file. Add Docker Compose for local MongoDB (replica set), Redis and the apps. Add `.env.example` files. Plan first, then build.

## Phase 1: authentication and users

Build register, email verification, login, refresh with rotation and reuse detection, logout, forgot and reset password, profile photo through signed uploads, user profile endpoints, block and unblock, and portal login with TOTP for agents and admin. Add rate limits, lockout, validation and tests. Build the web screens: onboarding, sign up, login, verify email, profile. Follow `docs/SECURITY.md`.

## Phase 2: communities and location

Build the location prompt with a manual city search fallback, nearby communities (2dsphere), community detail, create, join, leave, private community requests and invite codes, owner member removal, and admin suspend. Users are added instantly to public communities. Build the matching screens. Test geo queries and private rules.

## Phase 3: items and search

Build item create, edit, pause and delete (blocked when a booking is open), up to 6 photos, prohibited-item check and report count hiding, text and distance search with filters and cursor pagination, item detail, and the availability calendar endpoint. Round item locations. Build the screens with blocked days in the date picker. Add indexes from `docs/DATABASE_SCHEMA.md` and tests.

## Phase 4: wallet and ledger

Build the ledger service (double entry, append-only), wallet with available, frozen and pending, the demo `PaymentProvider`, add and withdraw with the Rs 50,000 cap, transaction history, idempotency, and the nightly reconciliation job. Write property-style tests for the invariants in `docs/WALLET_AND_PAYMENTS.md`. Build the wallet screens with the "Demo money" label.

## Phase 5: bookings

Build the booking state machine with a single transition table, request with wallet check, accept (freeze funds and create day locks in one transaction), reject, auto-reject of overlapping requests, cancel before pickup with late-cancel penalty, expiry jobs, and extension requests. Test double-booking races, insufficient funds, and every legal and illegal transition.

## Phase 6: chat, notifications, jobs

Build per-booking chat with Socket.IO and the Redis adapter, map pin propose and confirm, message history and read state, the notification service (in-app plus email for important events with retries), and all background jobs listed in `docs/ARCHITECTURE.md`. Test that two API instances deliver events to each other's clients and that jobs are idempotent.

## Phase 7: handover, return, ratings, trust, strikes

Build the rotating QR (30 seconds, single use, bound to the booking) with proximity check and 6-digit fallback, in-app condition photos with server timestamps, return flow with lender confirmation and the 24-hour auto-complete, settlement with commission, late charge accrual and the 3-day "not returned" dispute, blind ratings, trust score recalculation, and the strike plan. Test the full borrow from request to settlement, including a late return.

## Phase 8: disputes, care portal, reports

Build dispute creation (damage, not returned, no-show), the case file (chat, photos, timeline, money), the care portal queue and decision form with money movement, one appeal to the admin, reports for items, users and messages, auto-hide at three reports, and the care user lookup. Log every read and decision in the audit log. Test decision money splits.

## Phase 9: admin portal and ads

Build the admin overview analytics (users, items, bookings, volume, commission earned, open disputes), user and community management, agent management, appeals, audit log, ledger reconciliation view, and ad controls. Add AdSense slot components, a consent banner and a master switch, off by default, with no ads on restricted pages.

## Phase 10: finish

Make the web app an installable PWA with offline shell. Run accessibility and performance checks. Write the seed script (100,000 users, 20,000 items, 5,000 communities) and k6 load tests, record results in `docs/LOAD_TEST_RESULTS.md`, generate API docs, finish the README, and verify the deployment steps in `docs/DEPLOYMENT.md` on staging.
