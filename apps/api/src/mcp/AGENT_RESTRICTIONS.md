# MCP Agent Restrictions

The Corgi MCP server exposes a deliberately small surface: three read tools the
agent may call freely, and one write tool (`initiate_rebalance`) that only ever
creates a **pending human approval** — it never executes. Everything below is
something the agent **can never do**, by design.

## Operations This Agent Can NEVER Perform

### 1. Direct Trade Execution
The agent cannot place, modify or cancel orders directly. All trades must go
through the human approval queue. **Reason:** financial transactions require
human oversight; an agent executing trades autonomously could cause significant
financial harm.

### 2. Ledger Corrections
The agent cannot create correction or reversal entries in the ledger.
**Reason:** ledger corrections affect financial history and audit trails and
require human review and authorization.

### 3. KYC Approval or Rejection
The agent cannot approve or reject identity verification. **Reason:** KYC
decisions are regulated activities; incorrect approvals create legal and
compliance liability.

### 4. Approve Its Own Requests
The agent cannot approve any action it initiated. **Reason:** this enforces the
maker-checker principle — no single entity should initiate AND approve a
financial action.

### 5. Tax Lot Selection
The agent cannot choose which tax lots to use when selling. **Reason:** tax lot
selection has direct tax implications for the customer and requires human
judgment and customer consent.

### 6. Access Other Users' Data
The agent can only access data for accounts it is explicitly authorized for.
**Reason:** privacy and data security; cross-account access is never permitted.

### 7. Override Reconciliation Breaks
The agent cannot resolve or ignore reconciliation breaks. **Reason:** breaks
require human investigation; auto-resolving could hide real discrepancies.

### 8. Modify Account Settings
The agent cannot change portfolio type, KYC status, account status or user
details. **Reason:** account changes require verified human authorization.

### 9. Initiate Withdrawals
The agent cannot initiate money-out transactions. **Reason:** withdrawals move
real money and require explicit customer authorization.

### 10. Access Raw Ledger Entries
The agent cannot query or modify ledger entries directly. It can only access
summarized balances through the approved read tools. **Reason:** raw ledger
access could expose sensitive financial data, and the append-only guarantee
must be preserved.

## How this is enforced
- The MCP server only registers four tools; nothing else is reachable.
- `initiate_rebalance` writes a `PENDING` `ApprovalQueue` row and returns a
  warning — it calls no execution path.
- Approval happens on a separate, adviser-only, authenticated route
  (`POST /adviser/approvals/:id/approve`) which rejects self-approval.
