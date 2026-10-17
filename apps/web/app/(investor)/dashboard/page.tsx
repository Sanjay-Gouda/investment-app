'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { apiClient } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';

interface Balance {
  cashBalanceCents: string;
  pendingDepositsCents: string;
  availableBalanceCents: string;
}

function usd(cents: string | number): string {
  return `$${(Number(cents) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function DashboardPage() {
  const router = useRouter();
  const { user, loading, isAuthenticated, logout } = useAuth();
  const [balance, setBalance] = useState<Balance | null>(null);

  useEffect(() => {
    if (!loading && !isAuthenticated) router.replace('/login');
  }, [loading, isAuthenticated, router]);

  useEffect(() => {
    if (isAuthenticated) apiClient.get('/plaid/balance').then(({ data }) => setBalance(data)).catch(() => {});
  }, [isAuthenticated]);

  if (loading) return <Centered>Loading…</Centered>;

  const cash = balance?.cashBalanceCents ?? '0';
  const pending = balance?.pendingDepositsCents ?? '0';
  // Invested value needs the valuation service (next step); cash = total for now.
  const invested = '0';
  const total = String(Number(cash) + Number(invested));

  return (
    <main className="mx-auto min-h-screen max-w-3xl px-6 py-10">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Dashboard</h1>
          <p className="mt-1 text-sm text-neutral-600">{user?.fullName ?? user?.email}</p>
        </div>
        <button onClick={logout} className="rounded-md border px-3 py-1.5 text-sm hover:bg-neutral-50">
          Log out
        </button>
      </div>

      <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Total Portfolio Value" value={usd(total)} emphasis />
        <Stat label="Cash Balance" value={usd(cash)} />
        <Stat label="Pending Deposits" value={usd(pending)} />
        <Stat label="Invested" value={usd(invested)} note="next step" />
      </div>

      <div className="mt-8 flex gap-3 text-sm">
        <Link href="/deposit" className="rounded-md bg-corgi px-4 py-2 font-medium text-white hover:bg-corgi/90">
          Deposit
        </Link>
        <Link href="/portfolio" className="rounded-md border px-4 py-2 hover:bg-neutral-50">
          Portfolio
        </Link>
        <Link href="/transactions" className="rounded-md border px-4 py-2 hover:bg-neutral-50">
          Transactions
        </Link>
      </div>
    </main>
  );
}

function Stat({ label, value, emphasis, note }: { label: string; value: string; emphasis?: boolean; note?: string }) {
  return (
    <div className="rounded-lg border p-4">
      <p className="text-xs text-neutral-500">{label}</p>
      <p className={`mt-1 ${emphasis ? 'text-2xl font-semibold' : 'text-lg font-medium'}`}>{value}</p>
      {note && <p className="text-[10px] uppercase tracking-wide text-neutral-400">{note}</p>}
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <main className="flex min-h-screen items-center justify-center text-sm text-neutral-600">{children}</main>;
}
