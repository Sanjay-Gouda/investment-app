/**
 * Shared API contract types — INLINED into apps/api for standalone deployment.
 *
 * Railway (and most single-service deploys) build only apps/api, so a workspace
 * dependency on @corgi/shared can't be resolved. These types are copied here and
 * kept in sync with packages/shared/src/types/index.ts (the web app's copy).
 *
 * Framework-agnostic — must NOT import from Prisma, Express, or React.
 *
 * Money convention (see DECISIONS.md):
 *   - USD amounts are integer minor units (cents), serialized as strings over
 *     JSON (source is BigInt, may exceed Number.MAX_SAFE_INTEGER).
 *   - Share units / decimals are serialized as strings to preserve precision.
 */

// ---------------------------------------------------------------------------
// Domain enums (mirror apps/api/prisma/schema.prisma)
// ---------------------------------------------------------------------------

export type Role = 'INVESTOR' | 'ADVISER';

export type KycStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export type AccountStatus = 'INACTIVE' | 'ACTIVE' | 'SUSPENDED';

export type EntryType =
  | 'CASH_DEPOSIT'
  | 'CASH_DEPOSIT_RETURN'
  | 'CASH_WITHDRAWAL'
  | 'TRADE_BUY_CASH'
  | 'TRADE_BUY_UNITS'
  | 'TRADE_SELL_CASH'
  | 'TRADE_SELL_UNITS'
  | 'DIVIDEND_CASH'
  | 'FEE'
  | 'CORRECTION_REVERSAL'
  | 'CORRECTION_REBOOK';

export type OrderSide = 'BUY' | 'SELL';

export type OrderType = 'MARKET' | 'LIMIT';

export type OrderStatus =
  | 'PENDING'
  | 'SUBMITTED'
  | 'PARTIALLY_FILLED'
  | 'FILLED'
  | 'CANCELLED'
  | 'REJECTED';

export type BreakType =
  | 'MISSING_IN_LEDGER'
  | 'MISSING_IN_CUSTODIAN'
  | 'AMOUNT_MISMATCH'
  | 'PRICE_MISMATCH';

export type BreakStatus = 'OPEN' | 'RESOLVED' | 'IGNORED';

export type ApprovalType = 'TRADE' | 'WITHDRAWAL' | 'REBALANCE';

export type ApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

// ---------------------------------------------------------------------------
// Transport primitives
// ---------------------------------------------------------------------------

/** Integer money in cents, serialized as a string (source is BigInt). */
export type Cents = string;

/** A fixed-precision decimal (e.g. share units), serialized as a string. */
export type DecimalString = string;

/** ISO-8601 timestamp string. */
export type IsoDate = string;

// ---------------------------------------------------------------------------
// API envelope
// ---------------------------------------------------------------------------

export interface ApiError {
  code: string;
  message: string;
  details?: unknown;
}

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: ApiError };

export interface HealthResponse {
  status: 'ok';
  timestamp: IsoDate;
}

// ---------------------------------------------------------------------------
// Core resource DTOs (shapes returned over the API)
// ---------------------------------------------------------------------------

export interface UserDto {
  id: string;
  email: string;
  role: Role;
  createdAt: IsoDate;
}

export interface AccountDto {
  id: string;
  userId: string;
  kycStatus: KycStatus;
  status: AccountStatus;
  createdAt: IsoDate;
  updatedAt: IsoDate;
}

export interface PositionDto {
  id: string;
  accountId: string;
  symbol: string;
  units: DecimalString;
  updatedAt: IsoDate;
}

export interface LedgerEntryDto {
  id: string;
  accountId: string;
  type: EntryType;
  amount: Cents;
  currency: string;
  assetSymbol?: string | null;
  units?: DecimalString | null;
  description: string;
  referenceId?: string | null;
  referenceType?: string | null;
  effectiveDate: IsoDate;
  bookingDate: IsoDate;
  createdAt: IsoDate;
}

export interface OrderDto {
  id: string;
  accountId: string;
  symbol: string;
  side: OrderSide;
  type: OrderType;
  status: OrderStatus;
  requestedUnits?: DecimalString | null;
  filledUnits?: DecimalString | null;
  filledAvgPriceCents?: Cents | null;
  submittedAt: IsoDate;
  filledAt?: IsoDate | null;
}

export interface ValuationDto {
  id: string;
  accountId: string;
  valuationDate: IsoDate;
  totalValueCents: Cents;
  cashCents: Cents;
  investedValueCents: Cents;
  returnPct: DecimalString;
  twrPct: DecimalString;
  isRestated: boolean;
}

export interface ReconciliationBreakDto {
  id: string;
  breakDate: IsoDate;
  symbol?: string | null;
  breakType: BreakType;
  ledgerValue?: DecimalString | null;
  custodianValue?: DecimalString | null;
  difference?: DecimalString | null;
  status: BreakStatus;
  agingDays: number;
  createdAt: IsoDate;
}

export interface ApprovalQueueDto {
  id: string;
  initiatorId: string;
  type: ApprovalType;
  payload: unknown;
  status: ApprovalStatus;
  approverId?: string | null;
  createdAt: IsoDate;
  updatedAt: IsoDate;
}

// ---------------------------------------------------------------------------
// Auth payloads (shapes only)
// ---------------------------------------------------------------------------

export interface LoginRequest {
  email: string;
  password: string;
}

export interface RegisterRequest {
  email: string;
  password: string;
  role?: Role;
}

export interface AuthResponse {
  token: string;
  user: UserDto;
}
