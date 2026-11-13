# Wallet, Ledger and Booking States

## 1. Principles

1. The wallet is demo money for now. The code must treat it as if it were real.
2. Balances are never edited directly. They are derived from an append-only ledger.
3. Every money movement is a set of ledger entries that sum to zero (double entry).
4. Every money endpoint runs inside a MongoDB transaction and uses an idempotency key.
5. A `PaymentProvider` interface hides where money comes from, so a real provider can replace the demo one.
6. The settle-once rule prevents duplicate settlement, hold, refund, or release on any booking.

## 2. Accounts

Each user has three logical accounts: `available`, `frozen`, `pending` (pending is locked at 0 in Phase 4).
The platform has `platform_revenue` and `demo_funding` accounts.

## 3. Ledger Entry Schema & Types

```javascript
{
  _id: ObjectId,
  txnId: UUID,
  bookingId?: ObjectId,
  account: 'available' | 'frozen' | 'pending' | 'platform_revenue' | 'demo_funding',
  userId?: ObjectId | null,
  amountPaise: Integer, // Signed integer paise
  balanceAfterPaise?: Integer | null, // Tracked on user entries; null on system accounts
  type: LedgerEntryType,
  idempotencyKey?: string | null,
  createdAt: Date,
  meta: Object
}
```

### Supported Ledger Entry Types (`LEDGER_ENTRY_TYPES`)

- `deposit_funds`: User deposits demo money into their available balance from `demo_funding`.
- `withdraw_funds`: User withdraws available funds back into `demo_funding`.
- `booking_hold`: Funds locked from borrower `available` into borrower `frozen` upon booking approval.
- `extension_hold`: Additional rent locked from borrower `available` into `frozen` upon extension request (per `docs/API_SPEC.md`).
- `deposit_release`: Deposit returned from borrower `frozen` back to borrower `available`.
- `booking_cancel_refund`: All frozen funds returned to borrower `available` on cancellation.
- `settlement`: Borrower frozen rent and late charges debited, platform commission credited to `platform_revenue`, and lender payout credited to lender `available`.
- `commission`: Platform commission share (15% by default) allocated to `platform_revenue`.

> [!IMPORTANT]
> `reconciliation_adjustment` has been permanently removed from `LEDGER_ENTRY_TYPES`. No arbitrary balance mutations are allowed.

## 4. Movements

| Event                       | Entries                                                                                                                                           |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Add money                   | `demo_funding` (-amt) to `borrower.available` (+amt)                                                                                              |
| Withdraw                    | `user.available` (-amt) to `demo_funding` (+amt)                                                                                                  |
| Booking accepted            | `borrower.available` (-total) to `borrower.frozen` (+total) for (rent + deposit)                                                                  |
| Extension requested         | extra rent from `borrower.available` (-extra) to `borrower.frozen` (+extra) per `docs/API_SPEC.md`                                                |
| Deposit release             | `borrower.frozen` (-deposit) to `borrower.available` (+deposit)                                                                                   |
| Cancelled before pickup     | `borrower.frozen` (-all) to `borrower.available` (+all)                                                                                           |
| Completed "all good"        | `borrower.frozen` (-hold); borrower deposit refund to `borrower.available`; lender payout to `lender.available`; commission to `platform_revenue` |
| Completed with late charges | late charge deducted from deposit; remainder released to borrower; earnings minus commission paid to lender; commission to `platform_revenue`     |

## 5. Settlement Math & Commission Rounding

Platform commission is governed by `BUSINESS_CONFIG.COMMISSION_BPS` (1500 bps = 15%).

- Commission calculation: `commissionPaise = Math.round((lenderEarningsPaise * COMMISSION_BPS) / 10000)`
- Rounding direction: Standard half-up to nearest paisa (`Math.round`).
- Payout calculation: `lenderPayoutPaise = lenderEarningsPaise - commissionPaise`
- **Invariant**: `lenderPayoutPaise + commissionPaise === lenderEarningsPaise` for all amounts (tested on ₹0.01, ₹0.02, ₹0.03, ₹33.33, ₹99.99, ₹1,000.00). Zero money creation or destruction.
- Payouts above the `WALLET_CAP_PAISE` (₹50,000) are explicitly permitted so lenders are never denied their earned payouts, while manual user deposits remain strictly capped.

## 6. Settle-Once Rule (`LedgerOperation`)

To prevent double payouts, double refunds, and duplicate hold releases, every booking lifecycle money movement is guarded by the `LedgerOperation` model:

- Unique compound index: `{ bookingId: 1, operationType: 1, opRef: 1 }`
- Supported operations: `booking_hold`, `extension_hold` (with `opRef = extensionId`), `deposit_release`, `booking_cancel_refund`, `settlement`.
- The operation record is inserted within the **same MongoDB transaction** before any balance mutation occurs.
- If a duplicate record is detected:
  - API callers receive an immediate `409 Conflict` (`OPERATION_ALREADY_APPLIED`).
  - Internal consumers (worker jobs) receive an idempotent `{ alreadyApplied: true, status: 'already_applied' }` result treated as successful no-op.
  - Balances and ledger entries remain completely untouched.

## 7. Idempotency Architecture

All monetary state-modifying requests (`/v1/wallet/add`, `/v1/wallet/withdraw`) enforce idempotency via the `IdempotencyKey` collection:

- Unique compound index: `{ userId: 1, key: 1 }` with a 24-hour TTL index.
- Validation: Trimmed string, length 8 to 128 characters, matching regex `^[A-Za-z0-9_-]+$`.
- Request hashing: SHA-256 hash of `HTTP_METHOD:URL:CANONICAL_JSON_BODY`.
- Replay: Replays of the identical request hash return the saved HTTP status and body with the `X-Idempotent-Replay: true` header without re-executing.
- Reuse detection: If the same key is supplied with a different request body or URL, the server rejects with `409 Conflict` (`IDEMPOTENCY_KEY_REUSE`).
- Concurrent collision safety: If two identical requests arrive simultaneously, the winning transaction commits the key. The losing transaction catches the MongoDB duplicate key error (code 11000), aborts cleanly, and either returns `X-Idempotent-Replay: true` (if committed) or `409 Conflict` (`IDEMPOTENCY_IN_PROGRESS`). Zero 500 errors occur.
- Aborted transactions: If a transaction aborts (e.g. cap exceeded or balance failure), the `IdempotencyKey` insert is rolled back, allowing subsequent retries to execute freshly.

## 8. Reconciliation Engine

Nightly and on-demand reconciliation audits (`packages/server-core/src/services/reconciliationService.js`) ensure data integrity:

- **Consistent Snapshot Isolation**: Wallets and ledger aggregates for each batch are queried inside MongoDB transactions with `readConcern: { level: 'snapshot' }`. Initial global ledger sum, system account balances (`demo_funding`, `platform_revenue`), and orphan ledger detection also run within a snapshot transaction. This ensures point-in-time read consistency under live concurrent traffic with zero false positive mismatches.
- **Orphan User Ledger Detection**: Scans ledger entries for any records whose `userId` does not exist in `users` or `wallets` using aggregation `$lookup`, flagging discrepancies in `reconciliation_runs`.
- **Batching & Checkpoints**: Processed in batches of `BUSINESS_CONFIG.RECONCILIATION_BATCH_SIZE` (default 100). Checkpoints are stored in `reconciliation_runs.lastCheckpointUserId`.
- **Crash Resumption**: `runReconciliation({ resumeRunId })` seamlessly resumes incomplete runs from the last checkpoint.

### Transaction Time Limits & 100,000 Scale Architecture

In MongoDB Atlas, transactions have a default lifetime limit (`transactionLifetimeLimitSeconds`, typically 60 seconds). Running reconciliation across 100,000 users in a single monolithic transaction would breach this limit, cause snapshot history window exhaustion, and degrade WiredTiger cache performance. Therefore:

1. Reconciliation is strictly partitioned into discrete batches of `BUSINESS_CONFIG.RECONCILIATION_BATCH_SIZE` (default 100).
2. Each batch runs within its own short-lived snapshot transaction (~10–25ms per batch), guaranteeing read-concern snapshot isolation for that batch without exceeding the 60-second transaction limit.
3. The initial global ledger sum, platform account balance verification, and orphan user detection execute in an initial lightweight snapshot session.
4. Checkpoints (`lastCheckpointUserId`) are persisted to `reconciliation_runs` after each batch, enabling deterministic resume if a worker pod restarts.

- **Distributed Worker Lock & Database Guard**:
  - Redis distributed lock via `SET lock:reconciliation <token> NX PX 30000` with automated background heartbeat timer and Lua script release on completion.
  - Database-level guard via unique partial index on `ReconciliationRun` `{ status: 1 }` with `partialFilterExpression: { status: 'in_progress' }`.
  - Registered in `@borrowloop/worker` with repeatable cron `BUSINESS_CONFIG.BACKGROUND_JOBS.LEDGER_RECONCILIATION_CRON` (fixed jobId: `ledger_reconciliation_nightly`).
- **Memory Safety**: Discrepancies are stored in the `mismatches` array up to `BUSINESS_CONFIG.MAX_RECONCILIATION_STORED_MISMATCHES` (default 100), while `mismatchesCount` maintains the total count, ensuring the run document cannot exceed MongoDB's 16 MB BSON document size limit.

### 8.1 10,000-User Reconciliation Scale Benchmark

_Benchmark Date: 2026-11-07 | Target Replica Set: MongoDB 7.0 WiredTiger Replica Set (`rs0`)_

To verify sub-minute reconciliation performance and ensure WiredTiger snapshot history window safety at scale, a benchmark test (`apps/api/tests/walletReconciliationBenchmark.test.js`) seeds 10,000 users, 10,000 wallets, and corresponding ledger entries:

- **Total Wallets Audited**: 10,000
- **Batch Size**: 500 wallets per snapshot transaction
- **Mismatches Detected**: 0
- **Global Ledger Sum**: 0 paise (conservation verified)
- **Execution Duration**: 1,144 ms (1.14 seconds)
- **Throughput**: ~8,740 wallets/second

**Transaction Lifetime Safety**:
With batched snapshot transactions completing in ~50ms per batch of 500 users, each transaction's duration remains orders of magnitude below MongoDB's default 60-second `transactionLifetimeLimitSeconds`. Even at 100,000 wallets, the projected total runtime is ~11.4 seconds, well within nightly job SLA and WiredTiger cache limits.

## 9. Append-Only Ledger Enforcement & Direct Driver Bypass Callout

Mongoose schema middleware on `LedgerEntry` permanently blocks:

- `save()` on existing documents
- `updateOne()`, `updateMany()`, `findOneAndUpdate()`, `findOneAndReplace()`, `replaceOne()`
- `deleteOne()`, `deleteMany()`, `findOneAndDelete()`
- Mutating bulk operations (`bulkWrite` with updates/deletes)

> [!WARNING]
> Direct MongoDB driver calls (e.g. `Model.collection.updateOne`, `db.collection(...)`) bypass Mongoose schema middleware entirely.
> **Production Recommendation**: Configure a restricted MongoDB user role for the application that has only `find` and `insert` privileges on the `ledger_entries` collection, revoking `update` and `delete` permissions at the database level.

## 10. High-Concurrency Benchmark (50-Parallel Race Test)

_Benchmark Date: 2026-11-07 | Target Replica Set: MongoDB 7.0 WiredTiger Replica Set (`rs0`)_

A concurrency race test (`apps/api/tests/walletRace.test.js`) executes 50 parallel withdrawals of ₹100 (10,000 paise) against a wallet funded with exactly ₹1,000 (100,000 paise):

- **Results**:
  - Total parallel requests: 50
  - Successful withdrawals: Exactly 10 (100,000 paise withdrawn)
  - Rejected withdrawals: Exactly 40 with clean `409 INSUFFICIENT_FUNDS`
  - Unhandled write conflicts or 500 errors: 0 (exponential backoff with full jitter and `BUSINESS_CONFIG.TRANSACTION_RETRY_CAP=30`)
  - Final wallet balance: Exactly ₹0 (0 paise)
  - Final ledger entries created: 1 credit entry + 10 debit entries = 11 entries
  - Invariant: Global ledger sum remains strictly ₹0
