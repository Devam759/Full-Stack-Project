# Rules for AI coding agents

Read `README.md` and everything in `docs/` before writing code. If a document and a request conflict, stop and ask.

## Hard rules

1. All money amounts are stored as integers in paise. Never use floating point for money.
2. Money may only change through the ledger service (`docs/WALLET_AND_PAYMENTS.md`). No other code may edit a balance directly.
3. Every endpoint that moves money or changes a booking state must run inside a MongoDB transaction and accept an `Idempotency-Key` header.
4. Business numbers (fees, limits, penalties) come from `packages/shared/src/config.js` only. Never hard-code them.
5. The wallet must sit behind a `PaymentProvider` interface so a real provider can replace the demo wallet later.
6. Validate every request body, query and parameter with Zod. Return the standard error format in `docs/API_SPEC.md`.
7. Never log passwords, tokens, full email addresses or exact locations.
8. Never show exact user locations to other users. Use distance bands.
9. Show a visible "Demo money" label wherever money appears.
10. Do not add libraries without a short reason in the pull request description.

## Code standards

- Plain JavaScript only (ES modules, Node.js 20 or newer). Do not use TypeScript, and do not add `.ts` or `.tsx` files. Use JSDoc comments for documenting function inputs and outputs where it helps.
- ESLint and Prettier must pass. Conventional commit messages.
- Every service function has unit tests. Money and booking flows also have integration tests.
- No feature is complete without: validation, authorisation check, tests, and updated docs.

## Working method

- Build in the phases listed in `docs/ROADMAP.md`. Finish and test one phase before starting the next.
- After each phase, list what was built, what was tested and any deviation from the documents.
- If something is unclear, ask. Do not guess business rules.
