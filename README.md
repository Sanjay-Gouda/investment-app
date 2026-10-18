# Corgi Investment App

**Track 2 — Investment App** · Corgi 48-hour work trial.

A monorepo skeleton for a managed-investment platform: investors open an
account, pass KYC, deposit cash, and hold a portfolio of positions; advisers
review accounts, approve large trades, and reconcile the internal ledger
against the custodian. This commit is the **skeleton only** — structure,
schema, and a running dev environment. No auth, business logic, or external
API calls yet.

## Stack

| Layer      | Technology                                   |
| ---------- | -------------------------------------------- |
| Frontend   | Next.js (App Router) + TypeScript + Tailwind |
| Backend    | Node.js + Express + TypeScript               |
| Database   | PostgreSQL + Prisma ORM                       |
| Job Queue  | BullMQ + Redis                               |
| Validation | Zod                                          |

> **Next.js version:** the project targets Next.js 14+. We pin Next 15 so that
> `next.config.ts` (a TypeScript config, required by the project layout) is
> supported natively. See [DECISIONS.md](./DECISIONS.md).

## Repository layout

```
corgi-investment/
├── apps/
│   ├── web/      # Next.js frontend
│   └── api/      # Express backend + Prisma + BullMQ
└── packages/
    └── shared/   # Shared TypeScript types (FE <-> BE)
```

## Prerequisites

- Node.js >= 20
- PostgreSQL running locally (or a reachable `DATABASE_URL`)
- Redis running locally (or a reachable `REDIS_URL`)

Quick local infra with Docker (optional):

```bash
docker run -d --name corgi-pg -e POSTGRES_USER=user -e POSTGRES_PASSWORD=password -e POSTGRES_DB=corgi_investment -p 5432:5432 postgres:16
docker run -d --name corgi-redis -p 6379:6379 redis:7
```

## Run locally

```bash
# 1. Install all workspaces from the repo root
npm install

# 2. Create your env file and fill in values
cp .env.example .env

# 3. Generate the Prisma client
npm run db:generate

# 4. Create the database schema (requires a running PostgreSQL)
npm run db:migrate

# 5. (optional) Seed demo data
npm run db:seed

# 6. Start both apps together
npm run dev
```

- Web: http://localhost:3000
- API: http://localhost:4000
- Health check: http://localhost:4000/health → `{ "status": "ok", "timestamp": "..." }`

## Environment variables

All configuration is driven by environment variables. See
[.env.example](./.env.example) for the full list (app, database, Redis, JWT, and
the Persona / Plaid / Alpaca integration credentials). Copy it to `.env` and
fill in the blanks. The `apps/api` process reads `../../.env` (repo root);
`apps/web` reads `NEXT_PUBLIC_API_URL`.

## Demo credentials

> Created by `npm run db:seed`. (Login is wired up when auth lands; the users
> and their data exist in the database now.)

| Role     | Email               | Password     |
| -------- | ------------------- | ------------ |
| Investor | `investor@demo.com` | `demo123456` |
| Adviser  | `adviser@demo.com`  | `demo123456` |

The investor is seeded with an APPROVED/ACTIVE account, a 6-entry ledger
(deposit, two buys, a dividend), VTI + BND positions with tax lots, and 30 days
of market prices for both symbols.

## Integration status

| Integration        | Purpose              | Status       |
| ------------------ | -------------------- | ------------ |
| Stripe Identity    | KYC / identity       | 🟢 Live (sandbox) · dev simulate path |
| Plaid              | Bank linking + ACH deposits | 🟢 Live (sandbox) · dev simulate path |
| Alpaca             | Brokerage / orders + fills | 🟢 Live (paper) · dev simulate-fill path |
| Market data        | Daily close prices (Alpaca IEX) | 🟢 Live |
| Daily valuation    | EOD snapshots + value history | 🟢 Live (BullMQ cron) |
| TWR                | Time-weighted return (Decimal) | 🟢 Live |
| Restatement        | Bitemporal price/valuation corrections | 🟢 Live |
| Reconciliation     | Ledger vs custodian breaks + aging | 🟢 Live |
| UI + route security | Redesign, RouteGuard, adviser console | 🟢 Live |
| Custodian file     | Daily holdings/cash feed | 🔴 **SIMULATED** |
| PostgreSQL ledger  | Double-entry ledger  | 🟢 Live      |
| Auth (JWT + bcrypt)| Login / sessions     | 🟢 Live      |
| Redis / BullMQ     | Background jobs      | 🟢 Live      |

Legend: 🟢 Live = real implementation · 🟡 Simulated = stubbed, returns
deterministic fake data for now.

## Scripts (root)

| Script               | What it does                              |
| -------------------- | ----------------------------------------- |
| `npm run dev`        | Runs web + api concurrently               |
| `npm run build`      | Builds shared, api, and web               |
| `npm run db:migrate` | `prisma migrate dev` (api workspace)      |
| `npm run db:seed`    | `prisma db seed` (api workspace)          |
| `npm run db:generate`| Generates the Prisma client               |
| `npm run typecheck`  | Type-checks all workspaces                |

## MCP Agent Surface

This system exposes an MCP (Model Context Protocol) server so AI agents can
interact with the app through a small, safe surface.

### Tools

**Read tools (no approval required)**
1. `get_account_balance` — total value, cash, invested, pending deposits, TWR (supports `as_of_date`).
2. `get_portfolio_positions` — positions with units, price, market value, unrealized gain/loss.
3. `get_reconciliation_breaks` — ledger↔custodian breaks with aging (filter by status / min age).

**Write tool (human approval required)**
4. `initiate_rebalance` — creates a **PENDING** `ApprovalQueue` entry. It never executes a trade, and the agent **cannot approve its own request** (maker-checker). A human adviser approves at `/adviser/approvals`.

### Running the MCP server
```bash
cd apps/api && npm run build && node dist/mcp/server.js   # stdio transport
```
The same tools are also exposed over HTTP for testing: `GET /mcp/tools` (manifest) and `POST /mcp/tools/<name>`.

### Agent restrictions
See [apps/api/src/mcp/AGENT_RESTRICTIONS.md](apps/api/src/mcp/AGENT_RESTRICTIONS.md) for the full list of operations the agent can **never** perform (direct trade execution, ledger corrections, KYC decisions, approving its own requests, tax-lot selection, cross-account access, overriding breaks, changing account settings, withdrawals, raw ledger access) and the reasoning for each.

### Integration status
**LIVE** — connected to the real database. The one write tool is approval-gated.
