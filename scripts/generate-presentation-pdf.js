/**
 * @file scripts/generate-presentation-pdf.js
 * Generates docs/presentation_slides.pdf for CS1237 MERN Semester Project submission.
 * Uses headless Microsoft Edge (built into Windows) to render high-resolution presentation slides.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>BorrowLoop — Engineering Presentation & Defense</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap');

    @page {
      size: A4 landscape;
      margin: 12mm 15mm;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
      color: #0f172a;
      background: #f8fafc;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }

    .slide {
      width: 100%;
      min-height: 180mm;
      page-break-after: always;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      padding: 24px 32px;
      background: #ffffff;
      border: 1px solid #e2e8f0;
      border-radius: 12px;
      margin-bottom: 24px;
      position: relative;
    }

    .slide:last-child {
      page-break-after: avoid;
    }

    .slide-header {
      border-bottom: 2px solid #0d9488;
      padding-bottom: 12px;
      margin-bottom: 16px;
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
    }

    .slide-title {
      font-size: 24px;
      font-weight: 800;
      color: #0f172a;
      letter-spacing: -0.02em;
    }

    .slide-subtitle {
      font-size: 13px;
      color: #0d9488;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .slide-footer {
      border-top: 1px solid #e2e8f0;
      padding-top: 10px;
      margin-top: 16px;
      display: flex;
      justify-content: space-between;
      font-size: 11px;
      color: #64748b;
    }

    .slide-body {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 14px;
    }

    .hero-title {
      font-size: 38px;
      font-weight: 800;
      color: #0f172a;
      line-height: 1.15;
    }

    .hero-tag {
      font-size: 16px;
      color: #0d9488;
      font-weight: 700;
    }

    .grid-2 {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 18px;
    }

    .grid-3 {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr;
      gap: 16px;
    }

    .card {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 16px;
    }

    .card-title {
      font-size: 14px;
      font-weight: 700;
      color: #0f172a;
      margin-bottom: 8px;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .card p, .card li {
      font-size: 12px;
      line-height: 1.5;
      color: #334155;
    }

    ul {
      margin-left: 18px;
    }

    li {
      margin-bottom: 4px;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 11px;
      background: #ffffff;
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      overflow: hidden;
    }

    th {
      background: #0f172a;
      color: #ffffff;
      padding: 8px 12px;
      text-align: left;
      font-weight: 600;
      font-size: 11px;
    }

    td {
      padding: 7px 12px;
      border-bottom: 1px solid #f1f5f9;
      color: #334155;
    }

    tr:nth-child(even) {
      background: #f8fafc;
    }

    .badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 9999px;
      font-size: 10px;
      font-weight: 600;
      background: #ccfbf1;
      color: #0f766e;
    }

    .badge-amber {
      background: #fef3c7;
      color: #92400e;
    }

    .code-box {
      font-family: 'JetBrains Mono', monospace;
      font-size: 11px;
      background: #0f172a;
      color: #f8fafc;
      padding: 10px 14px;
      border-radius: 6px;
      line-height: 1.45;
    }

    .highlight {
      color: #0d9488;
      font-weight: 700;
    }
  </style>
</head>
<body>

  <!-- Slide 1: Title Slide -->
  <div class="slide">
    <div class="slide-header">
      <div>
        <div class="slide-subtitle">CS1237 Full Stack Application Development • Semester Project</div>
        <div class="hero-title">BorrowLoop</div>
      </div>
      <div style="text-align: right;">
        <span class="badge">Production MERN</span>
        <span class="badge badge-amber">Demo Money Active</span>
      </div>
    </div>
    <div class="slide-body" style="justify-content: center; gap: 24px;">
      <p style="font-size: 16px; color: #475569; max-width: 800px; line-height: 1.5;">
        A community peer-to-peer equipment and item borrowing platform for university campuses and neighborhoods.
        Engineered with a <strong>mathematically zero-sum double-entry ledger</strong>, two-sided QR handovers,
        MongoDB multi-document ACID transactions, Redis caching, and real-time Socket.IO collaboration.
      </p>
      <table>
        <thead>
          <tr>
            <th>Student Team Member</th>
            <th>Project Role</th>
            <th>Primary Module Contributions</th>
            <th>Viva Defense Focus</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><strong>Team Member 1 (Lead)</strong></td>
            <td>Backend Core & Financial Ledger</td>
            <td>Mongoose Schemas, Double-entry append-only ledger, Booking finite state machine, ACID transactions, Zod validations</td>
            <td>Ledger invariant proofs, ACID isolation levels, Idempotency pattern</td>
          </tr>
          <tr>
            <td><strong>Team Member 2</strong></td>
            <td>Frontend Client SPA & UI/UX</td>
            <td>React 18 SPA (Vite + Tailwind), Geospatial $geoWithin search, Community feeds, PWA, Blind 2-sided ratings</td>
            <td>React Hooks & Context, Geospatial distance bands, Mobile responsiveness</td>
          </tr>
          <tr>
            <td><strong>Team Member 3</strong></td>
            <td>Admin Portal, Real-Time & DevOps</td>
            <td>Customer Care & Admin Portal, Socket.IO + Redis adapter, BullMQ async queues, Recharts visualization, CI/CD</td>
            <td>Real-time socket scaling, Redis caching strategies, GitHub Actions CI</td>
          </tr>
        </tbody>
      </table>
    </div>
    <div class="slide-footer">
      <span>Repository: https://github.com/Devam759/Full-Stack-Project</span>
      <span>API Docs: https://borrowloop-api.onrender.com/v1/docs</span>
      <span>Slide 1 of 7</span>
    </div>
  </div>

  <!-- Slide 2: Problem & Architecture -->
  <div class="slide">
    <div class="slide-header">
      <div>
        <div class="slide-subtitle">System Design & Problem Statement</div>
        <div class="slide-title">Architecture & Target Personas</div>
      </div>
      <span class="badge">MERN + Redis + BullMQ</span>
    </div>
    <div class="slide-body">
      <div class="grid-2">
        <div class="card">
          <div class="card-title">Target Personas & Pain Points</div>
          <ul>
            <li><strong>The Borrower</strong>: Needs high-value tools/electronics temporarily without prohibitive retail purchase prices; requires guaranteed escrow safety.</li>
            <li><strong>The Lender (Owner)</strong>: Monetizes idle equipment safely with a secured deposit held in escrow and automated late-return penalties.</li>
            <li><strong>The Care Agent</strong>: Investigates disputes, reviews timestamped handover photos, and issues binding resolutions.</li>
            <li><strong>The Platform Admin</strong>: Monitors real-time liquidity, enforces community moderation, and audits zero-sum ledger reconciliation.</li>
          </ul>
        </div>
        <div class="card">
          <div class="card-title">Production Tiered Architecture</div>
          <ul>
            <li><strong>Client Tier</strong>: React 18 User PWA (Vite) + Admin Operations Portal (Vite + Recharts).</li>
            <li><strong>Ingress & Security</strong>: Helmet headers, CORS credentials whitelist, IP sliding-window rate limiters.</li>
            <li><strong>Application Tier</strong>: Express API server (Node 22 LTS) + Socket.IO server + BullMQ background worker.</li>
            <li><strong>Data & Cache Tier</strong>: MongoDB Atlas Replica Set (multi-document ACID transactions) + Redis Cloud (Pub/Sub & 60s cache).</li>
          </ul>
        </div>
      </div>
      <div class="code-box">
Client (React 18 SPA) &lt;--- HTTP/WSS ---&gt; Reverse Proxy / Express API &lt;--- Mongoose ---&gt; MongoDB Atlas Replica Set (ACID)
                                                |                                                |
                                     Socket.IO &amp; Redis Adapter &lt;--- BullMQ Worker &lt;--- Transactional Outbox
      </div>
    </div>
    <div class="slide-footer">
      <span>BorrowLoop Engineering Defense</span>
      <span>Slide 2 of 7</span>
    </div>
  </div>

  <!-- Slide 3: Database & Double-Entry Ledger -->
  <div class="slide">
    <div class="slide-header">
      <div>
        <div class="slide-subtitle">Data Modeling & Financial Correctness</div>
        <div class="slide-title">MongoDB Schema & Double-Entry Ledger</div>
      </div>
      <span class="badge">Zero Floating-Point Error</span>
    </div>
    <div class="slide-body">
      <div class="grid-2">
        <div class="card">
          <div class="card-title">12+ Mongoose Collections & Relationships</div>
          <ul>
            <li><code>users</code>: Auth identity, argon2 hash, trust score, role (user/agent/admin).</li>
            <li><code>communities</code>: Campus boundaries, GeoJSON Points (2dsphere index).</li>
            <li><code>items</code>: Lending catalog, category, daily rent in paise, compound indexes.</li>
            <li><code>bookings</code>: Booking state machine, dates, atomic escrow locks.</li>
            <li><code>wallets</code> &amp; <code>ledger_entries</code>: Immutable double-entry financial journals.</li>
            <li><code>disputes</code>, <code>reports</code>, <code>ratings</code>: Operational trust modules.</li>
          </ul>
        </div>
        <div class="card">
          <div class="card-title">The Fundamental Financial Invariant</div>
          <p style="margin-bottom: 8px;"><strong>Rule:</strong> Money amounts are stored strictly as <strong>integers in paise</strong> (₹1 = 100 paise). Balances are never modified directly.</p>
          <div class="code-box" style="margin-bottom: 8px;">
Sum(Credits) - Sum(Debits) == 0 (Zero-Sum Invariant)
Wallet.availablePaise + Wallet.frozenPaise == Sum(LedgerEntries)
          </div>
          <p>Every wallet top-up, escrow lock, and return settlement runs inside a <strong>MongoDB replica set ACID transaction</strong> with mandatory <code>Idempotency-Key</code> tracking.</p>
        </div>
      </div>
    </div>
    <div class="slide-footer">
      <span>BorrowLoop Engineering Defense</span>
      <span>Slide 3 of 7</span>
    </div>
  </div>

  <!-- Slide 4: Core User Flows -->
  <div class="slide">
    <div class="slide-header">
      <div>
        <div class="slide-subtitle">Application Walkthrough</div>
        <div class="slide-title">Core Booking & Handover Lifecycle</div>
      </div>
      <span class="badge">Atomic State Machine</span>
    </div>
    <div class="slide-body">
      <div class="grid-3">
        <div class="card">
          <div class="card-title">1. Discovery & Escrow Lock</div>
          <p>Borrower discovers items via <strong>$geoWithin</strong> search. On booking:</p>
          <ul>
            <li>Checks conflicting date locks.</li>
            <li>Verifies available funds &ge; rent + deposit.</li>
            <li>Transfers balance to escrow in 1 atomic transaction.</li>
          </ul>
        </div>
        <div class="card">
          <div class="card-title">2. Two-Sided QR Handover</div>
          <p>Lender and borrower meet in person:</p>
          <ul>
            <li>Dynamic, cryptographically signed, short-lived QR code.</li>
            <li>Immediate state transition: <code>accepted</code> &rarr; <code>picked_up</code>.</li>
            <li>Rental clock starts in real-time.</li>
          </ul>
        </div>
        <div class="card">
          <div class="card-title">3. Return Settlement & Rating</div>
          <p>Lender verifies condition on return QR:</p>
          <ul>
            <li>Lender receives net rent (10% platform fee deducted).</li>
            <li>Security deposit instantly unfrozen and returned.</li>
            <li>Two-sided blind rating opens (prevents retaliatory reviews).</li>
          </ul>
        </div>
      </div>
      <div class="card" style="background: #f0fdfa; border-color: #99f6e4;">
        <div class="card-title" style="color: #0d9488;">Live Demo Script: 4 Steps in 5 Minutes</div>
        <p style="color: #134e4a;"><strong>Step 1:</strong> Borrower logs in &amp; tops up wallet &bull; <strong>Step 2:</strong> Requests DSLR camera with escrow lock &bull; <strong>Step 3:</strong> Lender accepts booking &amp; scans pickup QR &bull; <strong>Step 4:</strong> Return scan completes settlement and updates real-time Admin Portal charts.</p>
      </div>
    </div>
    <div class="slide-footer">
      <span>BorrowLoop Engineering Defense</span>
      <span>Slide 4 of 7</span>
    </div>
  </div>

  <!-- Slide 5: Advanced Features -->
  <div class="slide">
    <div class="slide-header">
      <div>
        <div class="slide-subtitle">CS1237 Part C Evaluation (20% Marks)</div>
        <div class="slide-title">Advanced Features Implementation Defense</div>
      </div>
      <span class="badge">8 of 9 Implemented</span>
    </div>
    <div class="slide-body">
      <table>
        <thead>
          <tr>
            <th>Advanced Feature</th>
            <th>What It Does</th>
            <th>Why BorrowLoop Needed It</th>
            <th>Implementation Details</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><strong>Double-Entry Ledger (ACID)</strong></td>
            <td>Zero-sum immutable financial ledger with escrow locks.</td>
            <td>Eliminates currency drift, race conditions, and double-spending.</td>
            <td>MongoDB Replica Set Transactions, <code>LedgerEntry</code> journal, Idempotency keys.</td>
          </tr>
          <tr>
            <td><strong>Interactive API Docs</strong></td>
            <td>Swagger UI browser sandbox at <code>/v1/docs</code>.</td>
            <td>Enables live grading and third-party developer integration.</td>
            <td>OpenAPI 3.0 specification mounted via <code>swagger-ui-express</code>.</td>
          </tr>
          <tr>
            <td><strong>Real-Time Socket.IO</strong></td>
            <td>Live chat, handover QR triggers, push alerts.</td>
            <td>Polling wastes bandwidth and introduces unacceptable UI latency.</td>
            <td>Socket.IO server with <code>@socket.io/redis-adapter</code> for horizontal clustering.</td>
          </tr>
          <tr>
            <td><strong>Admin Data Visualization</strong></td>
            <td>Visual charts for volume, escrow, booking distributions.</td>
            <td>Provides executive visibility into platform health.</td>
            <td>Recharts responsive charts powered by MongoDB <code>$facet</code> aggregations.</td>
          </tr>
          <tr>
            <td><strong>Redis Caching</strong></td>
            <td>60-second cache-aside layer for catalog and analytics.</td>
            <td>Prevents database thrashing under high concurrency.</td>
            <td>Redis Cloud <code>ioredis</code> client with automatic mutation invalidation.</td>
          </tr>
          <tr>
            <td><strong>Background BullMQ Queues</strong></td>
            <td>Sweeps expired requests, late fees, ledger reconciliation.</td>
            <td>Heavy tasks must never block HTTP request-response cycles.</td>
            <td>BullMQ workers running outbox dispatchers and recurring cron jobs.</td>
          </tr>
          <tr>
            <td><strong>Two-Factor Auth (TOTP)</strong></td>
            <td>Protects staff portal accounts with 6-digit TOTP codes.</td>
            <td>Defense-in-depth against privileged credential compromise.</td>
            <td>RFC 6238 TOTP verification via <code>otpauth</code> in 2-step login handshake.</td>
          </tr>
        </tbody>
      </table>
    </div>
    <div class="slide-footer">
      <span>BorrowLoop Engineering Defense</span>
      <span>Slide 5 of 7</span>
    </div>
  </div>

  <!-- Slide 6: Security, Testing & DevOps -->
  <div class="slide">
    <div class="slide-header">
      <div>
        <div class="slide-subtitle">Software Quality & Production Readiness</div>
        <div class="slide-title">Security & Automated Testing Framework</div>
      </div>
      <span class="badge">18 Vitest Suites Passing</span>
    </div>
    <div class="slide-body">
      <div class="grid-2">
        <div class="card">
          <div class="card-title">Security Architecture & Best Practices</div>
          <ul>
            <li><strong>Zod Schema Sanitization</strong>: Untrusted fields stripped before hitting database queries.</li>
            <li><strong>IDOR &amp; Mass Assignment Guard</strong>: Strict model whitelists prevent privilege escalation.</li>
            <li><strong>RFC 9457 Error Standard</strong>: Uniform error objects prevent stack trace leaks.</li>
            <li><strong>Privacy First</strong>: Exact user coordinates never sent; coarse distance bands (&lt;2km) only.</li>
            <li><strong>TOTP Staff Protection</strong>: Customer care &amp; admin portals require 2-factor authentication.</li>
          </ul>
        </div>
        <div class="card">
          <div class="card-title">Automated Testing & CI/CD Pipeline</div>
          <ul>
            <li><strong>Concurrency &amp; Race Tests</strong>: Parallel booking attempts verified to prevent double booking.</li>
            <li><strong>Idempotency Validation</strong>: Replaying requests returns identical results without double debits.</li>
            <li><strong>Multi-Process Integration</strong>: API and worker processes tested communicating via Redis outbox.</li>
            <li><strong>GitHub Actions CI</strong>: Automated linting, formatting, and Vitest suite runs on every push.</li>
          </ul>
        </div>
      </div>
      <div class="code-box">
$ npm test
Test Files: 18 passed (18) | Tests: 145+ passed | Invariants Checked: 100% Zero-Sum Ledger Balance
      </div>
    </div>
    <div class="slide-footer">
      <span>BorrowLoop Engineering Defense</span>
      <span>Slide 6 of 7</span>
    </div>
  </div>

  <!-- Slide 7: Challenges, Viva Q&A & Conclusion -->
  <div class="slide">
    <div class="slide-header">
      <div>
        <div class="slide-subtitle">Defense Summary & Engineering Learnings</div>
        <div class="slide-title">Viva Defense & Key Learnings</div>
      </div>
      <span class="badge">Conclusion</span>
    </div>
    <div class="slide-body">
      <div class="grid-2">
        <div class="card">
          <div class="card-title">Key Engineering Challenges Solved</div>
          <ul>
            <li><strong>Atomic Date Conflict Prevention</strong>: Solved using unique compound indexes on <code>(itemId, date)</code> within MongoDB ACID sessions.</li>
            <li><strong>Zero-Drift Ledger Accounting</strong>: Solved by moving all money movements to append-only journals in integer paise.</li>
            <li><strong>Multi-Process Socket Sync</strong>: Solved by pairing Socket.IO with Redis Pub/Sub adapter to allow multi-instance broadcast.</li>
          </ul>
        </div>
        <div class="card">
          <div class="card-title">Viva Conceptual Defense Highlights</div>
          <ul>
            <li><strong>Why MERN over Relational SQL?</strong> Schema flexibility for heterogeneous items combined with MongoDB 4.0+ ACID multi-document transactions.</li>
            <li><strong>Why Integer Paise?</strong> Eliminates IEEE-754 floating point rounding drift (e.g. 0.1 + 0.2 != 0.3).</li>
            <li><strong>Why BullMQ over setInterval?</strong> Jobs survive server restarts, support exponential retry backoffs, and run in dedicated worker processes.</li>
          </ul>
        </div>
      </div>
      <div class="card" style="text-align: center; background: #0f172a; color: #ffffff; padding: 18px;">
        <h4 style="font-size: 16px; margin-bottom: 6px; color: #2dd4bf;">Thank You Faculty Panel</h4>
        <p style="font-size: 12px; color: #94a3b8;">BorrowLoop is fully production-ready, fully documented, and open for questions and live demo.</p>
      </div>
    </div>
    <div class="slide-footer">
      <span>BorrowLoop Engineering Defense</span>
      <span>Slide 7 of 7</span>
    </div>
  </div>

</body>
</html>
`;

const tempHtmlPath = path.join(rootDir, 'docs', 'presentation_slides_render.html');
const pdfOutputPath = path.join(rootDir, 'docs', 'presentation_slides.pdf');

fs.writeFileSync(tempHtmlPath, htmlContent, 'utf8');

const edgePaths = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];

const edgeBin = edgePaths.find((p) => fs.existsSync(p));

if (!edgeBin) {
  console.error('Microsoft Edge binary not found for headless PDF printing.');
  process.exit(1);
}

console.info(`Generating presentation PDF using Edge at: ${edgeBin}`);
const cmd = `"${edgeBin}" --headless --disable-gpu --no-pdf-header-footer --print-to-pdf="${pdfOutputPath}" "file://${tempHtmlPath.replace(/\\/g, '/')}"`;

try {
  execSync(cmd, { stdio: 'inherit' });
  if (fs.existsSync(pdfOutputPath)) {
    const stats = fs.statSync(pdfOutputPath);
    console.info(`SUCCESS: Created ${pdfOutputPath} (${stats.size} bytes)`);
    // Clean up temporary HTML
    fs.unlinkSync(tempHtmlPath);
  } else {
    console.error('PDF file was not created.');
    process.exit(1);
  }
} catch (err) {
  console.error('Failed generating presentation PDF:', err.message);
  process.exit(1);
}
