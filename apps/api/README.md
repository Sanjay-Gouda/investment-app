# @corgi/api

Backend for the Corgi Investment App (Track 2): Express + TypeScript, PostgreSQL
via Prisma, BullMQ/Redis jobs, and an MCP agent surface.

See the [root README](../../README.md) for the product overview and the
10 non-negotiables, and [DECISIONS.md](../../DECISIONS.md) for architecture.

## Run

```bash
# from the repo root
npm run db:generate -w @corgi/api   # prisma generate
npm run db:migrate  -w @corgi/api   # prisma migrate dev (applies migrations)
npm run db:seed     -w @corgi/api   # demo data
npm run dev         -w @corgi/api   # nodemon + ts-node on :4000
```

Prisma commands are wrapped with `dotenv-cli` to load the repo-root `.env`
(`DATABASE_URL`, `REDIS_URL`, JWT + provider keys).

## Scripts
| Script | Does |
| ------ | ---- |
| `dev` | nodemon + ts-node (`src/index.ts`) on `:4000` |
| `build` | `prisma generate` + `tsc` → `dist/` (incl. `dist/mcp/server.js`) |
| `start` | `node dist/index.js` |
| `test` | Jest against an isolated `corgi_investment_test` DB |
| `db:generate` / `db:migrate` / `db:seed` / `db:reset` | Prisma lifecycle |

## Architecture notes
- **Ledger** (`src/services/ledger.service.ts`) — append-only double-entry.
  Corrections are reversal + rebook rows; a Postgres trigger (migration
  `ledger_append_only`) blocks UPDATE/DELETE on `LedgerEntry`.
- **Counter-account buckets** — ledger legs carry `metadata.bucket`
  (`SETTLED_CASH` / `IN_TRANSIT` / `EXTERNAL` / `INVESTED`) so balanced,
  zero-sum journals still move the right balance. "Cash balance" sums the
  non-counter buckets.
- **Money** — BigInt cents; **units** — `Decimal(20,6)`. Never mixed; Decimal.js
  for the one multiply, converted to BigInt at the end.
- **Valuation / TWR** — daily snapshots (BullMQ, 4pm ET); TWR chains per-day
  sub-period returns and excludes cash flows (`src/services/twr.service.ts`).
- **Restatement** — bitemporal: a correction adds new rows (same `valuationDate`,
  new `bookingDate`); originals are never mutated. "Effective" = latest booking
  per date.
- **Reconciliation** — ledger vs a SIMULATED custodian file → breaks with aging
  (BullMQ, 6am ET).
- **Background workers** started in `src/index.ts`: ACH settlement, order
  polling, daily valuation, reconciliation.

## API reference

### Auth
- `POST /auth/register` `{ email, password, fullName }` → `{ token, user, account }`
- `POST /auth/login` `{ email, password }` → `{ token, user, account }`
- `GET /auth/me` (auth) → `{ user, account }`

### KYC (Stripe Identity)
- `POST /kyc/start` (auth) → `{ clientSecret, sessionId }`
- `GET /kyc/status` (auth) → `{ kycStatus, accountStatus, canTransact }`
- `POST /kyc/webhook` — raw body, signature-verified
- `POST /kyc/simulate-approve` (auth, sandbox)

### Bank + deposits (Plaid)
- `POST /plaid/link-token` · `POST /plaid/exchange-token` · `GET /plaid/bank-details`
- `POST /plaid/deposit` `{ amountCents }` · `GET /plaid/deposits` · `GET /plaid/balance`
- `POST /plaid/webhook` — raw body

### Ledger (append-only)
- `GET /ledger/balance` · `GET /ledger/position/:symbol` · `GET /ledger/history` · `GET /ledger/statement`
- `POST /ledger/correction` (adviser) — reversal + rebook
- `PUT/PATCH/DELETE /ledger/*` → **405** (immutable)

### Portfolio / orders (Alpaca)
- `GET /portfolio/models` (public) · `GET /portfolio/my` · `GET /portfolio/positions` · `GET /portfolio/orders`
- `POST /portfolio/invest` (auth + KYC) — places orders, or routes to approval if over `TRADE_APPROVAL_THRESHOLD_CENTS`
- `POST /alpaca/webhook` (raw) · `GET /alpaca/price/:symbol`

### Valuation + TWR
- `GET /valuation/latest` · `GET /valuation/history` · `GET /valuation/as-of/:date` · `GET /valuation/portfolio-value`
- `POST /valuation/run` (adviser)
- `GET /twr/current` · `GET /twr/since-inception` · `GET /twr/range` · `GET /twr/sub-periods`

### Restatement (bitemporal)
- `POST /restatement/correct-price` (adviser)
- `GET /restatement/history` · `GET /restatement/valuation-as-published` · `GET /restatement/valuation-current`

### Reconciliation (adviser only)
- `GET /reconciliation/breaks` · `GET /reconciliation/breaks/:id` · `GET /reconciliation/summary` · `GET /reconciliation/history`
- `POST /reconciliation/run` · `POST /reconciliation/breaks/:id/resolve`

### Adviser console (adviser only)
- `GET /adviser/overview` · `GET /adviser/accounts` · `GET /adviser/approvals`
- `POST /adviser/approvals/:id/approve` (no self-approval) · `POST /adviser/approvals/:id/reject`

### MCP (agent surface)
- `GET /mcp/tools` — manifest
- `POST /mcp/tools/get_account_balance` · `.../get_portfolio_positions` · `.../get_reconciliation_breaks` · `.../initiate_rebalance`
- stdio server: `node dist/mcp/server.js`
- Restrictions: [`src/mcp/AGENT_RESTRICTIONS.md`](src/mcp/AGENT_RESTRICTIONS.md)

## Dev/demo test endpoints
Disabled in production unless `ENABLE_SIMULATE=true`. Prefixed `/test/*`:
- **DB/ledger:** `GET /test/db`, `GET /test/ledger`, `POST /test/ledger/journal`, `GET /test/ledger/balance`, `GET /test/ledger/correction-test`
- **Auth/KYC:** `POST /test/auth/register|login`, `POST /test/kyc/simulate-approve`, `GET /test/kyc/status`
- **Plaid:** `POST /test/plaid/simulate-link|deposit|settle|bounce`, `GET /test/plaid/balance`
- **Alpaca:** `POST /test/alpaca/submit-portfolio|simulate-fill|check-fills`, `GET /test/alpaca/orders|positions`
- **Valuation:** `POST /test/valuation/run|fetch-prices|simulate-day`, `GET /test/valuation/latest|history|prices`
- **TWR:** `GET /test/twr/calculate|verify-deposit-excluded`, `POST /test/twr/simulate-performance`
- **Restatement:** `POST /test/restatement/run-full-test|simulate-late-dividend`, `GET /test/restatement/as-published|as-restated|history`
- **Reconciliation:** `POST /test/reconciliation/generate-file|plant-break|run`, `GET /test/reconciliation/breaks|summary`, `POST /test/reconciliation/resolve/:id`
- **Adviser/MCP:** `POST /test/adviser/seed-approval`, `GET /test/mcp/tools`, `POST /test/mcp/get-balance|get-positions|get-breaks|initiate-rebalance|verify-maker-checker`

## Tests
```bash
npm test -w @corgi/api
```
Jest runs serially against an isolated `corgi_investment_test` database (created
+ migrated in `src/tests/global-setup.ts`). Covers the append-only ledger
(immutability, balances, corrections) and the TWR math (chaining + deposit
exclusion, incl. the 7.625% scenario).
