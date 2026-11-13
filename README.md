# BorrowLoop (working name)

A community borrowing platform for campuses, hostels and neighbourhoods. People lend, borrow and extend the use of everyday items, with a security deposit, QR handover, ratings and a customer care team to resolve disputes.

> **Status: demo only.** The wallet uses demo money. The platform will not be opened to the general public until real money is integrated in a licensed and legally reviewed way.

The name, logo and brand guidelines are not final. All brand values live in one config file so they can be replaced later (see `docs/DESIGN_GUIDELINES.md`).

## Stack

- Language: plain JavaScript (ES modules) in every app. No TypeScript.
- Frontend: React (Vite), Tailwind CSS, React Query, installable PWA. Hosted on Vercel.
- Backend: Node.js 22 LTS, Express, Mongoose. Hosted on Render (API service and separate worker service).
- Database: MongoDB Atlas (replica set, transactions enabled).
- Cache, queues, rate limits, socket scaling: Redis.
- Real time: Socket.IO with the Redis adapter.
- Images: Cloudinary (or equivalent) with CDN delivery.
- Maps: Leaflet with OpenStreetMap tiles.
- Email: transactional email provider behind an interface.
- Ads: Google AdSense (switched off until the public launch).

## Repository layout

```
borrowloop/
  apps/
    web/        User app (PWA)
    portal/     Customer care and admin portal
    api/        Express API and Socket.IO server
    worker/     Background jobs (BullMQ)
  packages/
    shared/     Shared validation schemas, constants and helpers (plain JavaScript)
  docs/         Project documents (read these first)
  AGENTS.md     Rules for AI coding agents
```

## Documents

| File                               | Purpose                                         |
| ---------------------------------- | ----------------------------------------------- |
| `docs/PRD.md`                      | Product scope, roles and user flows             |
| `docs/BUSINESS_RULES.md`           | Every rule and number (fees, limits, penalties) |
| `docs/WALLET_AND_PAYMENTS.md`      | Ledger, money movement, booking states          |
| `docs/ARCHITECTURE.md`             | System design for 100,000 users                 |
| `docs/DATABASE_SCHEMA.md`          | Collections, fields and indexes                 |
| `docs/API_SPEC.md`                 | REST and socket endpoints                       |
| `docs/SECURITY.md`                 | Security and privacy requirements               |
| `docs/DESIGN_GUIDELINES.md`        | Visual and interaction guidelines               |
| `docs/DEPLOYMENT.md`               | Environments, hosting and configuration         |
| `docs/ROADMAP.md`                  | Build phases and team split                     |
| `docs/DECISIONS_AND_OPEN_ITEMS.md` | Decisions taken and items still open            |

---

## Local Run Guide

### 1. Prerequisites

- **Node.js**: `v22.x` or newer (see `.nvmrc`)
- **npm**: `v10.x` or newer
- **Docker & Docker Compose**: For local MongoDB replica set (with transactions) and Redis.

### 2. Install Dependencies

```bash
npm install
```

### 3. Start Local Database & Redis (Replica Set)

Start MongoDB on port 27018 (with transactions enabled, single-node replica set `rs0`, `directConnection=true`), Redis, and Mailpit:

```bash
docker compose up -d
```

Verify the replica set status:

```bash
docker compose exec mongo mongosh --port 27018 --eval "rs.status().ok"
```

### 4. Setup Environment Files

Copy the `.env.example` templates in each app:

```bash
cp apps/api/.env.example apps/api/.env
cp apps/worker/.env.example apps/worker/.env
cp apps/web/.env.example apps/web/.env
cp apps/portal/.env.example apps/portal/.env
```

### 5. Running Development Servers

You can start all services concurrently:

```bash
npm run dev
```

Or run any app individually:

```bash
npm run dev:api     # Express API on http://localhost:4000
npm run dev:worker  # BullMQ background worker
npm run dev:web     # User PWA on http://localhost:5173
npm run dev:portal  # Care & Admin portal on http://localhost:5174
```

### 6. Running Tests & Linters

- **Run tests against in-memory replica set (Default)**:
  ```bash
  npm test
  ```
- **Run tests against the Docker replica set (Port 27018)**:
  ```bash
  # Windows PowerShell:
  $env:MONGODB_TEST_URI="mongodb://127.0.0.1:27018/borrowloop_test?replicaSet=rs0&directConnection=true"
  npm test

  # Linux / macOS:
  MONGODB_TEST_URI="mongodb://127.0.0.1:27018/borrowloop_test?replicaSet=rs0&directConnection=true" npm test
  ```
- **Lint the entire monorepo**:
  ```bash
  npm run lint
  ```
- **Check formatting (Prettier)**:
  ```bash
  npm run format:check
  ```
- **Build all applications**:
  ```bash
  npm run build
  ```

### 7. Clean Archive Creation (Excluding node_modules and dist)

To package or archive the repository cleanly without dependencies and build artifacts:

```bash
# Using Git archive:
git archive -o borrowloop-clean.zip HEAD

# Or using PowerShell:
Compress-Archive -Path (Get-ChildItem -Exclude 'node_modules', 'dist', '.git') -DestinationPath borrowloop-clean.zip

# Or using zip/tar directly:
zip -r borrowloop-clean.zip . -x "**/node_modules/*" -x "**/dist/*" -x "**/.git/*" -x "**/.turbo/*"
```
