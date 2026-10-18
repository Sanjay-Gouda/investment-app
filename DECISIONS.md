## [DAY 1 - INTEGRATIONS]

### KYC Provider Switch
- Decision: Switched from Persona to Stripe Identity
- Reason: Persona requires business email for signup.
  Stripe Identity works with personal email and has
  free sandbox with no approval needed.
- Alternative considered: Persona KYB, Sumsub
- Impact: None on grading — both are valid providers

### Plaid Use Case
- Decision: Selected "Banking and brokerage" use case
- Reason: Closest match to investment app where users
  link bank accounts to fund brokerage accounts
- Environment: Sandbox only — no real bank data

### Alpaca Paper Trading
- Decision: Using paper trading environment only
- Base URL: https://paper-api.alpaca.markets/v2
- Reason: Trial rules require sandbox only
  No real money involved at any point

### Deployment Platform
- Decision: Railway.app
- Reason: Supports PostgreSQL + Redis + Node.js
  in one platform, free tier sufficient for trial,
  fastest path to live URL
- Alternative considered: Render, Fly.io, Vercel

---

## [DAY 1 - ARCHITECTURE]

### Custodian File
- Decision: Build simulator, label as SIMULATED
- Reason: No real custodian sandbox available
  for self-serve signup in 48 hours
- What it does: Generates positions, cash, 
  transactions file. Also generates late dividends
  and corrected prices for restatement testing
- Label in README: SIMULATED

### Webhook Idempotency
- Decision: Store processed event IDs in Redis
  with 24h expiry
- Reason: Corgi explicitly tests webhook replay.
  Same fill event replayed twice must not create
  duplicate ledger entries
- Implementation: Check Redis before processing,
  store after processing

### Settlement Timing (Sandbox)
- Decision: T+1 simulated as 10 seconds in sandbox
- Reason: Cannot wait 24 hours in a 48h trial
- Production would be: 86400000ms (24 hours)
- Noted in code with TODO comment

---

## [DAY 2 - DOMAIN DECISIONS]

### TWR Implementation
- Decision: Time-Weighted Return over Money-Weighted
- Reason: TWR is industry standard for investment
  reporting. Isolates portfolio performance from
  client cash flows. A deposit is not a return.
  MWR would inflate returns when clients add money.
- Reference: CFA Institute performance standards

### Tax Lot Method
- Decision: FIFO (First In, First Out)
- Reason: Simplest to implement correctly.
  Deterministic behavior. Defensible under US tax law.
  Specific-ID would require customer input per trade.
- Week 2: Add specific-ID selection option

### Restatement Design
- Decision: Bitemporal model
  valuationDate = when market close happened
  bookingDate = when we recorded/learned about it
- Reason: Allows querying "what did we believe on
  date X" vs "what do we know now"
- Implementation: Never update original rows.
  Always create new rows with isRestated: true

### Pro-Rata Rounding
- Decision: Last lot in trade eats the rounding penny
- Reason: Must be deterministic. Spreading across
  lots adds complexity with no user benefit.
  Consistent with industry practice.

### Commission Calculation
- Decision: Not implemented in Track 2
- Reason: Track 2 is investment app, not insurance.
  Commission applies to Track 1 (policy admin).
  Alpaca charges zero commission on paper trades.

---

## [DAY 2 - CUTS AND SCOPE]

### What Was Cut (v1 scope)

#### Recurring Deposits
- Cut: Standing deposit instructions
- Reason: Core money flow works end to end.
  Recurring adds scheduling complexity.
- Week 2: Add recurring deposit with BullMQ cron

#### Tax Report PDF
- Cut: Downloadable tax report
- Reason: Tax lot accounting is implemented.
  PDF generation would take 3-4 hours.
  Data is available via CSV export.
- Week 2: Add PDF with Documenso

#### Withdrawal Flow
- Cut: Money-out path
- Reason: Money-in path demonstrates the rails.
  Withdrawal is the reverse with same ledger logic.
- Week 2: Add withdrawal with ACH return handling

#### Model Portfolio Versioning
- Cut: Changing model weights over time
- Reason: Current model is fixed weights.
  Versioning adds schema complexity.
- Week 2: Add portfolio version history

#### Adviser API Keys
- Cut: Per-adviser API keys with rate limits
- Reason: Single JWT auth sufficient for demo.
- Week 2: Add API key management with audit trail

#### Mobile App
- Cut: React Native mobile app
- Reason: Web app is responsive and works on mobile.
  48 hours not sufficient for native app + domain logic.
- Week 2: React Native wrapper

#### E-Signature on Documents
- Cut: Documenso e-sign integration
- Reason: No documents generated in investment app.
  Applies more to Track 1 (insurance policies).

#### USDC/Stablecoin Rail
- Cut: Circle/Bridge testnet integration
- Reason: Core ACH rail works end to end.
  Stablecoin is stretch goal.
- Week 2: Add USDC deposit via Circle testnet

---

## [ASSUMPTIONS MADE]

### Alpaca Fill Timing
- Assumption: Market may be closed during demo
- Action: Built simulate-fill endpoint as fallback
- Note: Real fills work during market hours
  (9:30am - 4:00pm ET, Monday-Friday)

### Custodian File Format
- Assumption: JSON format (not CSV/FTP)
- Reason: No real custodian to match format to
- Production: Would match actual custodian spec

### Portfolio Rebalancing Threshold
- Assumption: 5% drift triggers rebalance
- Stored as: REBALANCE_DRIFT_THRESHOLD_PCT=5
- Configurable via environment variable

### Trade Approval Threshold
- Assumption: Trades above $10,000 need approval
- Stored as: TRADE_APPROVAL_THRESHOLD_CENTS=1000000
- Configurable via environment variable

### State Tax Rate
- Assumption: Not implemented
- Reason: Track 2 is investing, not insurance.
  State premium tax applies to Track 1.
  Investment taxes handled at tax report time.

---

## [WHAT WEEK 2 WOULD LOOK LIKE]

### Week 2 Priority List (in order):

1. Withdrawal flow (money-out path)
2. Recurring deposits with BullMQ
3. Tax report PDF (Documenso)
4. USDC deposits on Circle testnet
5. Model portfolio versioning
6. Adviser API keys + rate limits
7. Performance fee accrual
8. Mobile app (React Native)
9. Real custodian file integration
10. Multi-account per user

### Infrastructure Week 2:
- Add database read replicas
- Add proper logging (Datadog)
- Add error monitoring (Sentry)
- Add rate limiting on all routes
- Add proper secrets management (Vault)