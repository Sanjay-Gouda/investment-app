'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { apiClient } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { RouteGuard } from '@/components/shared/RouteGuard';
import { AppShell } from '@/components/shared/Shell';
import { ReturnBadge, usd } from '@/components/shared/ui';

interface Position {
  symbol: string;
  units: string;
  currentPriceCents: string;
  currentValueCents: string;
  costBasisCents: string;
  unrealizedGainCents: string;
  unrealizedGainPct: string;
}
interface Order {
  id: string;
  symbol: string;
  side: string;
  status: string;
  filledUnits: string | null;
  filledAvgPriceCents: string | null;
  createdAt: string;
}
interface MyPortfolio {
  portfolioType: string | null;
  positions: Position[];
  cashBalanceCents: string;
  totalValueCents: string;
  orders: Order[];
}
interface TWR {
  twrPct: string;
  twrDisplay: string;
}
interface TWRPeriods {
  sinceInception: TWR | null;
  oneMonth: TWR | null;
  oneWeek: TWR | null;
  today: TWR | null;
}
interface HistPoint {
  date: string;
  totalValueCents: number;
}

function DashboardContent() {
  const { user, isAdviser } = useAuth();
  const router = useRouter();
  const [data, setData] = useState<MyPortfolio | null>(null);
  const [pending, setPending] = useState('0');
  const [twr, setTwr] = useState<TWRPeriods | null>(null);
  const [history, setHistory] = useState<HistPoint[]>([]);
  const [restatement, setRestatement] = useState<{ valuationDate: string; original: { twrPct: string | null }; corrected: { twrPct: string } } | null>(null);
  const [range, setRange] = useState<'1W' | '1M' | 'All'>('1M');
  const [dismissed, setDismissed] = useState(false);

  // Advisers use the console.
  useEffect(() => {
    if (isAdviser) router.replace('/adviser/dashboard');
  }, [isAdviser, router]);

  useEffect(() => {
    apiClient.get('/portfolio/my').then(({ data }) => setData(data)).catch(() => setData({ portfolioType: null, positions: [], cashBalanceCents: '0', totalValueCents: '0', orders: [] }));
    apiClient.get('/plaid/balance').then(({ data }) => setPending(data.pendingDepositsCents)).catch(() => {});
    apiClient.get('/twr/current').then(({ data }) => setTwr(data)).catch(() => {});
    apiClient
      .get('/valuation/history?days=365')
      .then(({ data }) =>
        setHistory(
          (data.valuations ?? []).map((v: { valuationDate?: string; date?: string; totalValueCents: string | number }) => ({
            date: (v.valuationDate ?? v.date ?? '').slice(0, 10),
            totalValueCents: Number(v.totalValueCents),
          })),
        ),
      )
      .catch(() => {});
    apiClient.get('/restatement/history').then(({ data }) => setRestatement(data.restatements?.[0] ?? null)).catch(() => {});
  }, []);

  const chartData = useMemo(() => {
    const n = range === '1W' ? 7 : range === '1M' ? 30 : history.length;
    return history.slice(-n).map((h) => ({ date: h.date.slice(5), value: Number(h.totalValueCents) / 100 }));
  }, [history, range]);

  if (!data) return <div className="text-sm text-[var(--subtext)]">Loading…</div>;

  const cash = Number(data.cashBalanceCents);
  const total = Number(data.totalValueCents);
  const invested = total - cash;
  const si = twr?.sinceInception;
  const fmtPct = (p: string | null | undefined) => (p == null ? '—' : `${(Number(p) * 100).toFixed(2)}%`);

  return (
    <div className="space-y-6">
      {restatement && !dismissed && (
        <div className="flex items-start justify-between rounded-xl border border-[var(--warning)] bg-[#FFFBEB] p-4 text-sm">
          <div>
            <p className="font-medium">⚠️ Your returns were recently restated</p>
            <p className="mt-1 text-[var(--subtext)]">
              A price correction was applied for {new Date(restatement.valuationDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}. Updated return: {fmtPct(restatement.corrected.twrPct)} (was {fmtPct(restatement.original.twrPct)}).{' '}
              <Link href="/restatements" className="font-medium text-[var(--primary)] underline">View details →</Link>
            </p>
          </div>
          <button onClick={() => setDismissed(true)} className="text-[var(--subtext)]">✕</button>
        </div>
      )}

      {/* Hero */}
      <div className="card">
        <p className="text-sm text-[var(--subtext)]">Total Portfolio Value{data.portfolioType ? ` · ${data.portfolioType}` : ''}</p>
        <div className="mt-1 flex flex-wrap items-end justify-between gap-2">
          <span className="text-4xl font-bold">{usd(total)}</span>
          <span className="text-right">
            {si && <ReturnBadge percent={Number(si.twrPct)} />}
            <div className="text-xs text-[var(--subtext)]">Since inception (TWR)</div>
          </span>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-4 border-t border-[var(--border)] pt-4 text-sm">
          <div><p className="text-[var(--subtext)]">Cash</p><p className="font-semibold">{usd(cash)}</p><p className="text-xs text-[var(--subtext)]">{total ? ((cash / total) * 100).toFixed(1) : '0'}%</p></div>
          <div><p className="text-[var(--subtext)]">Invested</p><p className="font-semibold">{usd(invested)}</p><p className="text-xs text-[var(--subtext)]">{total ? ((invested / total) * 100).toFixed(1) : '0'}%</p></div>
          <div><p className="text-[var(--subtext)]">Pending</p><p className="font-semibold">{usd(pending)}</p></div>
        </div>
      </div>

      {/* Returns + chart */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-5">
        <div className="card md:col-span-2">
          <h2 className="text-sm font-bold">Time-Weighted Returns</h2>
          <div className="mt-3 space-y-3 text-sm">
            {([['Since Inception', twr?.sinceInception], ['This Month', twr?.oneMonth], ['This Week', twr?.oneWeek], ['Today', twr?.today]] as const).map(([label, r]) => (
              <div key={label} className="flex items-center justify-between">
                <span className="text-[var(--subtext)]">{label}</span>
                {r ? <ReturnBadge percent={Number(r.twrPct)} /> : <span className="text-[var(--subtext)]">—</span>}
              </div>
            ))}
          </div>
        </div>

        <div className="card md:col-span-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold">Portfolio Value</h2>
            <div className="flex gap-1 text-xs">
              {(['1W', '1M', 'All'] as const).map((r) => (
                <button key={r} onClick={() => setRange(r)} className={`rounded-md px-2 py-1 ${range === r ? 'bg-[var(--primary-light)] text-[var(--primary)]' : 'text-[var(--subtext)]'}`}>{r}</button>
              ))}
            </div>
          </div>
          <div className="mt-3 h-44">
            {chartData.length < 2 ? (
              <div className="flex h-full items-center justify-center text-sm text-[var(--subtext)]">Not enough history yet.</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
                  <defs>
                    <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#4f46e5" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="#4f46e5" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} stroke="#9ca3af" minTickGap={24} />
                  <YAxis tick={{ fontSize: 10 }} stroke="#9ca3af" width={48} domain={['auto', 'auto']} tickFormatter={(v) => `$${(v / 1000).toFixed(1)}k`} />
                  <Tooltip formatter={(v) => `$${Number(v).toLocaleString('en-US', { minimumFractionDigits: 2 })}`} />
                  <Area type="monotone" dataKey="value" stroke="#4f46e5" strokeWidth={2} fill="url(#g)" />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>

      {/* Holdings */}
      <div className="card">
        <h2 className="mb-3 text-sm font-bold">Holdings</h2>
        {data.positions.length === 0 ? (
          <p className="text-sm text-[var(--subtext)]">No holdings yet. <Link href="/portfolio" className="text-[var(--primary)] underline">Pick a portfolio</Link>.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-[var(--subtext)]">
                  <th className="pb-2">Stock</th><th>Units</th><th>Avg cost</th><th>LTP</th><th className="text-right">P&amp;L</th>
                </tr>
              </thead>
              <tbody>
                {data.positions.map((p) => {
                  const gain = Number(p.unrealizedGainCents);
                  const avgCost = Number(p.units) > 0 ? Number(p.costBasisCents) / Number(p.units) : 0;
                  return (
                    <tr key={p.symbol} className="border-t border-[var(--border)]">
                      <td className="py-2 font-medium">{p.symbol}</td>
                      <td>{Number(p.units).toFixed(6)}</td>
                      <td>{usd(avgCost)}</td>
                      <td>{usd(p.currentPriceCents)}</td>
                      <td className={`text-right font-semibold ${gain >= 0 ? 'positive' : 'negative'}`}>
                        {gain >= 0 ? '+' : ''}{usd(gain)}<div className="text-xs font-normal">{Number(p.unrealizedGainPct) >= 0 ? '+' : ''}{p.unrealizedGainPct}%</div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Recent activity */}
      <div className="card">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold">Recent Activity</h2>
          <Link href="/transactions" className="text-xs text-[var(--primary)] hover:underline">View all →</Link>
        </div>
        <div className="mt-3 space-y-2 text-sm">
          {data.orders.slice(0, 5).map((o) => (
            <div key={o.id} className="flex items-center justify-between border-t border-[var(--border)] py-2">
              <span>{o.side === 'BUY' ? '🟢' : '🔴'} {o.side} {o.symbol}</span>
              <span className="text-[var(--subtext)]">{o.status}{o.filledAvgPriceCents ? ` · ${usd(o.filledAvgPriceCents)}` : ''}</span>
            </div>
          ))}
          {data.orders.length === 0 && <p className="text-[var(--subtext)]">No activity yet.</p>}
        </div>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  return (
    <RouteGuard requireAuth requireKYC>
      <AppShell wide>
        <DashboardContent />
      </AppShell>
    </RouteGuard>
  );
}
