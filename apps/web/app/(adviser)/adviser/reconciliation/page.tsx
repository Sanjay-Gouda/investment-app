'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiClient } from '@/lib/api-client';
import { StatCard } from '@/components/shared/ui';

const simulateEnabled = process.env.NEXT_PUBLIC_ENABLE_SIMULATE === 'true';

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
  oldestBreakDays: number;
  totalBreaks: number;
}

export default function AdviserReconciliation() {
  const [breaks, setBreaks] = useState<Break[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [filter, setFilter] = useState<'all' | 'OPEN' | 'RESOLVED'>('OPEN');
  const [busy, setBusy] = useState(false);
  const [lastRun, setLastRun] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [b, s] = await Promise.all([
      apiClient.get(`/reconciliation/breaks?status=${filter}`),
      apiClient.get('/reconciliation/summary'),
    ]);
    setBreaks(b.data.breaks ?? []);
    setSummary(s.data);
  }, [filter]);

  useEffect(() => {
    load().catch(() => {});
    const t = setInterval(() => load().catch(() => {}), 60_000);
    return () => clearInterval(t);
  }, [load]);

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
    <>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Reconciliation</h1>
        <div className="flex items-center gap-3">
          {simulateEnabled && (
            <button onClick={async () => { await apiClient.post('/test/reconciliation/plant-break', { type: 'amount', symbol: 'VTI' }); load(); }} className="btn-dev">⚡ Plant break (Dev)</button>
          )}
          <button onClick={runNow} disabled={busy} className="btn-primary">{busy ? 'Running…' : '🔄 Run Now'}</button>
        </div>
      </div>
      <p className="mt-1 text-xs text-[var(--subtext)]">Custodian file: SIMULATED{lastRun ? ` · last run ${lastRun}` : ''}</p>

      {summary && (
        <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatCard label="Open Breaks" value={String(summary.totalOpen)} accent={summary.totalOpen ? 'danger' : undefined} />
          <StatCard label="Oldest Break" value={`${summary.oldestBreakDays} day${summary.oldestBreakDays === 1 ? '' : 's'}`} />
          <StatCard label="Total (all time)" value={String(summary.totalBreaks)} />
        </div>
      )}

      <div className="mt-6 flex gap-1">
        {(['OPEN', 'RESOLVED', 'all'] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)} className={`rounded-md px-3 py-1.5 text-sm ${filter === f ? 'bg-[var(--primary-light)] font-medium text-[var(--primary)]' : 'text-[var(--subtext)]'}`}>{f === 'all' ? 'All' : f.charAt(0) + f.slice(1).toLowerCase()}</button>
        ))}
      </div>

      <div className="mt-4 space-y-3">
        {breaks.length === 0 && <p className="text-sm text-[var(--subtext)]">No breaks. ✅</p>}
        {breaks.map((b) => {
          const resolved = b.status === 'RESOLVED';
          return (
            <div key={b.id} className="card" style={{ borderLeft: `4px solid ${resolved ? 'var(--success)' : 'var(--danger)'}` }}>
              <div className="flex items-center justify-between">
                <span className="font-semibold">{resolved ? '✅' : '🔴'} {b.breakType}{b.symbol ? ` · ${b.symbol}` : ''}</span>
                <span className="text-xs text-[var(--subtext)]">{b.agingDays} day{b.agingDays === 1 ? '' : 's'} old</span>
              </div>
              <div className="mt-2 text-sm text-[var(--text)]">
                <div>Our ledger: {fmt(b.ledgerValue)}</div>
                <div>Custodian: {b.breakType === 'MISSING_IN_CUSTODIAN' ? 'not found' : fmt(b.custodianValue)}</div>
                {b.difference != null && <div>Difference: {Number(b.difference) >= 0 ? '+' : ''}{fmt(b.difference)}</div>}
                <div className="mt-1 text-xs text-[var(--subtext)]">Detected {new Date(b.breakDate).toLocaleDateString('en-US')}</div>
              </div>
              {!resolved && <button onClick={() => resolve(b.id)} className="btn-outline mt-3">✓ Mark Resolved</button>}
            </div>
          );
        })}
      </div>
    </>
  );
}
