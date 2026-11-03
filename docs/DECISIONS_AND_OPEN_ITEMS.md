# Decisions and Open Items

## Decisions made by the product owner

- Team of three. Stack: MERN. Deployed and fully working. Designed for 100,000 users.
- Hosting: Vercel (frontend), Render (backend), MongoDB Atlas, with a CDN. Deployment is handled by the owner.
- No identity verification. Users join any community by saying they belong. Signup needs email and password and a profile photo.
- On first visit the app asks for location and shows nearby communities.
- Anything legal may be listed. Users can report unusual items.
- Meeting place is agreed in chat with a map pin.
- Lenders set the deposit and an optional extra late charge.
- Deposit is frozen in the borrower wallet and refunded on a good return. Disputes go to care agents.
- Wallet is demo money. Instant add and withdraw. Cap Rs 50,000. Labelled as demo money.
- No pooled-money or "many people want this" feature.
- Admin is the product owner. A separate care portal is required.
- Platform takes 15% of the amount the lender receives.
- Trust score comes from history and ratings.
- Website works like an app (PWA). On-site notifications plus email for important events.
- Google AdSense for ads. Ads sit in feeds and public pages.
- Strike plan approved. Cancellation allowed before pickup. Borrower cannot book with too little wallet money.
- The site is not given to the general public until real money is integrated properly.
- Minimum age 18.

## Decisions delegated to the assistant ("your choice")

Please review. Each can be changed in `config.js` or the documents.

1. Payout above the Rs 50,000 cap is allowed. Adding money stays blocked until under the cap.
2. The 15% commission applies to rent and late charges. It does not apply to deposit compensation for damage. The owner said "whatever the total amount", so change `COMMISSION_APPLIES_TO` if the commission should apply to all of it.
3. Lost no-show: the person at fault loses 5 trust points.
4. Any logged-in user can create a community. Communities may be public or private. Only the admin can suspend one.
5. Extension requests are included.
6. Custom domain with sub-domains is the recommended setup for login cookies.
7. Minimum age of 18 in the terms.
8. Late charges stop at the deposit. A dispute opens after 3 days overdue.
9. Lender has 24 hours after return to confirm. Silence means "all good".
10. Rating reveal is blind, with a 7-day limit.

## Open items (not decided yet)

- Name, logo and brand guidelines.
- Custom domain.
- Exact prohibited item list after legal review.
- Real-money method for the public launch. Needs legal and licensing advice. Do not build it before that.
- Who staffs the care portal in practice.
- Final terms of use and privacy policy text.
- Choice of image moderation service.
- Whether AdSense accepts the final domain.

## Known risks

- With demo money, a deposit gives no real protection. This is why the site stays closed to the public.
- Free hosting tiers cannot show 100,000-user performance. The design supports it. The demo may run smaller.
- Legal points in these documents are not legal advice.
