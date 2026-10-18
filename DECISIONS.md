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

## [DAY 2 - DAILY VALUATION JOB]

### Prices
- market-price.service fetches daily closes from Alpaca bars (feed=iex) and
  stores immutable MarketPrice snapshots. To stay robust on weekends/holidays it
  requests a 7-day window and takes the latest bar (not a single-day query).
- Missing/failed price → mark last known stale, never crash (fetchAllActivePrices
  returns {fetched, failed, stale}).

### Valuation
- value = Σ(units × price) + cash. Units are Decimal(20,6); price is BigInt
  cents. The multiply is done in Decimal and converted to BigInt ONCE at the end
  (`units.times(priceCents.toString()).toFixed(0)` → BigInt) — money and units
  never mixed.
- Snapshots are immutable and idempotent: upsert keyed by
  (accountId, valuationDate@UTC-midnight, isRestated=false), so re-running a day
  updates the same row.
- A position with no price counts as 0 and flags hasStalePrice — the job never
  crashes on a single bad symbol.
- TWR is a placeholder 0 here (returnPct = twrPct = 0); Step 8 computes it.

### Job
- BullMQ worker on the `daily-valuation` queue; repeatable cron `0 16 * * 1-5`
  tz America/New_York (weekdays 4pm ET — market closed weekends). No auto-retry
  (tomorrow's run catches up). Manual trigger via POST /valuation/run (adviser)
  and the test endpoints.

### Real vs expected prices (note)
- The brief's checks assume VTI ~$195-205 / BND ~$95-100, but the live Alpaca
  IEX feed returns the REAL prices (VTI ~$374, BND ~$71). We use the real
  prices; the math is correct, the brief's ranges were based on the fictional
  seed. Likewise "accountsValued" is >1 because the dev DB has several ACTIVE
  accounts from prior testing, not just the demo investor.

---

## [DAY 2 - TIME-WEIGHTED RETURN (TWR)]

### Why TWR
- TWR isolates portfolio performance from the timing/size of cash flows — a
  deposit is not a return. We show "Time-Weighted Return" explicitly (labelled,
  with a tooltip) because the debrief will ask.

### Formula & precision
- Rᵢ = (End − Start − CashFlow) / (Start + CashFlow); TWR = Π(1 + Rᵢ) − 1.
- ALL math uses Prisma.Decimal (decimal.js) — never JS floats. Stored as
  Decimal(10,6) on Valuation (twrPct = returnPct), e.g. 0.023400 = 2.34%.
- denominator ≤ 0 → sub-period return 0 (no capital).

### Cash-flow detection respects the bucket model (key subtlety)
- A deposit is booked as two legs (IN_TRANSIT + EXTERNAL) that net to zero, and
  settlement moves it into SETTLED_CASH. So cash flows for TWR sum only the
  non-counter-bucket legs of CASH_DEPOSIT / CASH_WITHDRAWAL / CASH_DEPOSIT_RETURN
  — the same filter as the cash balance. (Dividends are NOT cash flows — they are
  return.) Summing raw CASH_DEPOSIT would be 0 and break everything.

### Sub-periods
- Chain the return between each pair of consecutive daily valuation snapshots,
  with the interval's net cash flow. Needs ≥ 2 snapshots; otherwise TWR = 0 (not
  an error). The /twr/sub-periods endpoint exposes the breakdown transparently.

### Demo-time note
- `referenceEnd` extends the window to the latest snapshot when snapshots exist
  beyond the real clock (simulate-performance fast-forwards trading days), so TWR
  reflects the whole simulated series.
- calculateAccountValuation reads cash as-of-now (getCashBalance), fine for
  forward simulation; a true historical backfill would need as-of-date cash.

### Integration & proof
- runDailyValuation now calls updateValuationWithTWR after storing each snapshot
  (replaces the Step 7 placeholder 0).
- Unit test (twr.test.ts) proves the chained 7.625% scenario and that a
  same-period deposit yields a 0% sub-period (deposit excluded). 10/10 tests pass.

## [DAY 2 - RESTATEMENT MACHINERY (bitemporal)]

### Never rewrite history — only add rows
- A price correction is a NEW MarketPrice row (isRestated=true) for the same
  symbol+date; the original (isRestated=false) is never updated. Unique key
  widened to (symbol, date, isRestated).
- A restatement is a NEW Valuation row with the SAME valuationDate and a NEW
  bookingDate, carrying originalTotalValueCents / originalTwrPct /
  originalBookingDate / correctedPrices. The original row is never updated.
- Dropped the Valuation (account, date, isRestated) unique so a date can have the
  original + N restatements. storeValuation / updateValuationWithTWR became
  manual find-or-update-by-id instead of compound-key upsert.

### Effective vs original (the key correctness point)
- "Current truth" = the latest bookingDate row per valuationDate
  (getEffectiveValuationHistory, Postgres DISTINCT ON). TWR and getLatestValuation
  now use the EFFECTIVE series, so a restatement flows into returns while the
  original stays for audit.
- getValuationAsPublished(date, asOfBookingDate) = latest booking ≤ that moment
  ("what we believed then"); getValuationAsRestated(date) = latest booking now.

### Market-price resolution
- getLatestPrice prefers a restated row for a given date (orderBy date desc,
  isRestated desc, createdAt desc), so revaluation picks up the correction.

### Demo wiring
- run-full-test backfills 3 real past-dated snapshots with BACKDATED bookingDates
  (so the bitemporal as-of-earlier-date query is meaningful in a fast-forward
  demo), then restates the 3-days-ago one. Verified: original untouched, restated
  created, values differ, TWR recalculated, both queryable, 2 rows in DB with
  originalTotalValueCents filled.

### Migration
- Hand-authored `add_restatement` SQL (migrate dev refuses non-interactively on
  the data-loss warning) applied via `prisma migrate deploy`; backfills existing
  rows' bookingDate = createdAt.

### Frontend
- Investor /restatements (correction history), dashboard restatement banner,
  adviser /restatement price-correction tool (adviser-role gated).

## [DAY 2 - RECONCILIATION]

### Two sources of truth
- Our ledger/positions/prices vs a SIMULATED custodian file. A clean file is
  built FROM our own data, so it reconciles to zero breaks; a planted break is
  then detectable.

### Break types & detection
- MISSING_IN_LEDGER (custodian has it, we don't), MISSING_IN_CUSTODIAN (we have
  it, they don't), AMOUNT_MISMATCH (units differ > 1e-6, or cash > $0.01),
  PRICE_MISMATCH (price differs > 0.1%). Reconcile per (accountId, symbol).
- Injected breaks: missing (remove a position), amount (+5% units), price (+3%).

### Idempotency / no duplicates
- createBreak de-dups against existing OPEN breaks (breakDate+type+symbol+account),
  so running reconciliation twice a day yields the same result. A resolved break
  does not block a new one if the mismatch recurs.
- agingDays = days since breakDate, refreshed by the daily job; new break = 0.

### Schema
- New CustodianFile model (rawData Json). ReconciliationBreak gained accountId,
  description, resolution (additive migration — ran non-interactively).

### Job & access
- BullMQ reconciliation worker, weekday 6am ET cron. Reconciliation is
  ADVISER-ONLY (investors get 403) — "investors cannot see breaks".

### Custodian file is SIMULATED
- Clearly labelled SIMULATED in the file (source: SIMULATED_CUSTODIAN), the UI
  ("Custodian file: SIMULATED") and the README. In production this is a real feed.

### Debrief verified
- plant-break {amount,VTI} → detected:true (ledger 39.307674 vs custodian
  41.273058, +5%); resolve drops open count; plant {missing,BND} → detected:true.
