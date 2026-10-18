# Decision Log

## Format
Each entry: timestamp, decision, reasoning, alternatives considered.
This log is written as we go — not at hour 47.

---

## [DAY 1 - SETUP]

### Stack Selection
- Frontend: Next.js 14 + TypeScript + Tailwind
- Backend: Node.js + Express + TypeScript  
- Database: PostgreSQL + Prisma
- Queue: BullMQ + Redis
- Reasoning: Proven fintech stack, strong TypeScript support,
  Prisma gives type-safe ledger operations

### Monorepo Structure
- Used npm workspaces
- Shared types package between FE and BE
- Reasoning: Prevents type drift between frontend and backend

### Money Representation
- All USD amounts stored as BigInt in cents (integer minor units)
- Units (shares) stored as Decimal(20,6) — 6 decimal places
- Reasoning: Eliminates floating point errors on money calculations
- Rounding rule: Last lot in any trade eats the rounding penny

### Return Calculation Method
- Using Time-Weighted Return (TWR)
- Reasoning: Industry standard for investment reporting.
  TWR isolates manager performance from client cash flows.
  MWR (IRR) would make deposits look like returns.

### Tax Lot Method
- FIFO (First In, First Out)
- Reasoning: Simplest to implement correctly, defensible under 
  US tax law, deterministic behavior

### Ledger Design
- Double-entry, append-only, immutable
- effectiveDate = when it happened (value date)
- bookingDate = when we learned about it (booking date)
- Both stored on every entry for bitemporal queries
- Corrections = reversal entry + rebook entry (never edit)

---

## [DAY 1 - DATABASE]

### Migration
- `prisma migrate dev --name init` → migration `20261017130423_init`, all 10
  tables created. Client regenerated.

### Env loading in a monorepo
- Single `.env` at the repo root (one source of truth for api + web).
- Prisma CLI runs in `apps/api` and only auto-loads a local `.env`, so the
  Prisma/db scripts are wrapped with `dotenv-cli` (`dotenv -e ../../.env -- …`).
- Reasoning: avoids a duplicated `apps/api/.env` drifting from the root.

### Local Postgres setup
- Created role `user` (password `password`, with CREATEDB for the migrate
  shadow DB) and database `corgi_investment`, matching `.env.example`.
- Reasoning: keep the documented default `DATABASE_URL` truthful and portable
  rather than rewriting it to local-machine-specific credentials.

### Seed design
- Idempotent: `deleteMany` across all tables (FK-safe order) before inserting,
  so `db:seed` can be re-run safely.
- Unit-leg ledger entries (`TRADE_BUY_UNITS`) carry `amount = 0` cents; the cash
  movement lives on the paired `TRADE_BUY_CASH` entry. Keeps the double-entry
  split explicit.

### Market price generation (brief was truncated here)
- The Step 2 brief cut off at the market-price values. Decision: generate 30
  daily closes per symbol (VTI, BND), deterministic (seeded) so re-seeding is
  stable, anchored near each position's per-unit cost basis with a gentle upward
  drift (VTI ~198→203, BND ~97.4→98.2).
- Reasoning: anchoring to cost basis makes the seeded portfolio show a small,
  coherent gain for valuation/TWR work, instead of absurd returns from using
  real-world VTI/BND market prices against the seeded cost basis.
- Easy to swap for exact figures if the intended values are provided.

---

## [DAY 1 - LEDGER CORE]

### Double-entry on a single account — a tension to resolve later
- `createJournalEntry` requires every leg to share one `accountId` and the
  signed amounts to sum to 0; `getCashBalance` is `SUM(amount)` for that account.
- Consequence: a balanced journal nets to 0 on that account, so it does NOT
  move that account's own balance. The seed's real $2,045 balance comes from
  single-sided rows, not balanced journals.
- Why we shipped it as-specified: it satisfies the Step 3 contract + all tests,
  and the balance query is correct for single-sided postings.
- Proper fix when real money must move via journals: a second (counter) account
  per leg — e.g. debit the customer cash account, credit an "external_bank" /
  "settlement" account. Then each account's balance is non-trivial and the
  system-wide sum is still 0. Flagged for the money-movement step.

### Append-only enforced in depth
- API layer: `preventLedgerMutation` middleware returns 405 on PUT/PATCH/DELETE
  to any `/ledger/*` route.
- DB layer: a `BEFORE UPDATE OR DELETE` trigger on `"LedgerEntry"` raises an
  exception (migration `ledger_append_only`). This makes immutability real, not
  just convention — proven by the ledger test (update/delete reject).
- Row triggers do NOT fire on TRUNCATE, so the seed and test harness reset state
  with TRUNCATE instead of deleteMany (deleteMany would now be blocked).

### Corrections
- Never edit. `createCorrection` posts sign-flipped CORRECTION_REVERSAL rows at
  the original value date, then CORRECTION_REBOOK rows at the corrected value
  date, all in one transaction. Reversal links to its original via referenceId.

### Balances
- `getBalanceAsOf` filters `effectiveDate <= asOf` (inclusive) — value-dated.
- Negative cash after a journal is a WARNING (logged), never an error — a
  withdrawal can legitimately precede a future-dated settlement.

### Testing
- Jest + ts-jest, run serially against an ISOLATED database
  (`corgi_investment_test`), created/migrated in global-setup via
  `prisma migrate deploy`. Keeps dev/seed data untouched; TRUNCATE between tests.
- Run with `npm test -w @corgi/api`.

---

## [DAY 1 - AUTH + KYC (Stripe Identity)]

### Schema additions
- `User.fullName String?` (nullable so existing rows migrate cleanly; seed sets it).
- `Account.stripeVerificationSessionId String?` for the Stripe Identity session.
- Migration `add_auth_kyc_fields`. `personaInquiryId` kept but unused (KYC moved
  to Stripe Identity).

### Auth
- JWT payload is `{ userId, email, role, accountId }` (accountId embedded so
  routes resolve the account without an extra query).
- Passwords: bcrypt, 12 rounds. `passwordHash` is stripped in the service
  (`toSafeUser`) and never leaves the API.
- Login returns one generic "Invalid credentials" for both unknown-email and
  wrong-password, so we don't leak which emails exist.
- `authenticate` now enforces (401); `requireRole` → 403; new `requireKYC` → 403
  ("KYC verification required…"). `requireKYC` is applied to the deposits router.
- Consequence: `/ledger/*` now requires a valid token (the earlier dev
  `?accountId=` shim was removed) — account comes from `req.user.accountId`.

### KYC (Stripe Identity)
- `createVerificationSession` uses the Stripe SDK (equivalent to the raw REST
  call in the brief) with document + matching-selfie options; persists the
  session id + PENDING.
- Webhook signature verification is mandatory: `stripe.webhooks.constructEvent`
  over the RAW body. In index.ts, `express.raw` is registered for `/kyc/webhook`
  BEFORE the global `express.json`, so the signature can be checked byte-for-byte.
  Needs `STRIPE_WEBHOOK_SECRET` (blank until the endpoint is deployed).
- Events handled: verified → APPROVED+ACTIVE; requires_input → PENDING (logs
  reason); canceled → REJECTED.
- `simulateKYCApproval` (sandbox only; refuses in production) approves without
  the Stripe UI and writes a zero-amount ledger note for the audit trail. This
  is how the flow is tested end to end without real documents.

### Frontend
- `lib/auth-context.tsx` (token in localStorage, hydrates via `/auth/me`),
  `lib/api-client.ts` interceptors (attach bearer; on 401 clear + redirect to
  /login). Register/login/KYC pages (react-hook-form + zod). `app/providers.tsx`
  wraps the root layout.
- Next reads public env from `apps/web/.env.local` (NOT the repo root .env):
  `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` (pk_test is public).

---

## [DAY 1 - PLAID DEPOSITS + COUNTER-ACCOUNT LEDGER]

### Counter-account model — resolves the Step 3 double-entry tension
- Problem (flagged in Step 3): a balanced journal (sum=0) on ONE account can't
  move that account's own balance.
- Fix: every ledger leg carries `metadata.bucket`:
  - `SETTLED_CASH` — the customer's available cash (what getCashBalance counts)
  - `IN_TRANSIT`  — deposit in clearing (pending; excluded from cash)
  - `EXTERNAL`    — the external bank counter-account (excluded from cash)
- `getBalanceAsOf` (cash path) now SUMs only non-counter buckets (legacy entries
  with no bucket count as settled cash), via raw SQL for clean JSON-null handling.
- Deposit journals (all balanced, zero-sum):
  - initiate: +IN_TRANSIT / -EXTERNAL  → cash unchanged (pending ≠ available)
  - settle:   +SETTLED_CASH / -IN_TRANSIT → available cash increases
  - bounce:   -IN_TRANSIT / +EXTERNAL  → cash unchanged (pending reversed)
- Verified: pending shows but doesn't inflate cash; settle raises cash; bounce
  leaves cash unchanged. Ledger stays append-only (bounce/settle INSERT only).

### Pending vs available
- `pendingDepositsCents` comes from the Deposit table (status=PENDING), the
  authoritative lifecycle record. `availableBalanceCents` = cash (pending excluded).

### Secrets
- Plaid access token encrypted at rest (AES-256-CBC, key = SHA-256(JWT_SECRET),
  stored `iv:ciphertext` hex — `lib/crypto.ts`). Never logged or returned.

### Settlement job
- BullMQ `ach-settlement` queue + worker (started in index.ts). Delay 10s in
  sandbox (quick demo), 86_400_000ms (T+1) in production. `settleDeposit` is
  idempotent (no-op if not PENDING), so retries/duplicate jobs never double-credit.
- Gotcha fixed: BullMQ custom jobId can't contain ':' — use `settle-<id>`.
- Enqueue is wrapped in try/catch so a Redis outage doesn't fail the deposit.

### Deviation from the literal spec
- The spec's initiate/settle journals were two self-cancelling CASH_DEPOSIT legs
  (net 0 on one account), which would leave cash unchanged even after settlement
  and fail check 5. Implemented the counter-account/bucket model instead (same
  entry types + descriptions), which satisfies all 7 checks and is the correct
  double-entry design.

---

## [DAY 2 - ALPACA ORDERS + FILLS]

### Buy journal — extends the counter-account model with an INVESTED bucket
- A buy moves money from cash to investments, so the fill journal is:
  - `TRADE_BUY_CASH`  -cost  (bucket SETTLED_CASH — available cash down)
  - `TRADE_BUY_UNITS` +cost  (bucket INVESTED, carries the units — invested up)
- `COUNTER_BUCKETS` now includes `INVESTED`, so getCashBalance correctly drops
  by the purchase cost while the journal stays balanced and append-only.
- Deviation from the spec's literal journal: it had the units leg at amount 0n,
  which wouldn't balance (sum != 0) and createJournalEntry rejects. We book the
  cost on the units/INVESTED leg. Money and units stay separate dimensions
  (BigInt cents vs Decimal(20,6)).

### Allocation math fix
- Model weights already sum to 0.9 (the 10% buffer is the remainder), so
  target = weight * availableCash directly. The spec's `investable*weight`
  (investable = 0.9*cash) double-applied the buffer (left ~19% cash). Fixed.

### Alpaca client: REST via fetch, not the SDK
- The installed `@alpacahq/alpaca-trade-api` is a major rewrite: the client is a
  named export, its config key is `secret` (not `secretKey`), and the instance
  has no `createOrder`/`getLatestTrade`/`getOrder` (uses `_trading`/`_marketData`).
  Rather than pin/guess the SDK surface, we call the REST API directly with Node's
  global `fetch` (the spec explicitly allows axios/direct). Verified: real paper
  orders are created (orders show in the Alpaca dashboard).
- `ALPACA_BASE_URL` has a trailing `/v2` stripped defensively (REST path adds it).

### Idempotency (mandatory)
- Two guards: a per-execution Redis key (`alpaca:exec:<id>`, 24h) AND an
  order.status===FILLED short-circuit. Replaying a fill books no duplicate
  ledger entries (verified).

### Fills, tax lots, polling
- One tax lot per FILL (not per order), so partial fills each open a lot.
- Order lifecycle: PENDING -> SUBMITTED -> PARTIALLY_FILLED/FILLED (or
  CANCELLED/REJECTED). No cash is reserved at submit, so cancel/reject just
  updates status (nothing to release).
- Market-closed is handled gracefully: Alpaca accepts the order (queued to next
  open); our order stays SUBMITTED. A 30s polling fallback (order-polling.job)
  books fills if a webhook is missed; `simulate-fill` books them in dev/testing.
- Prices: live Alpaca data API, falling back to the MarketPrice table, then throw.

---
