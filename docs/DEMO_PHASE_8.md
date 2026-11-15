# BorrowLoop Phase 8 Demo Script: Disputes, Care Portal, Reports & Moderation

This script provides an interactive step-by-step demonstration walkthrough for faculty and technical evaluators. It demonstrates the complete Phase 8 workflows across the User Web App and the Care Portal:

1. Filing and settling a condition dispute with atomic double-entry money movements and live ledger invariants.
2. Handling a no-show dispute with complete deposit/rent cancellation and trust penalty.
3. Reporting prohibited content and verifying the automated 3-report auto-hide mechanism.
4. Performing care agent review, moderation actions, and user lookup in the Care Portal.
5. Filing a dispute appeal within the 7-day window.

---

## 1. Setup & Environment Verification

### Prerequisites

1. **MongoDB Replica Set**: Running and accessible (e.g. `rs0` on `mongodb://localhost:27017/borrowloop?replicaSet=rs0`).
2. **API & Worker**:
   ```bash
   npm run dev:api
   npm run dev:worker
   ```
3. **Web Frontend (User App)**: Started on `http://localhost:5173`.
4. **Care Portal**: Started on `http://localhost:5174`.
5. **Three Browser Sessions**:
   - **Browser A**: Borrower (`borrower@demo.com`) on `http://localhost:5173`
   - **Browser B**: Lender (`lender@demo.com`) on `http://localhost:5173`
   - **Browser C**: Care Agent (`care@demo.com`, role `care_agent`) on `http://localhost:5174`

> [!NOTE]
> All money shown in the application is **Demo money** in integer paise. Every money movement is strictly zero-sum, audited, and verified by double-entry ledger invariants.

---

## 2. Step-by-Step Demonstration Flow

### Flow 1: Condition Dispute & Atomic Money Settlement

#### Step 1.1: Active Booking Reaches Condition Issue

1. **Borrower (Browser A)**:
   - Has an active booking in `picked_up` status (e.g., _Sony A7 IV Camera_, Deposit: ₹5,000, Rent: ₹1,500).
   - Observes the booking details screen: sees item photos and pickup confirmation.
   - Discovers that a lens filter is scratched and does not match the listing description.
   - Clicks **"Report an Issue / Dispute"**.
2. **Modal Interaction**:
   - Selects **"Condition Mismatch"**.
   - Enters details: _"Lens front element has scratch not disclosed in the listing photos"_.
   - Uploads a photo of the defect (signed Cloudinary upload into the dispute folder).
   - Submits dispute.
3. **System Transition**:
   - Booking transitions to `disputed`.
   - Late charge calculation is frozen at the moment of dispute filing.
   - A `dispute_opened` notification is dispatched to the lender.

#### Step 1.2: Lender Submits Counter-Evidence

1. **Lender (Browser B)**:
   - Receives notification that a dispute was opened on booking.
   - Navigates to `/disputes/:id`.
   - Sees the borrower's claim and uploaded photos in the **Evidence Gallery**.
   - Clicks **"Add Evidence"**, enters handover notes: _"Item was inspected together at pickup without objections"_, and uploads proof.

#### Step 1.3: Care Agent Assigns and Decides Dispute

1. **Care Agent (Browser C)**:
   - Logs into Care Portal (`http://localhost:5174`).
   - Opens **"Disputes Queue"** (`/disputes`).
   - Sees the new unassigned dispute tagged `condition_mismatch`.
   - Clicks **"Assign to Me"**. Status updates to `assigned`.
   - Reviews the comprehensive case file:
     - Borrower claim & photos.
     - Lender counter-evidence.
     - Handover timestamps and inspection logs.
     - Demo money breakdown: Rent: ₹1,500, Deposit: ₹5,000, Accrued Late Fee: ₹0.
2. **Entering the Decision**:
   - Selects **Deposit Split**:
     - Deposit to Lender: ₹1,500 (covers repair/polishing).
     - Deposit to Borrower: ₹3,500 (remaining deposit refund).
   - Selects **Rent Outcome**: `lender` (lender completed the rental period).
   - Selects **Penalty**: `none` (good-faith disagreement).
   - Enters Decision Note (publicly visible to both parties, min 20 characters):
     _"Partial deposit granted to lender for lens repair; remainder refunded to borrower."_
   - Clicks **"Submit Final Decision"**.
3. **Atomic Ledger Execution**:
   - In a single MongoDB transaction:
     - 15% platform commission on rent (₹225) moves to `platform_revenue`.
     - Rent net (₹1,275) moves from `borrower_escrow` to `lender_balance`.
     - Lender deposit compensation (₹1,500) moves from `borrower_escrow` to `lender_balance` with **0% commission**.
     - Remaining deposit (₹3,500) moves from `borrower_escrow` to `borrower_balance`.
     - Booking transitions to `completed`.
     - Dispute transitions to `decided`.
     - Immutable `AuditLog` row is committed.

---

### Flow 2: Content Moderation & 3-Report Auto-Hide

#### Step 2.1: Filing Reports on Prohibited Listing

1. **User 1 (Browser A)**:
   - Views a listing containing prohibited fireworks or hazardous equipment.
   - Clicks the flag icon **"Report"**.
   - Selects reason `prohibited_item`, adds details, and submits.
   - Alert confirms report recorded.
2. **User 2 & User 3**:
   - Two additional unique users report the same listing for `prohibited_item`.
3. **Automated Auto-Hide Trigger**:
   - Upon the 3rd report (`ITEM_REPORTS_HIDE_THRESHOLD = 3`):
     - The item's `status` immediately flips to `'hidden'`.
     - Domain event `item_auto_hidden` is published to outbox.
     - The lender receives notification: _"Your item has been temporarily hidden due to community reports"_.
     - The listing disappears from search results and public browsing.

#### Step 2.2: Care Portal Moderation Queue

1. **Care Agent (Browser C)**:
   - Navigates to **"Moderation Queue"** (`/reports`).
   - Observes the auto-hidden item with 3 pending reports.
   - Clicks **"Review Reports"**: inspects reporter statements and item photos.
   - Evaluates actions:
     - `remove_item`: Permanently archives violating item.
     - `strike_user`: Issues an official strike to the lender (+1 strike ladder, trust score recalculation).
   - Enters internal audit justification: _"Confirmed hazardous materials listed in violation of community guidelines."_
   - Clicks **"Apply Action"**.

---

### Flow 3: Care User 360 Lookup & Audit

1. **Care Agent (Browser C)**:
   - Navigates to **"User Lookup"** (`/users`).
   - Searches for user ID or clicks on the offender's profile link.
   - Reviews comprehensive user health dashboard:
     - Current trust score and trust history events.
     - Strike ladder status (Strike 1 Warning / Strike 2 Suspension / Strike 3 Ban).
     - Active and past bookings count.
     - Complete transactional audit log of past moderation actions.

---

### Flow 4: Dispute Appeal Workflow

1. **Borrower (Browser A)**:
   - Navigates to decided dispute screen (`/disputes/:id`).
   - Sees the decision breakdown banner and note.
   - Observes the **"Appeal Decision"** button (active within the 7-day appeal window).
   - Enters appeal grounds: _"Repair invoice provided was higher than actual cost incurred."_
   - Submits appeal.
2. **System State**:
   - Dispute transitions to `appealed`.
   - Domain event `dispute_appealed` notifies care management.
   - The original settlement remains securely in force pending Phase 9 Admin appeal review.
