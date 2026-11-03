# Wallet, Ledger and Booking States

## 1. Principles

1. The wallet is demo money for now. The code must treat it as if it were real.
2. Balances are never edited directly. They are derived from an append-only ledger.
3. Every money movement is a set of ledger entries that sum to zero (double entry).
4. Every money endpoint runs inside a MongoDB transaction and uses an idempotency key.
5. A `PaymentProvider` interface hides where money comes from, so a real provider can replace the demo one.

## 2. Accounts

Each user has three logical accounts: `available`, `frozen`, `pending`.
The platform has `platform_revenue` and `demo_funding` accounts.

## 3. Ledger entry

```
{ _id, txnId, bookingId?, account, userId?, amountPaise (signed), type, createdAt, meta }
```

Entries with the same `txnId` must sum to zero. A cached balance on the wallet document is updated in the same transaction and verified by a nightly reconciliation job.

## 4. Movements

| Event                       | Entries                                                                                                                |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Add money                   | demo_funding to borrower.available                                                                                     |
| Withdraw                    | user.available to demo_funding                                                                                         |
| Booking accepted            | borrower.available to borrower.frozen for (rent + deposit)                                                             |
| Late charge accrued         | recorded on the booking only. Settled at completion                                                                    |
| Completed "all good"        | frozen deposit to borrower.available. Frozen rent to lender.available minus commission. Commission to platform_revenue |
| Completed with late charges | late charge from frozen deposit to lender.available minus commission. Rest of deposit to borrower.available            |
| Cancelled before pickup     | all frozen to borrower.available                                                                                       |
| Dispute decided             | agent sets deposit split. Lender share to lender.available. Remainder to borrower.available. Rent follows the decision |
| Not returned                | full deposit to lender.available. Rent to lender minus commission                                                      |
| Extension approved          | extra rent from borrower.available to borrower.frozen                                                                  |

## 5. Invariants (test these)

- The sum of all ledger entries is always zero.
- A user's cached balances equal the sum of their ledger entries.
- No account goes below zero.
- A booking's frozen total equals the sum of its open holds.
- Each booking is settled exactly once.

## 6. Booking state machine

```
requested -> accepted -> picked_up -> returned -> completed
requested -> rejected | expired | cancelled
accepted  -> cancelled | expired (no pickup)
picked_up -> overdue (flag) -> disputed (not returned)
returned  -> disputed -> resolved
```

Allowed transitions are defined in one table in code. Any other transition is rejected.

## 7. Availability locking

When a booking is accepted, insert one `item_day_locks` document per day with a unique index on `(itemId, day)` inside the same transaction. A duplicate key error means the dates are taken. Deleting the locks happens on cancel, expiry and completion.

## 8. Provider interface

Define a base class (or an object with the same methods) in plain JavaScript:

```js
/** Contract for any wallet provider. */
export class PaymentProvider {
  async addFunds(userId, amountPaise, idempotencyKey) {
    throw new Error('Not implemented');
  }
  async withdraw(userId, amountPaise, idempotencyKey) {
    throw new Error('Not implemented');
  }
  async getBalances(userId) {
    throw new Error('Not implemented');
  }
}
```

The demo provider extends this class and writes ledger entries against `demo_funding`. A real provider would be added later after legal and licensing review. Do not build the real provider now.
