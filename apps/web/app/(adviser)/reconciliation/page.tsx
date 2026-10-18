'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiClient } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';

interface Break {
  id: string;
  breakType: string;
  symbol: string | null;
  ledgerValue: string | null;
  custodianValue: string | null;
  difference: string | null;
  agingDays: number;
  status: string;
  breakDate: string;
}
interface Summary {
  totalOpen: number;
  byType: Record<string, number>;
  oldestBreakDays: number;
  totalBreaks: number;
}

export default function ReconciliationPage() {
  const router = useRouter();
  const { user, loading, isAuthenticated } = useAuth();
  const [breaks, setBreaks] = useState<Break[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [filter, setFilter] = useState<'all' | 'OPEN' | 'RESOLVED'>('OPEN');
  const [busy, setBusy] = useState(false);
  const [lastRun, setLastRun] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && !isAuthenticated) router.replace('/login');
  }, [loading, isAuthenticated, router]);

  const load = useCallback(async () => {
    const statusQ = filter === 'all' ? 'all' : filter;
    const [b, s] = await Promise.all([
      apiClient.get(`/reconciliation/breaks?status=${statusQ}`),
      apiClient.get('/reconciliation/summary'),
    ]);
    setBreaks(b.data.breaks ?? []);
    setSummary(s.data);
  }, [filter]);

  useEffect(() => {
    if (isAuthenticated && user?.role === 'ADVISER') {
      load().catch(() => {});
      const t = setInterval(() => load().catch(() => {}), 60_000); // auto-refresh
      return () => clearInterval(t);
    }
  }, [isAuthenticated, user, load]);

  if (loading) return <Centered>Loading…</Centered>;
  if (user && user.role !== 'ADVISER') {
    return <Centered>Reconciliation is adviser-only. (Log in as adviser@demo.com.)</Centered>;
  }

  async function runNow() {
    setBusy(true);
    try {
      await apiClient.post('/reconciliation/run');
      setLastRun(new Date().toLocaleString('en-US'));
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function resolve(id: string) {
    const resolution = window.prompt('Resolution note:', 'Investigated — timing difference');
    if (resolution == null) return;
    await apiClient.post(`/reconciliation/breaks/${id}/resolve`, { resolution });
    await load();
  }

  const fmt = (v: string | null) => (v == null ? '—' : Number(v).toLocaleString('en-US', { maximumFractionDigits: 6 }));

  return (
    <main className="mx-auto min-h-screen max-w-2xl px-6 py-10">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Reconciliation</h1>
        <button
          onClick={runNow}
          disabled={busy}
          className="rounded-md bg-corgi px-3 py-1.5 text-sm font-medium text-white hover:bg-corgi/90 disabled:opacity-50"
        >
          {busy ? 'Running…' : '🔄 Run'}
        </button>
      </div>
      <p className="mt-1 text-xs text-neutral-500">
        Custodian file: SIMULATED{lastRun ? ` · last run ${lastRun}` : ''}
      </p>

      {summary && (
        <div className="mt-5 grid grid-cols-3 gap-3 text-sm">
          <Stat label="Open breaks" value={String(summary.totalOpen)} />
          <Stat label="Oldest break" value={`${summary.oldestBreakDays} day${summary.oldestBreakDays === 1 ? '' : 's'}`} />
          <Stat label="Total (all time)" value={String(summary.totalBreaks)} />
        </div>
      )}

      <div className="mt-6 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Breaks</h2>
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value as 'all' | 'OPEN' | 'RESOLVED')}
          className="rounded-md border px-2 py-1 text-sm"
        >
          <option value="OPEN">Open</option>
          <option value="RESOLVED">Resolved</option>
          <option value="all">All</option>
        </select>
      </div>

      <div className="mt-3 space-y-3">
        {breaks.length === 0 && <p className="text-sm text-neutral-500">No breaks. ✅</p>}
        {breaks.map((b) => {
          const resolved = b.status === 'RESOLVED';
          return (
            <div key={b.id} className={`rounded-lg border p-4 ${resolved ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}`}>
              <div className="flex items-center justify-between">
                <span className="font-medium">
                  {resolved ? '✅' : '🔴'} {b.breakType}
                  {b.symbol ? ` · ${b.symbol}` : ''}
                </span>
                <span className="text-xs text-neutral-500">{b.agingDays} day{b.agingDays === 1 ? '' : 's'} old</span>
              </div>
              <div className="mt-2 text-sm text-neutral-700">
                <div>Ledger: {fmt(b.ledgerValue)}</div>
                <div>Custodian: {b.breakType === 'MISSING_IN_CUSTODIAN' ? 'not found' : fmt(b.custodianValue)}</div>
                {b.difference != null && <div>Diff: {Number(b.difference) >= 0 ? '+' : ''}{fmt(b.difference)}</div>}
              </div>
              {!resolved && (
                <button onClick={() => resolve(b.id)} className="mt-3 rounded-md border px-3 py-1 text-xs hover:bg-white">
                  Resolve
                </button>
              )}
            </div>
          );
        })}
      </div>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-xs text-neutral-500">{label}</p>
      <p className="mt-1 text-lg font-medium">{value}</p>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <main className="flex min-h-screen items-center justify-center px-6 text-center text-sm text-neutral-600">{children}</main>;
}
