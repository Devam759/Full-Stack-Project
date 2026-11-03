# Product Requirements

## 1. Purpose

Help people in a community use items they do not need to own. Lenders earn rent. Borrowers save money. A deposit and a customer care team protect both sides.

## 2. Roles

| Role       | Description                                                            |
| ---------- | ---------------------------------------------------------------------- |
| User       | One account can both lend and borrow                                   |
| Care agent | Works in the portal. Reviews disputes and reports and decides outcomes |
| Admin      | Full control: users, communities, agents, ads, analytics, appeals      |

## 3. Scope of version 1 (demo)

Included: sign up and login, profile photo, communities and location, item listings, search, availability calendar, booking requests, demo wallet, deposit freeze, chat with map pin, QR handover and return, ratings and trust score, cancellation, extension, late charges, disputes, reports, care portal, admin portal, notifications, ads placeholders.

Not included: real money, delivery, insurance, mobile native apps, collective buying, item-demand analytics.

## 4. User flows

### 4.1 Sign up and first visit

1. User registers with name, email, password and profile photo.
2. User confirms email through a link.
3. The app asks for location permission. If refused, the user searches for a city or area.
4. Nearby communities are shown immediately.
5. The user joins any public community with one tap. No approval is needed.
6. Private communities need owner approval or an invite code.

### 4.2 Wallet (demo money)

1. Every user has a wallet showing available, frozen and pending amounts.
2. "Add money" adds the amount instantly, up to the cap.
3. "Withdraw" removes available money instantly.
4. Every money screen shows a "Demo money" label.

### 4.3 Listing an item

1. Lender adds name, category, description, condition, up to 6 photos.
2. Lender sets rent per day, security deposit, minimum and maximum days.
3. Lender may set an extra charge per overdue day (optional).
4. Lender chooses the communities that can see the item.
5. The item is checked against the prohibited list. Suspicious items go to review.

### 4.4 Finding an item

1. Search by text, category, distance, price and dates.
2. The item page shows photos, rent, deposit, lender trust score, free dates and a report button.

### 4.5 Booking

1. Borrower picks dates and sends a request. The wallet must hold rent plus deposit.
2. Lender accepts or rejects within 24 hours, or the request expires.
3. On acceptance, rent plus deposit are frozen and the dates are locked.
4. Other pending requests for the same dates are rejected automatically.

### 4.6 Chat and meeting point

1. A chat opens for the two people when a request is sent.
2. Either person can drop a map pin to propose a meeting place.
3. The other person confirms the pin.

### 4.7 Handover

1. At the meeting point, the lender shows a rotating QR code and the borrower scans it. A 6-digit code is the fallback.
2. Both take condition photos inside the app.
3. The booking becomes `picked_up`.

### 4.8 Return

1. The borrower shows a QR code and the lender scans it.
2. Both take condition photos.
3. The lender chooses "All good" or "Report a problem".
4. If the lender does nothing for 24 hours, the booking completes as "All good".
5. On "All good": deposit returns to the borrower, rent goes to the lender minus the commission, and both rate each other (ratings stay hidden until both submit).
6. On "Report a problem": a dispute opens.

### 4.9 Overdue

1. A reminder is sent before the due time.
2. After the due time, the late charge accrues daily (if the lender set one), capped at the deposit.
3. After 3 full days overdue, a "not returned" dispute opens automatically.

### 4.10 Cancellation and extension

- Either side may cancel before pickup. All frozen money returns to the borrower.
- The borrower may request an extension. The lender approves. Dates must be free. The extra rent is frozen.

### 4.11 Disputes

1. A case file is created: chat, photos, timeline, money details.
2. A care agent opens it in the portal and decides the split of the deposit.
3. Both users are notified. Each may appeal once to the admin.

### 4.12 Reports and safety

- Any user can report an item, user or message.
- An item with 3 reports from different users is hidden until a care agent reviews it.
- Users can block other users.

### 4.13 Admin and care portals

- Care portal: dispute queue, report queue, case file, decision form, user lookup, decision history.
- Admin portal: all of the above plus users, communities, agents, appeals, ads control, platform analytics, audit log.

## 5. Success criteria for the course

- Every flow above works end to end on a deployed URL.
- Money movement never loses or creates money (ledger checks pass).
- The system design supports 100,000 registered users (see `ARCHITECTURE.md`) and a load test result is shown.
