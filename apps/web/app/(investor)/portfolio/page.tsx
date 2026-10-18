'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiClient } from '@/lib/api-client';
import { RouteGuard } from '@/components/shared/RouteGuard';
import { AppShell } from '@/components/shared/Shell';
import { usd } from '@/components/shared/ui';

interface Model {
  type: string;
  name: string;
  description: string;
  riskLevel: string;
  expectedReturn: string;
  weights: Record<string, number>;
}

const BORDER: Record<string, string> = {
  CONSERVATIVE: '#00c853',
  MODERATE: '#2563eb',
  GROWTH: '#7c3aed',
  AGGRESSIVE: '#ff3d57',
};
const DOT: Record<string, string> = { CONSERVATIVE: '🟢', MODERATE: '🔵', GROWTH: '🟣', AGGRESSIVE: '🔴' };

function Bar({ label, pct, color }: { label: string; pct: number; color: string }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-10 text-[var(--subtext)]">{label}</span>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-[var(--bg)]">
        <div className="h-full rounded-full" style={{ width: `${pct * 100}%`, background: color }} />
      </div>
      <span className="w-8 text-right">{Math.round(pct * 100)}%</span>
    </div>
  );
}

function PortfolioContent() {
  const router = useRouter();
  const [models, setModels] = useState<Model[]>([]);
  const [cashCents, setCashCents] = useState(0);
  const [confirm, setConfirm] = useState<Model | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [pendingApproval, setPendingApproval] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [m, b] = await Promise.all([apiClient.get('/portfolio/models'), apiClient.get('/plaid/balance')]);
    setModels(m.data.models);
    setCashCents(Number(b.data.availableBalanceCents ?? b.data.cashBalanceCents ?? 0));
  }, []);
  useEffect(() => {
    load().catch(() => {});
  }, [load]);

  async function invest(type: string) {
    setBusy(true);
    setError(null);
    try {
      const { data } = await apiClient.post('/portfolio/invest', { portfolioType: type });
      setPendingApproval(!!data.pendingApproval);
      setDone(true);
    } catch (err: unknown) {
      setError((err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message ?? 'Could not place orders');
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="card mx-auto max-w-md text-center">
        <div className="text-4xl">{pendingApproval ? '⏳' : '✅'}</div>
        <h2 className="mt-2 text-xl font-bold">{pendingApproval ? 'Submitted for approval' : 'Portfolio orders placed!'}</h2>
        <p className="mt-1 text-sm text-[var(--subtext)]">
          {pendingApproval
            ? 'This investment exceeds the approval threshold. A human adviser must approve it before orders are placed.'
            : 'Your investments are being processed.'}
        </p>
        <button onClick={() => router.push('/dashboard')} className="btn-primary mt-4 w-full">Go to Dashboard →</button>
      </div>
    );
  }

  return (
    <>
      <h1 className="text-2xl font-bold">Choose Your Portfolio</h1>
      <p className="mt-1 text-sm text-[var(--subtext)]">Professionally managed and auto-rebalanced monthly. A 10% cash buffer is always kept.</p>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {models.map((m) => (
          <div key={m.type} className="card flex flex-col" style={{ borderTop: `3px solid ${BORDER[m.type]}` }}>
            <div className="text-lg font-bold">{DOT[m.type]} {m.name}</div>
            <div className="text-xs uppercase tracking-wide text-[var(--subtext)]">{m.riskLevel} risk</div>
            <div className="mt-3 space-y-1">
              {Object.entries(m.weights).map(([s, w]) => <Bar key={s} label={s} pct={w} color={BORDER[m.type]} />)}
              <Bar label="Cash" pct={0.1} color="#9ca3af" />
            </div>
            <p className="mt-3 text-sm">Expected: {m.expectedReturn}</p>
            <button onClick={() => setConfirm(m)} className="btn-primary mt-4 w-full">Select This Portfolio</button>
          </div>
        ))}
      </div>

      {confirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !busy && setConfirm(null)}>
          <div className="card w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold">Confirm Investment</h2>
            <p className="mt-2 text-sm">Portfolio: <strong>{DOT[confirm.type]} {confirm.name}</strong></p>
            <p className="text-sm">Available cash: <strong>{usd(cashCents)}</strong></p>
            <div className="mt-3 space-y-1 text-sm">
              {Object.entries(confirm.weights).map(([s, w]) => (
                <div key={s} className="flex justify-between"><span>{s} {Math.round(w * 100)}%</span><span className="text-[var(--subtext)]">~{usd(cashCents * w)}</span></div>
              ))}
              <div className="flex justify-between"><span>Cash 10%</span><span className="text-[var(--subtext)]">~{usd(cashCents * 0.1)}</span></div>
            </div>
            <p className="mt-2 text-xs text-[var(--subtext)]">Orders placed at market price.</p>
            {error && <p className="mt-2 text-sm text-[var(--danger)]">{error}</p>}
            <div className="mt-4 flex gap-2">
              <button onClick={() => setConfirm(null)} disabled={busy} className="btn-outline flex-1">Cancel</button>
              <button onClick={() => invest(confirm.type)} disabled={busy} className="btn-primary flex-1">{busy ? 'Placing…' : 'Confirm & Invest →'}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default function PortfolioPage() {
  return (
    <RouteGuard requireAuth requireKYC>
      <AppShell>
        <PortfolioContent />
      </AppShell>
    </RouteGuard>
  );
}
