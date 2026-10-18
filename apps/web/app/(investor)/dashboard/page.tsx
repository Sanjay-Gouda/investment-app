'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { apiClient } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';

interface Position {
  symbol: string;
  units: string;
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

function usd(cents: string | number): string {
  return `$${(Number(cents) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function DashboardPage() {
  const router = useRouter();
  const { user, loading, isAuthenticated, logout } = useAuth();
  const [data, setData] = useState<MyPortfolio | null>(null);
  const [pendingCents, setPendingCents] = useState('0');

  useEffect(() => {
    if (!loading && !isAuthenticated) router.replace('/login');
  }, [loading, isAuthenticated, router]);

  useEffect(() => {
    if (!isAuthenticated) return;
    apiClient.get('/portfolio/my').then(({ data }) => setData(data)).catch(() => {});
    apiClient.get('/plaid/balance').then(({ data }) => setPendingCents(data.pendingDepositsCents)).catch(() => {});
  }, [isAuthenticated]);

  if (loading || !data) return <Centered>Loading…</Centered>;

  const cash = data.cashBalanceCents;
  const total = data.totalValueCents;
  const invested = String(Number(total) - Number(cash));

  return (
    <main className="mx-auto min-h-screen max-w-3xl px-6 py-10">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Dashboard</h1>
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
      </div>

      <div className="mt-4 grid grid-cols-3 gap-4">
        <Stat label="Cash" value={usd(cash)} />
        <Stat label="Invested" value={usd(invested)} />
        <Stat label="Pending" value={usd(pendingCents)} />
      </div>

      <h2 className="mt-8 text-lg font-semibold">Positions</h2>
      {data.positions.length === 0 ? (
        <p className="mt-2 text-sm text-neutral-500">
          No positions yet. <Link href="/portfolio" className="text-corgi hover:underline">Pick a portfolio</Link>.
        </p>
      ) : (
        <table className="mt-3 w-full text-sm">
          <tbody>
            {data.positions.map((p) => (
              <tr key={p.symbol} className="border-b">
                <td className="py-2 font-medium">{p.symbol}</td>
                <td>{Number(p.units).toFixed(6)} units</td>
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

      <div className="mt-8 flex items-center justify-between">
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
          {data.orders.length === 0 && (
            <tr><td className="py-2 text-neutral-500">No orders yet.</td></tr>
          )}
        </tbody>
      </table>

      <div className="mt-8 flex gap-3 text-sm">
        <Link href="/deposit" className="rounded-md border px-4 py-2 hover:bg-neutral-50">Deposit</Link>
        <Link href="/portfolio" className="rounded-md bg-corgi px-4 py-2 font-medium text-white hover:bg-corgi/90">Invest</Link>
      </div>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border p-4">
      <p className="text-xs text-neutral-500">{label}</p>
      <p className="mt-1 text-lg font-medium">{value}</p>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <main className="flex min-h-screen items-center justify-center text-sm text-neutral-600">{children}</main>;
}
