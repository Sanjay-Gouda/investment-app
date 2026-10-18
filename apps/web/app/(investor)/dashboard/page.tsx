'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { apiClient } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';

interface Position {
  symbol: string;
  units: string;
  currentPriceCents: string;
  currentValueCents: string;
  unrealizedGainPct: string;
}
interface Order {
  id: string;
  symbol: string;
  side: string;
  status: string;
  filledAvgPriceCents: string | null;
}
interface MyPortfolio {
  portfolioType: string | null;
  positions: Position[];
  cashBalanceCents: string;
  totalValueCents: string;
  orders: Order[];
}
interface Valuation {
  valuationDate: string;
}
interface HistoryPoint {
  date: string;
  totalValueCents: number;
}
interface TWRResult {
  twrPct: string;
  twrDisplay: string;
}
interface TWRPeriods {
  sinceInception: TWRResult | null;
  oneMonth: TWRResult | null;
  oneWeek: TWRResult | null;
  today: TWRResult | null;
}

const usd = (cents: string | number) =>
  `$${(Number(cents) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pctOf = (part: string | number, whole: string | number) => {
  const w = Number(whole);
  return w > 0 ? `${((Number(part) / w) * 100).toFixed(1)}%` : '—';
};

export default function DashboardPage() {
  const router = useRouter();
  const { user, loading, isAuthenticated, logout } = useAuth();
  const [data, setData] = useState<MyPortfolio | null>(null);
  const [pendingCents, setPendingCents] = useState('0');
  const [asOf, setAsOf] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryPoint[]>([]);
  const [twr, setTwr] = useState<TWRPeriods | null>(null);
  const [restatement, setRestatement] = useState<{
    valuationDate: string;
    original: { twrPct: string | null };
    corrected: { twrPct: string };
  } | null>(null);

  useEffect(() => {
    if (!loading && !isAuthenticated) router.replace('/login');
  }, [loading, isAuthenticated, router]);

  useEffect(() => {
    if (!isAuthenticated) return;
    apiClient
      .get('/portfolio/my')
      .then(({ data }) => setData(data))
      .catch(() => setData({ portfolioType: null, positions: [], cashBalanceCents: '0', totalValueCents: '0', orders: [] }));
    apiClient.get('/plaid/balance').then(({ data }) => setPendingCents(data.pendingDepositsCents)).catch(() => setPendingCents('0'));
    apiClient.get('/valuation/latest').then(({ data }) => setAsOf(data.valuation?.valuationDate ?? null)).catch(() => {});
    apiClient
      .get('/valuation/history?days=30')
      .then(({ data }) => setHistory(data.valuations ?? []))
      .catch(() => setHistory([]));
    apiClient.get('/twr/current').then(({ data }) => setTwr(data)).catch(() => setTwr(null));
    apiClient
      .get('/restatement/history')
      .then(({ data }) => setRestatement(data.restatements?.[0] ?? null))
      .catch(() => setRestatement(null));
  }, [isAuthenticated]);

  if (loading || !data) return <Centered>Loading…</Centered>;

  const cash = data.cashBalanceCents;
  const total = data.totalValueCents;
  const invested = String(Number(total) - Number(cash));
  const anyStale = data.positions.some((p) => p.currentPriceCents === '0');

  const fmtPct = (p: string | null) => (p == null ? '—' : `${(Number(p) * 100).toFixed(2)}%`);

  return (
    <main className="mx-auto min-h-screen max-w-3xl px-6 py-10">
      {restatement && (
        <div className="mb-6 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm">
          <p className="font-medium text-amber-900">⚠️ Your returns were recently restated</p>
          <p className="mt-1 text-amber-800">
            A price correction was applied to {new Date(restatement.valuationDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}. Your corrected return is{' '}
            {fmtPct(restatement.corrected.twrPct)} (was {fmtPct(restatement.original.twrPct)}).{' '}
            <Link href="/restatements" className="font-medium underline">
              View details →
            </Link>
          </p>
        </div>
      )}

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Portfolio Overview</h1>
          <p className="mt-1 text-sm text-neutral-600">
            {user?.fullName ?? user?.email}
            {data.portfolioType ? ` · ${data.portfolioType}` : ''}
          </p>
        </div>
        <button onClick={logout} className="rounded-md border px-3 py-1.5 text-sm hover:bg-neutral-50">
          Log out
        </button>
      </div>

      <div className="mt-6 rounded-lg border p-5">
        <p className="text-xs text-neutral-500">Total Portfolio Value</p>
        <p className="text-3xl font-semibold">{usd(total)}</p>
        <p className="mt-1 text-xs text-neutral-500">
          {asOf ? `As of ${new Date(asOf).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} · market close` : 'Live estimate'}
          {anyStale && ' · ⚠️ some prices delayed'}
        </p>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-4">
        <Stat label="Cash" value={usd(cash)} sub={pctOf(cash, total)} />
        <Stat label="Invested" value={usd(invested)} sub={pctOf(invested, total)} />
        <Stat label="Pending" value={usd(pendingCents)} />
      </div>

      {twr && <ReturnsCard twr={twr} />}

      <Sparkline points={history} />

      <h2 className="mt-8 text-lg font-semibold">Positions</h2>
      {data.positions.length === 0 ? (
        <p className="mt-2 text-sm text-neutral-500">
          No positions yet. <Link href="/portfolio" className="text-corgi hover:underline">Pick a portfolio</Link>.
        </p>
      ) : (
        <table className="mt-3 w-full text-sm">
          <thead>
            <tr className="border-b text-left text-neutral-500">
              <th className="py-1">Symbol</th>
              <th>Units</th>
              <th>Price</th>
              <th>Value</th>
              <th>Gain</th>
            </tr>
          </thead>
          <tbody>
            {data.positions.map((p) => (
              <tr key={p.symbol} className="border-b">
                <td className="py-2 font-medium">
                  {p.symbol} {p.currentPriceCents === '0' && <span title="price delayed/missing">⚠️</span>}
                </td>
                <td>{Number(p.units).toFixed(6)}</td>
                <td>{usd(p.currentPriceCents)}</td>
                <td>{usd(p.currentValueCents)}</td>
                <td className={Number(p.unrealizedGainPct) >= 0 ? 'text-green-700' : 'text-red-700'}>
                  {Number(p.unrealizedGainPct) >= 0 ? '+' : ''}
                  {p.unrealizedGainPct}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <p className="mt-4 text-xs text-neutral-400">
        Prices via Alpaca IEX feed and may be delayed. Values are end-of-day snapshots.
      </p>

      <div className="mt-6 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Recent orders</h2>
        <Link href="/orders" className="text-sm text-corgi hover:underline">View all</Link>
      </div>
      <table className="mt-3 w-full text-sm">
        <tbody>
          {data.orders.slice(0, 5).map((o) => (
            <tr key={o.id} className="border-b">
              <td className="py-2">{o.side} {o.symbol}</td>
              <td>{o.status}</td>
              <td>{o.filledAvgPriceCents ? usd(o.filledAvgPriceCents) : '—'}</td>
            </tr>
          ))}
          {data.orders.length === 0 && <tr><td className="py-2 text-neutral-500">No orders yet.</td></tr>}
        </tbody>
      </table>

      <div className="mt-8 flex gap-3 text-sm">
        <Link href="/deposit" className="rounded-md border px-4 py-2 hover:bg-neutral-50">Deposit</Link>
        <Link href="/portfolio" className="rounded-md bg-corgi px-4 py-2 font-medium text-white hover:bg-corgi/90">Invest</Link>
      </div>
    </main>
  );
}

function ReturnRow({ label, r }: { label: string; r: TWRResult | null }) {
  if (!r) return null;
  const positive = Number(r.twrPct) >= 0;
  const zero = Number(r.twrPct) === 0;
  const color = zero ? 'text-neutral-500' : positive ? 'text-green-700' : 'text-red-700';
  return (
    <div className="flex items-center justify-between py-1 text-sm">
      <span className="text-neutral-600">{label}</span>
      <span className={`font-medium ${color}`}>
        {r.twrDisplay} {zero ? '' : positive ? '↑' : '↓'}
      </span>
    </div>
  );
}

function ReturnsCard({ twr }: { twr: TWRPeriods }) {
  return (
    <div className="mt-4 rounded-lg border p-5">
      <div className="flex items-center gap-1">
        <h2 className="text-sm font-semibold">Returns (Time-Weighted)</h2>
        <span
          title="Time-weighted return measures investment performance excluding the effect of deposits and withdrawals. It shows how your chosen portfolio performed, not how much money you made."
          className="cursor-help text-xs text-neutral-400"
        >
          ⓘ
        </span>
      </div>
      <div className="mt-2">
        <ReturnRow label="Since Inception" r={twr.sinceInception} />
        <ReturnRow label="This Month" r={twr.oneMonth} />
        <ReturnRow label="This Week" r={twr.oneWeek} />
        <ReturnRow label="Today" r={twr.today} />
      </div>
      <p className="mt-2 text-[10px] text-neutral-400">Deposits &amp; withdrawals are excluded from these figures.</p>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border p-4">
      <p className="text-xs text-neutral-500">{label}</p>
      <p className="mt-1 text-lg font-medium">{value}</p>
      {sub && <p className="text-xs text-neutral-400">{sub}</p>}
    </div>
  );
}

/** Minimal inline-SVG line of daily total values (last 30 days). */
function Sparkline({ points }: { points: HistoryPoint[] }) {
  if (points.length < 2) return null;
  const vals = points.map((p) => p.totalValueCents);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const range = max - min || 1;
  const W = 600;
  const H = 60;
  const d = points
    .map((p, i) => {
      const x = (i / (points.length - 1)) * W;
      const y = H - ((p.totalValueCents - min) / range) * H;
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <div className="mt-6">
      <p className="mb-1 text-xs text-neutral-500">Value history (last {points.length} days)</p>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="none" role="img" aria-label="Value history">
        <path d={d} fill="none" stroke="#E8822A" strokeWidth="2" vectorEffect="non-scaling-stroke" />
      </svg>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <main className="flex min-h-screen items-center justify-center text-sm text-neutral-600">{children}</main>;
}
