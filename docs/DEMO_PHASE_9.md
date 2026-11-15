# BorrowLoop Phase 9 Demo Script: Admin Portal, Appeals, Analytics, Moderation & Ads

This script provides an interactive step-by-step walkthrough for faculty and technical evaluators demonstrating the complete Phase 9 capabilities across the Admin Portal, API, Worker, and User Web App:

1. **Executive Analytics Dashboard**: Live metrics, indexed `$facet` queries, 60s Redis caching, and explicit "Demo money" labels.
2. **User Moderation & Safety Guards**: Banning with active booking conflict guard (409 `USER_HAS_ACTIVE_BOOKINGS`), automated booking cancellations with refunds, item hiding, token revocation, socket termination, and unbanning.
3. **Community Moderation**: Paginated community review, suspend/restore with zero owner email leaks.
4. **Care Agent Lifecycle**: Promoting active users with emailed TOTP enrollment links (never shown in UI), demotion resetting assigned disputes to `opened`, and last admin demotion protection.
5. **Dispute Appeal Preview & Overturn**: Double-entry money reversal (`settleAppealDecision`), debit capping at available wallet balance, unrecovered shortfall deduction from highest gainer, and mandatory `acknowledgeShortfall` safety gate.
6. **Double-Entry Ledger Reconciliation**: Historical run viewer, on-demand trigger with 5-minute cooldown guard (429), and async BullMQ worker execution.
7. **Immutable Audit Log Inspector**: Tamper-proof Mongoose write protection, cursor pagination, before/after JSON diffs, and strict PII masking (`a***@g***.com`, zero coordinates/secrets).
8. **AdSense Monetization & Consent Lifecycle**: Admin master switch requiring `ENABLE_ADS` confirmation, placement slot configuration, public cached config, 180-day user consent banner, ad preferences modal, and screen allowlist/denylist enforcement (`ALLOWED_SCREENS` / `RESTRICTED_SCREENS`).
9. **14-Category Invariants Audit**: Live verification proving zero ledger discrepancy, zero negative balances, zero duplicate refunds, and audit log integrity.

---

## 1. Setup & Environment Verification

### Prerequisites

1. **MongoDB Replica Set**: Running with replica set enabled (e.g. `rs0` on `mongodb://localhost:27017/borrowloop?replicaSet=rs0`).
2. **Redis**: Running on `localhost:6379`.
3. **API & Worker**:
   ```bash
   npm run dev:api
   npm run dev:worker
   ```
4. **User Web App**: `http://localhost:5173`
5. **Staff/Admin Portal**: `http://localhost:5174`
6. **Key Accounts**:
   - **Admin Account**: `admin@demo.com` (Role: `admin`)
   - **Care Agent Account**: `care@demo.com` (Role: `care_agent`)
   - **Regular Users**: `lender@demo.com`, `borrower@demo.com`, `candidate@demo.com`

> [!NOTE]
> All currency amounts are **Demo money** in integer paise. Double-entry entries always sum to zero, no wallet may ever go negative, and all admin actions require reason justification, idempotency keys, and transactional audit rows.

---

## 2. Interactive Demonstration Flows

### Flow 1: Executive Analytics Overview

1. Log into the Portal as an Admin (`admin@demo.com`) on `http://localhost:5174`.
2. Observe the **Overview** dashboard:
   - **Live Metric Cards**: Total Users (active, frozen, banned), Items (active, paused, hidden, removed), Bookings by status, Rented Now.
   - **Financial Volume**: Total Volume (sum of completed rental fees), Deposits Held (sum of frozen funds), and Commission Earned (ledger sum of platform revenue).
   - **Dispute Metrics**: Open disputes, pending appeals, and the derived Dispute Ratio ($\text{disputes} / \text{picked\_up bookings}$).
   - Notice the prominent **"Demo money"** badge displayed next to all currency totals.
3. Refresh the page: the API serves responses directly from Redis with sub-millisecond latency (60s TTL).

---

### Flow 2: User Moderation & Active Booking Protection Guard

1. Navigate to **Users** in the portal sidebar.
2. Search for a user by email (e.g. `borrower@demo.com`) or filter by role/status:
   - Notice user emails are masked in the table (e.g. `b***@d***.com`) to protect user privacy.
3. Attempt to Ban a User with an Active Rental:
   - Select a user who currently has an item in `picked_up`, `returned`, or `disputed`.
   - Click **Ban User**, enter reason: _"Repeated violations of terms"_.
   - Click Confirm.
   - **Result**: The API refuses the ban with HTTP 409 `USER_HAS_ACTIVE_BOOKINGS`, listing the active booking IDs to prevent stranding rented equipment.
4. Ban a User without Active Rentals:
   - Select an eligible user, enter reason (minimum 10 characters), and submit.
   - **System actions executed in transaction**:
     - User status updated to `banned`.
     - Pending/accepted bookings cancelled with full refund to borrowers.
     - User items hidden with `hiddenReason: 'owner_banned'` (remembering original status).
     - Refresh tokens invalidated and active Socket.io connections immediately terminated.
     - Transactional `AuditLog` written.
5. Click **Unban User**:
   - Restores user status to `active` and unhides previously hidden items. Strikes remain intact.

---

### Flow 3: Community Moderation (Zero Email Leaks)

1. Navigate to **Communities** in the portal sidebar.
2. Review the paginated list of communities:
   - Observe that community names, member counts, item counts, and status are shown.
   - Notice that creator emails and personal contact information are **completely omitted** from the response.
3. Click **Suspend** on a community:
   - Provide a valid reason (e.g. _"Spam activity reported across multiple listings"_).
   - The community transitions to `suspended`. Members cannot create new listings or join.
4. Click **Restore**:
   - Community status returns to `active`.

---

### Flow 4: Care Agent Promotion & Demotion

1. Navigate to **Staff & Agents** in the portal sidebar.
2. View current care agents and admin accounts.
3. Click **Invite / Promote Agent**:
   - Enter email of a verified active user: `candidate@demo.com`.
   - Enter reason: _"Expanding dispute resolution coverage for night shifts"_.
   - Click **Promote Agent**.
   - Notice: The portal informs the admin that a secure TOTP enrollment link was emailed to the candidate. **The secret is never displayed to the admin.**
4. Demote an Agent:
   - Click **Demote** on a care agent.
   - Enter reason.
   - **System actions executed**:
     - User role reverted to `user`.
     - TOTP secret cleared.
     - Active sessions and refresh tokens revoked.
     - Any open disputes assigned to that agent are reset to `opened` for reassignment.
   - Note: Attempting to demote the last remaining admin is blocked with `LAST_ADMIN` (400).

---

### Flow 5: Dispute Appeal Preview & Settlement Reversal

1. Navigate to **Appeals** in the portal sidebar.
2. View the pending appeals queue. Select a pending appeal (e.g. lender appealing a full deposit refund given to borrower).
3. Click **Review & Decide**:
   - The dialog loads the original care decision and settlement details.
4. **Preview Revised Settlement**:
   - Admin adjusts deposit split (e.g., returning ₹2,000 of deposit to lender for repairs).
   - Click **Preview Financial Deltas**.
   - The preview endpoint computes exact wallet debits and credits:
     - If the borrower withdrew their balance, the debit is capped at their available balance.
     - Any unrecovered shortfall is detected and displayed in a warning banner.
5. **Decide Appeal (Overturned)**:
   - If a shortfall exists, checking the **"I acknowledge that ₹X could not be recovered"** checkbox is mandatory.
   - Enter appeal decision note (minimum 10 characters).
   - Click **Overturn Decision**:
     - `settleAppealDecision` executes an atomic double-entry ledger reversal.
     - Original trust penalties and strikes are reversed; revised ones applied.
     - Status updates to `overturned`.

---

### Flow 6: Reconciliation & Cooldown Guard

1. Navigate to **Reconciliation** in the portal sidebar.
2. Review past reconciliation runs showing run date, discrepancies found, and details.
3. Click **Trigger Reconciliation**:
   - Enqueues the job to BullMQ worker.
4. Immediately click **Trigger Reconciliation** again:
   - **Result**: Refused with HTTP 429 `RECONCILIATION_COOLDOWN` ("Reconciliation ran recently. Cooldown is 300 seconds.").

---

### Flow 7: Immutable Audit Log Inspector

1. Navigate to **Audit Log** in the portal sidebar.
2. Filter logs by action type (`user_banned`, `appeal_decided`, `ads_config_updated`, etc.) or date range.
3. Click on any log row to open the **Audit Detail Modal**:
   - Inspect actor ID, action name, target type, target ID, and justification reason.
   - View formatted **Before & After JSON diffs**.
   - Verify that all emails are masked (`a***@g***.com`) and zero password hashes, TOTP secrets, or GPS coordinates are present.
4. Audit Log Immutability:
   - Any direct Mongoose `updateOne`, `findOneAndUpdate`, or `deleteOne` on `AuditLog` is blocked by schema middleware.

---

### Flow 8: AdSense Monetization & Consent Lifecycle

1. Navigate to **Ads Management** in the portal sidebar.
2. Observe that Ads are **Off by default** (`masterEnabled: false`).
3. Toggle Master Switch:
   - Safety dialog appears requiring the admin to type **`ENABLE_ADS`** to confirm.
   - Admin configures publisher ID: `ca-pub-1234567890123456`.
   - Submit.
4. Configure Placement:
   - Configure slot ID for `home_banner`: `1234567890`.
   - Enable placement.
5. **Switch to User Web App (`http://localhost:5173`)**:
   - On first visit, observe the **Consent Banner** at the bottom: _"We use demo advertisements to support the platform"_.
   - If user clicks **Decline**: No ads are rendered anywhere on the site.
   - Open footer link **"Ad preferences"**: Click **"Accept Ads"**.
   - Navigate to Browse Items (`/items`): Observe `home_banner` AdSense placeholder container rendered.
   - Navigate to Item Details: Observe `item_sidebar` rendered.
   - Navigate to `/wallet` or `/bookings`: Verify that **zero ads** are rendered on restricted screens (`RESTRICTED_SCREENS`).
   - Notice AdSense `<script>` tag is lazily injected into `<head>` only once upon consent.

---

## 3. Automated Invariants Audit

Run the end-to-end 14-category invariants audit:

```bash
node scripts/run-invariants-audit.js
```

### Verified Invariant Matrix:

- **1. Ledger Sum 0**: Strict zero paise double-entry sum across all ledger entries.
- **2. Negative Balances**: Zero wallets with negative available or pending balances.
- **3. Mismatches Count**: Zero discrepancies between computed ledger balances and cached wallet balances.
- **4. Double Refunds**: Zero duplicate refund events.
- **5. Orphan Locks**: Zero item day locks without active bookings.
- **6. Overlaps Count**: Zero overlapping date locks for the same item.
- **7. Duplicate Events**: Zero duplicate domain events.
- **8. Leftover Test DBs**: Clean sandbox environment.
- **9. Orphan Conversations**: Every conversation maps to a valid booking.
- **10. Orphan Bookings**: Every booking maps to an existing user and item.
- **11. Duplicate Messages**: Zero message duplications via `clientMessageId`.
- **12. Duplicate Notifications**: Zero notification duplications via `dedupeKey`.
- **13. Stuck Domain Events**: Zero stuck processing leases in outbox.
- **14. Admin Audit Log Integrity**: 100% of admin mutation logs have an actor, a valid reason, and an identifiable target.
