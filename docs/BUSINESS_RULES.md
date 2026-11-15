# Business Rules

All numbers below are defaults. They live in `packages/shared/src/config.js` and can be changed in one place.

## Money

| Rule                         | Value                                                                            |
| ---------------------------- | -------------------------------------------------------------------------------- |
| Currency                     | INR, stored as integer paise                                                     |
| Wallet cap                   | Rs 50,000 (available plus frozen)                                                |
| Add money                    | Instant, allowed only while the cap is not exceeded                              |
| Withdraw                     | Instant, only from available                                                     |
| Platform commission          | 15%                                                                              |
| Commission applies to        | Rent and late charges earned by the lender                                       |
| Commission does not apply to | Deposit compensation for damage (configurable)                                   |
| Deposit limit                | Rent total plus deposit must not exceed the cap                                  |
| Payout above cap             | Payout is paid in full. "Add money" stays blocked until balance is under the cap |

## Booking

| Rule                   | Value                                                                            |
| ---------------------- | -------------------------------------------------------------------------------- |
| Minimum / maximum days | 1 / 30 (lender may set a lower maximum)                                          |
| Request expiry         | 24 hours without lender response                                                 |
| Pickup deadline        | End of the start date (IST). If no pickup, booking expires                       |
| Cancel before pickup   | Allowed for both sides                                                           |
| Late cancel            | Within 6 hours of the start time: trust score penalty for the person who cancels |
| Extension              | Needs lender approval, free dates, wallet funds for the extra rent               |

## Late return

- Late charge per day is set by the lender. It is optional.
- Charge accrues per started day after the due time: `lateDays = max(0, ceil((effectiveTime - dueAt) / 24h))`, `charge = min(lateDays * lateFeePerDayPaise, depositPaise)`.
- Charges are taken from the frozen deposit and never exceed it.
- After 3 full days overdue (`now >= dueAt + 3 days`), a "not returned" dispute opens automatically (`disputeReason: 'not_returned'`).
- The borrower account is frozen (`status: 'frozen'`). Deposit stays frozen until Phase 8 care resolution.

## Return confirmation

- The lender has 24 hours after the return scan to choose "All good" or "Report a problem".
- "All good": settles rent minus 15% commission to lender available, releases deposit to borrower available, releases unused day locks, marks `completedAt` and `completedBy: 'lender'`.
- "Report a problem": note required, transitions to `disputed` with `disputeReason: 'damage'`, no money moves, funds stay frozen.
- No choice within 24 hours triggers `autoCompleteReturnJob` to settle automatically with `completedBy: 'system'`. Lender receives a reminder 4 hours before deadline.

## Trust score (0 to 100, shown on profiles)

Start at 50. Derived cache field recalculated from append-only `trust_events` and revealed ratings:

- `ratingPart = round(20 * ((avg - 3) / 2) * min(count, 10) / 10)`
- `onTimePart = min(2 * onTimeCount, 20)` (each distinct counterparty counted once per role: lend or borrow)
- `score = clamp(50 + ratingPart + onTimePart + sum(penalties), 0, 100)`
- Penalties:
  - Lost dispute: -10
  - Late cancel (within 6h of start date): -3
  - Rejected damage claim by care agent: -5
  - No-show at pickup: -5 (recorded in Phase 8)
- Score is clamped between 0 and 100. Always written by recompute, never `$inc`.

## Ratings

- 1 to 5 stars and an optional short comment (max 500 characters).
- Hidden until both sides submit, or 7 days pass from booking completion.
- When revealed, triggers rating average update and trust score recomputation.

## Strikes

A "lost dispute" means a care agent ruled against the user's conduct.

1. First: warning notification.
2. Second: 7-day suspension (`banUntil = now + 7 days`, status remains `active`). The suspended user cannot book, accept requests, list, or relist items, but can log in, withdraw available funds, and return items currently held.
3. Third: permanent ban (`status: 'banned'`).

- Not returned item: dispute opens and borrower account is frozen at once (`status: 'frozen'`).
- The admin may reverse a strike on appeal.

## Communities

- Any logged-in user may create a community. Creation is rate limited and names must be unique.
- Public: anyone may join instantly.
- Private: join by owner approval or invite code.
- The creator is the owner. Owners may remove members from their own community.
- Only the admin may suspend or delete a community.

## Disputes and Case Decisions (Phase 8)

- Dispute reasons: `damage`, `not_returned`, `condition_mismatch`, `no_show`.
- Opening rules:
  - `damage`: Opened by lender choosing "Report a problem" upon return scan.
  - `not_returned`: Opened automatically by background worker after 3 full days overdue (`now >= dueAt + 3 days`), freezing borrower account.
  - `condition_mismatch`: Opened by borrower while booking is `picked_up` and `now <= dueAt`. Freezes final late charges.
  - `no_show`: Opened by either borrower or lender while booking is `accepted`, from start date until pickup deadline.
  - Strictly one dispute per booking.
- Late charge in decision:
  - If `applyLateCharge` is true (default), the accrued late charge on booking (`lateChargePaise`) is paid to lender with 15% platform commission.
  - Remaining deposit is split by agent: `depositToLenderPaise + depositToBorrowerPaise === depositPaise - appliedLateChargePaise`.
  - Deposit compensation to lender has 0% platform commission.
- Rent outcome: `lender` (lender earns rent minus 15% commission) or `refund_borrower` (full rent refunded to borrower).
- No-show resolution: Force-cancels booking (`cancelled`); 100% of deposit and rent returned to borrower.
- Penalties per case:
  - `lost_dispute`: -10 trust score and one strike.
  - `rejected_damage_claim`: -5 trust score to lender, zero strikes.
  - `no_show`: -5 trust score, zero strikes.
  - `none`: No trust penalty or strike.
- Care authority: Care agents cannot ban. Permitted actions: `dismiss`, `hide_item`, `remove_item`, `restore_item`, `warn_user`, `strike_user`. Permanent ban/unban is admin only (Phase 9).
- Appeals: One appeal per dispute submitted by either participant within `APPEAL_WINDOW_DAYS` (7 days) of decision. Settlement remains in force until Phase 9 admin review.
- Appeal reversal and shortfall (Phase 9):
  - A reversal moves money only between available balances and `platform_revenue`.
  - Every wallet debit is strictly capped at that wallet's available balance.
  - Any unrecoverable amount is deducted from the credit of the party who would have gained the most, recorded on the dispute as `unrecoveredPaise`. The admin must pass `acknowledgeShortfall: true` when `unrecoveredPaise > 0`.
  - Wallet `pendingPaise` remains strictly locked at 0 (Phase 4 invariant).
- Appeal decisions:
  - `upheld`: Care decision stands, no money moves, dispute closes.
  - `overturned`: Admin sends revised decision with identical deposit-split validation. `no_show` disputes must retain the full-refund rule (only fault and penalty can change).
  - Conflict of interest: The admin who made the original care decision or is a counterparty in the booking cannot decide the appeal (`CONFLICT_OF_INTEREST`).
  - Penalty correction on overturn: Original penalties are reversed via `penalty_reversed` append-only trust events and the original strike reversed, then revised penalties and strikes applied with deterministic keys.
- Administration & Staff Management (Phase 9):
  - Banning: Only admins ban and unban. Admins cannot ban themselves, other admins, or care agents.
  - Banning is refused (`USER_HAS_ACTIVE_BOOKINGS`) if the user has bookings in `picked_up`, `returned`, or `disputed`.
  - On ban: pending (requested) bookings are cancelled; accepted bookings are cancelled with full refund to borrower; items are hidden with `hiddenReason: 'owner_banned'` and `hiddenFromStatus`; refresh tokens revoked; sockets disconnected.
  - Unban restores owner_banned items only. Strikes are not reset on unban.
  - Care agents: Admin promotes active, email-verified users. TOTP enrollment link is emailed and never echoed. Demotion resets role to user, clears TOTP, revokes tokens, and returns assigned open disputes to `opened`.
  - The last admin cannot be demoted or removed.
- Analytics definitions (Phase 9):
  - Volume: Sum of `rentPaise` on `completed` bookings.
  - Deposits held: Sum of all `frozenPaise` across wallets.
  - Commission earned: Ledger sum of all `platform_revenue` entries (including appeal reversals).
  - Dispute ratio: Total disputes divided by bookings that reached `picked_up`.
  - Rented items: Derived count from bookings in `picked_up` state.

## Moderation

- Three reports from different users hide an item until reviewed.
- Prohibited categories (subject to legal review): weapons and ammunition, drugs, alcohol and tobacco, medicines, adult items, vehicles, hazardous or explosive materials, live animals, stolen goods.
- Items that may hold personal data (phones, laptops) show a warning to reset and remove data before lending.

## Users

- Minimum age 18 (stated in the terms).
- One account per person. New accounts are rate limited.
- A user cannot delete an account while bookings are open or money is frozen.

## Ads (Phase 9)

- Master switch is off by default; enabling requires explicit `confirm: 'ENABLE_ADS'`.
- Ads render only if: master switch is ON, specific placement is active, user accepted cookie/ad consent, and current screen is in `ALLOWED_SCREENS` (`items`, `item-detail`).
- Strict denylist (`RESTRICTED_SCREENS`): suppressed on wallet, bookings, chat, disputes, notifications, profile, settings, onboarding, auth, or portal screens.
- Declining consent completely suppresses ad scripts. Consent re-prompted after 180 days. Withdrawal link provided in footer.
