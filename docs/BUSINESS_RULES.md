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
- Charge accrues per started day after the due time.
- Charges are taken from the frozen deposit and never exceed it.
- After 3 full days overdue, a "not returned" dispute opens automatically.
- "Not returned" outcome: the full deposit goes to the lender and the borrower account is frozen.

## Return confirmation

- The lender has 24 hours after the return scan to choose "All good" or "Report a problem".
- No choice means "All good".

## Trust score (0 to 100, shown on profiles)

Start at 50. Recalculate after each event.

- Ratings: average rating gives up to plus or minus 20 points. The effect grows with the number of ratings (full effect at 10 ratings).
- On-time completed borrow or lend: plus 2 each, up to plus 20 in total.
- Lost dispute: minus 10.
- No-show at pickup: minus 5.
- Late cancel: minus 3.
- Repeated damage claims by a lender that care agents reject: minus 5 each.
- Score is clamped between 0 and 100.
- Only completed bookings with distinct users count towards the score.

## Ratings

- 1 to 5 stars and an optional short comment.
- Hidden until both sides submit, or 7 days pass.

## Strikes

A "lost dispute" means a care agent ruled against the user's conduct.

1. First: warning.
2. Second: 7-day ban from booking and listing.
3. Third: permanent ban.

- Not returned item: full deposit to the lender and the account is frozen at once.
- The admin may reverse a strike on appeal.

## Communities

- Any logged-in user may create a community. Creation is rate limited and names must be unique.
- Public: anyone may join instantly.
- Private: join by owner approval or invite code.
- The creator is the owner. Owners may remove members from their own community.
- Only the admin may suspend or delete a community.

## Moderation

- Three reports from different users hide an item until reviewed.
- Prohibited categories (subject to legal review): weapons and ammunition, drugs, alcohol and tobacco, medicines, adult items, vehicles, hazardous or explosive materials, live animals, stolen goods.
- Items that may hold personal data (phones, laptops) show a warning to reset and remove data before lending.

## Users

- Minimum age 18 (stated in the terms).
- One account per person. New accounts are rate limited.
- A user cannot delete an account while bookings are open or money is frozen.

## Ads

- Ads are placed in listing feeds and on public pages only.
- No ads on wallet, chat, dispute, portal or settings pages.
- Ads stay switched off until the public launch.
