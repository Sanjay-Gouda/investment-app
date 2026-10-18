# Corgi Investment — Track 2

Work trial submission for Corgi. **Track 2: Investment App.**

## Live URLs
- Frontend: https://corgiweb-production.up.railway.app
- API: https://investment-app-production-3fe3.up.railway.app
- Health: https://investment-app-production-3fe3.up.railway.app/health

## Demo Credentials
| Role     | Email               | Password     |
| -------- | ------------------- | ------------ |
| Investor | `investor@demo.com` | `demo123456` |
| Adviser  | `adviser@demo.com`  | `demo123456` |

## What This Is
A retail investment platform for American businesses. Customers deposit money,
buy into model portfolios, and are rebalanced monthly. Every dollar is tracked
in an append-only double-entry ledger.

Core loop:

```
Register → KYC → Link Bank → Deposit → Pick Portfolio →
Orders → Fills → Daily Valuation → Restatement → Reconciliation
```

## Integration Status
| Integration      | Status        | Provider        |
| ---------------- | ------------- | --------------- |
| KYC              | 🟢 LIVE        | Stripe Identity |
| Bank Linking     | 🟢 LIVE        | Plaid Sandbox   |
| Brokerage/Orders | 🟢 LIVE        | Alpaca Paper    |
| Market Data      | 🟢 LIVE        | Alpaca IEX Feed |
| Custodian File   | 🔴 SIMULATED   | Built in-house  |

## Tech Stack
- **Frontend:** Next.js 15 (App Router), TypeScript, Tailwind CSS, Recharts
- **Backend:** Node.js, Express, TypeScript
- **Database:** PostgreSQL with Prisma ORM
- **Queue:** BullMQ + Redis
- **Agent surface:** Model Context Protocol (MCP)
- **Deployment:** Railway.app
- **Monorepo:** npm workspaces (`apps/web`, `apps/api`, `packages/shared`)

> Note: the brief said "Next.js 14+". We pin **Next 15** so `next.config.ts` is
> supported natively. See [DECISIONS.md](./DECISIONS.md).

## How to Run Locally

### Prerequisites
- Node.js 20+
- PostgreSQL 15+
- Redis

Quick infra with Docker (optional):
```bash
docker run -d --name corgi-pg -e POSTGRES_USER=corgi_user -e POSTGRES_PASSWORD=corgi_password -e POSTGRES_DB=corgi_investment -p 5432:5432 postgres:16
docker run -d --name corgi-redis -p 6379:6379 redis:7
```

### Setup
```bash
git clone https://github.com/Sanjay-Gouda/investment-app
cd investment-app

npm install                 # install all workspaces
cp .env.example .env        # fill in keys + local DATABASE_URL / REDIS_URL

npm run db:generate -w @corgi/api   # generate Prisma client
npm run db:migrate  -w @corgi/api   # apply migrations
npm run db:seed     -w @corgi/api   # seed demo data

npm run dev                 # start web + api together
```

- Frontend: http://localhost:3000
- Backend: http://localhost:4000
- DB UI: `cd apps/api && npx prisma studio` (http://localhost:5555)

> The web app reads public env (`NEXT_PUBLIC_*`) from `apps/web/.env.local`.
> The API reads the root `.env` (Prisma scripts are wrapped with `dotenv-cli`).

## The 10 Non-Negotiables — How We Meet Them

1. **DEPLOYED** — Live on Railway (URLs above). Two roles:
   `investor@demo.com` and `adviser@demo.com`.

2. **LEDGER WRITTEN BY US** — Double-entry, append-only, immutable.
   [`apps/api/src/services/ledger.service.ts`](apps/api/src/services/ledger.service.ts).
   Every balance is derived from ledger entries; a DB trigger blocks any
   UPDATE/DELETE on `LedgerEntry` (corrections are reversal + rebook rows).

3. **TWO+ LIVE INTEGRATIONS** — Stripe Identity (KYC), Plaid (bank linking),
   Alpaca (brokerage + market data) are all LIVE. The custodian file is
   SIMULATED and labelled honestly.

4. **WEBHOOKS DONE PROPERLY** — Stripe (signature-verified over the raw body),
   Alpaca (fills, idempotent via Redis + order-status guard), Plaid (deposit
   events). [`apps/api/src/webhooks/`](apps/api/src/webhooks/).

5. **CORRECTION TEST** — A backdated price correction creates a reversal + a
   rebook / restated row (original untouched) and recalculates TWR, bitemporally
   (same `valuationDate`, new `bookingDate`).
   Run: `POST /test/restatement/run-full-test`.

6. **APPROVALS ABOVE THRESHOLD** — Investments above
   `TRADE_APPROVAL_THRESHOLD_CENTS` (default $10,000) route to the human
   approval queue instead of executing; the MCP write tool does the same. The
   initiator can never approve their own request (maker-checker).
   [`apps/api/src/routes/portfolio.routes.ts`](apps/api/src/routes/portfolio.routes.ts),
   [`apps/api/src/routes/adviser.routes.ts`](apps/api/src/routes/adviser.routes.ts).

7. **RECONCILIATION IS A FEATURE** — A morning job diffs our ledger against the
   custodian file; breaks surface on an adviser screen with type + aging.
   Plant one: `POST /test/reconciliation/plant-break`.
   [`apps/api/src/services/reconciliation.service.ts`](apps/api/src/services/reconciliation.service.ts).

8. **MCP AGENT SURFACE** — 3 read tools + 1 approval-gated write tool.
   [`apps/api/src/mcp/server.ts`](apps/api/src/mcp/server.ts),
   restrictions in [`apps/api/src/mcp/AGENT_RESTRICTIONS.md`](apps/api/src/mcp/AGENT_RESTRICTIONS.md).
   Test: `GET /test/mcp/tools`.

9. **MONEY IS NEVER A FLOAT** — USD as BigInt cents; units as Decimal(20,6).
   Decimal.js (via `Prisma.Decimal`) for all math; the last lot eats the
   rounding penny. Units and money are never mixed.

10. **DECISION LOG** — [DECISIONS.md](./DECISIONS.md), timestamped throughout
    the build — not written at hour 47.

## Key API Endpoints

**Auth** — `POST /auth/register` · `POST /auth/login` · `GET /auth/me`
**KYC** — `POST /kyc/start` · `GET /kyc/status` · `POST /kyc/webhook` (Stripe)
**Bank + Deposits** — `POST /plaid/link-token` · `POST /plaid/exchange-token` · `POST /plaid/deposit` · `GET /plaid/deposits`
**Portfolio** — `GET /portfolio/models` · `POST /portfolio/invest` · `GET /portfolio/positions`
**Ledger** — `GET /ledger/balance` · `GET /ledger/statement` · `POST /ledger/correction` (adviser)
**Valuation + Returns** — `GET /valuation/latest` · `GET /valuation/history` · `GET /twr/current` · `GET /twr/since-inception`
**Restatement** — `POST /restatement/correct-price` (adviser) · `GET /restatement/history`
**Reconciliation** — `GET /reconciliation/breaks` · `POST /reconciliation/run` · `POST /reconciliation/breaks/:id/resolve` (adviser)
**Adviser** — `GET /adviser/overview` · `GET /adviser/accounts` · `GET /adviser/approvals` · `POST /adviser/approvals/:id/approve`
**MCP** — `GET /mcp/tools` · `POST /mcp/tools/get_account_balance` · `.../get_portfolio_positions` · `.../get_reconciliation_breaks` · `.../initiate_rebalance`

See [apps/api/README.md](apps/api/README.md) for the full API + test-endpoint reference.

## Money Handling
- Currency: USD only, stored as **BigInt cents** (integer minor units).
- Units: **Decimal(20,6)** — never mixed with money.
- Rounding rule: the last lot in a trade eats the penny.
- No floating point: Decimal.js for all unit/return math.

## Running Tests
```bash
npm test -w @corgi/api   # Jest, against an isolated corgi_investment_test DB
```

## Seed Script
```bash
npm run db:seed -w @corgi/api
```
Creates: 2 users (investor + adviser), a KYC-approved/active account, 6 ledger
entries (deposit, two buys, dividend), VTI + BND positions with tax lots, 30
days of market prices, **one planted reconciliation break**, and **one pending
approval**.

## MCP Agent Surface
```bash
cd apps/api && npm run build && node dist/mcp/server.js   # stdio transport
```
Also exposed over HTTP for testing: `GET /mcp/tools`, `POST /mcp/tools/<name>`.
See [apps/api/src/mcp/AGENT_RESTRICTIONS.md](apps/api/src/mcp/AGENT_RESTRICTIONS.md).

## Environment Variables
See [.env.example](./.env.example) for all required keys. Never commit `.env`;
all secrets are managed via Railway environment variables.

## Architecture & Decisions
See [DECISIONS.md](./DECISIONS.md) for every architectural decision, assumption,
and trade-off, logged as the build progressed.
