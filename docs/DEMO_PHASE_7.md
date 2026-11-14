# BorrowLoop Phase 7 Demo Script: Handover, Return, Settlement, Blind Ratings & Trust

This script provides an interactive step-by-step demonstration walkthrough for faculty and technical evaluators. It demonstrates the complete end-to-end borrowing lifecycle across two devices or browser windows (Lender and Borrower).

---

## 1. Setup & Environment Verification

### Prerequisites

1. **MongoDB Replica Set**: Running and accessible (via `npm run dev` or local MongoDB instance).
2. **Redis**: Running on `localhost:6379`.
3. **API & Worker**: Started (`npm run dev:api` and `npm run dev:worker`).
4. **Web Frontend**: Started on `http://localhost:5173`.
5. **Two Browser Sessions**:
   - **Browser A (Incognito / Window 1)**: Lender (`lender@demo.com`)
   - **Browser B (Window 2)**: Borrower (`borrower@demo.com`)

> [!NOTE]
> All money shown in the application is **Demo money** in integer paise.

---

## 2. Step-by-Step Demonstration Flow

### Step 1: Booking Creation & Acceptance

1. **Borrower (Browser B)**:
   - Navigates to an item (e.g. _DeWalt Cordless Drill_, Rent: ₹500/day, Deposit: ₹1,000, Overdue Fee: ₹400/day).
   - Observes the lender's **Trust Score** badge on the item detail screen.
   - Selects dates (2 days) and submits booking request.
2. **Lender (Browser A)**:
   - Receives real-time notification / sees booking request in "Active Bookings".
   - Clicks **Accept Booking**.
   - **System action**: Rent (₹1,000) and security deposit (₹1,000) are atomically frozen from the borrower's wallet (`frozenPaise: 200000`). Item day locks are acquired.

---

### Step 2: In-App Chat & Meeting Pin Confirmation

1. **Borrower (Browser B)**:
   - Opens the booking details screen and opens **Chat**.
   - Sends a message and proposes a meeting location pin (e.g., _Campus Gate 3_).
2. **Lender (Browser A)**:
   - Sees the proposed pin in chat in real time.
   - Clicks **Confirm Pin**. Pin is stamped as confirmed for the handover.

---

### Step 3: Pickup Handover (QR & Proximity Verification)

1. **Lender (Browser A)**:
   - Clicks **Show Pickup QR**.
   - A rotating QR code displays with a 25-second countdown timer and a 6-digit fallback code.
2. **Borrower (Browser B)**:
   - Takes pickup condition photos (optional, up to 6 signed uploads).
   - Clicks **Scan Handover QR** (or enters the 6-digit fallback code).
   - Browser asks for GPS proximity check (verifies distance < 200m).
   - Code/QR is atomically consumed in one transaction.
3. **Result**:
   - Booking transitions to `picked_up`.
   - `pickupAt` timestamp is recorded.

---

### Step 4: Booking Extension (Optional Lifecycle Demonstration)

1. **Borrower (Browser B)**:
   - Requests a 1-day extension on the active booking.
   - Additional rent (₹500) is held in `pendingPaise`.
2. **Lender (Browser A)**:
   - Accepts the extension request.
   - Total rental period becomes 3 days (Total Rent: ₹1,500).

---

### Step 5: Late Return & Return Handover

1. **Overdue Simulation**:
   - Borrower is 1 day overdue past the return deadline.
   - Hourly background worker calculates late charge: $1 \times \text{₹400} = \text{₹400}$ late fee.
2. **Borrower (Browser B)**:
   - Clicks **Show Return QR**.
   - Return QR code and 6-digit fallback code display.
3. **Lender (Browser A)**:
   - Inspects the returned item and uploads return condition photos.
   - Clicks **Scan Return QR** (or enters the 6-digit code).
   - Booking transitions to `returned`.
   - Return timestamp `returnAt` is stamped, and a 24-hour review window begins (`returnConfirmDeadline`).

---

### Step 6: Lender Return Confirmation & Automated Ledger Settlement

1. **Lender (Browser A)**:
   - Prompted to confirm the return: **"All Good"** vs **"Report Problem"**.
   - Selects **"All Good"** (`outcome: 'ok'`).
2. **Automated Settlement Execution**:
   - **Total Earnings**: Rent (₹1,500) + Late Fee (₹400) = ₹1,900.
   - **Platform Commission (15%)**: $1,900 \times 15\% = \text{₹285}$ credited to `platform_revenue`.
   - **Lender Payout**: $1,900 - 285 = \text{₹1,615}$ credited to lender's available wallet balance.
   - **Deposit Refund**: Initial Deposit (₹1,000) - Late Fee (₹400) = ₹600 refunded to borrower's available wallet balance.
   - Unused day locks released.
   - Booking transitions to `completed`.

---

### Step 7: Blind Ratings & Instant Mutual Reveal

1. **Borrower (Browser B)**:
   - Clicks **Leave Review**. Rates 5 stars with comment: _"Great drill, thank you!"_.
   - Rating is saved with `isRevealed: false`. Neither party can see the feedback yet.
   - Profile averages and public review lists remain unchanged (no leakage).
2. **Lender (Browser A)**:
   - Clicks **Leave Review**. Rates 5 stars with comment: _"Responsible borrower, smooth return."_.
   - **Instant Mutual Reveal**: Second rating submission triggers an atomic transaction revealing both ratings simultaneously.
   - Socket event `ratings.revealed` emits.
   - Both users receive in-app notification: _"Ratings Revealed"_.
3. **Trust Score & Rating Update**:
   - Background recomputation updates cached derived fields:
     - Lender: `ratingAvg: 5.0`, `ratingCount: 1`, `trustScore` updated.
     - Borrower: `ratingAvg: 5.0`, `ratingCount: 1`, `trustScore` updated.
   - Profile screens on both devices reflect the new scores and revealed reviews immediately.

---

### Step 8: Alternative Paths (Dispute & Overdue Protection)

1. **Damage Claim Path**:
   - If the lender selects **"Report Problem"** during return review with a required note (e.g., _"Cracked drill chuck"_):
   - Booking transitions to `disputed` with `disputeReason: 'damage'`.
   - **Zero money moves**: Deposit and rent remain safely frozen until Customer Care resolves the case in Phase 8.
2. **Not-Returned Auto Dispute**:
   - If an item is kept overdue by 3+ days:
   - Worker job automatically transitions booking to `disputed` with `disputeReason: 'not_returned'`.
   - Borrower account is frozen (`status: 'frozen'`).
   - Borrower is barred from creating new bookings or listing items, but retains read-only access to existing bookings and wallet history.

---

## 3. Live Verification Commands

To verify that all invariants and test suites pass during the live evaluation:

```bash
# 1. Run all Phase 7 test suites (66 tests)
npx vitest run apps/api/tests/bookingStateMachine.test.js \
  packages/shared/tests/lateCharge.test.js \
  packages/shared/tests/trustScore.test.js \
  apps/api/tests/handoverPickup.test.js \
  apps/api/tests/handoverReturnSettlement.test.js \
  apps/worker/tests/lateChargeJob.test.js \
  apps/api/tests/trustAndStrikes.test.js \
  apps/api/tests/ratingsBlind.test.js \
  apps/api/tests/phase7E2E.test.js

# 2. Run the 13-category live MongoDB invariants audit
node scripts/run-invariants-audit.js
```
