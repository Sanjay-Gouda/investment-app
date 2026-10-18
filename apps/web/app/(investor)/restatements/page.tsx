'use client';

import { useEffect, useState } from 'react';
import { apiClient } from '@/lib/api-client';
import { RouteGuard } from '@/components/shared/RouteGuard';
import { AppShell } from '@/components/shared/Shell';
import { usd } from '@/components/shared/ui';

interface Restatement {
  valuationDate: string;
  restatementDate: string;
  reason: string | null;
  original: { totalValueCents: string | null; twrPct: string | null };
  corrected: { totalValueCents: string; twrPct: string };
  differenceCents: string | null;
  correctedPrices: Record<string, { was: number; corrected: number }> | null;
}

const pct = (p: string | null) => (p == null ? '—' : `${(Number(p) * 100).toFixed(2)}%`);
const d = (s: string) => new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

function RestatementsContent() {
  const [items, setItems] = useState<Restatement[]>([]);
  useEffect(() => {
    apiClient.get('/restatement/history').then(({ data }) => setItems(data.restatements ?? [])).catch(() => {});
  }, []);

  return (
    <>
      <h1 className="text-2xl font-bold">Valuation Corrections</h1>
      <p className="mt-1 text-sm text-[var(--subtext)]">Corrections are additive — the originally published figure is always preserved for audit.</p>
      {items.length === 0 ? (
        <p className="mt-6 text-sm text-[var(--subtext)]">No corrections have been applied.</p>
      ) : (
        <div className="mt-6 space-y-4">
          {items.map((r, i) => {
            const up = Number(r.differenceCents) >= 0;
            return (
              <div key={i} className="card">
                <div className="flex items-center justify-between">
                  <h2 className="font-semibold">{d(r.valuationDate)}</h2>
                  <span className="text-xs text-[var(--subtext)]">corrected {d(r.restatementDate)}</span>
                </div>
                {r.reason && <p className="mt-1 text-sm text-[var(--subtext)]">Reason: {r.reason}</p>}
                <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                  <div className="rounded-lg bg-[var(--bg)] p-3"><p className="text-xs text-[var(--subtext)]">Original</p><p className="font-medium">{usd(r.original.totalValueCents)}</p><p className="text-xs text-[var(--subtext)]">TWR {pct(r.original.twrPct)}</p></div>
                  <div className="rounded-lg bg-[var(--success-light)] p-3"><p className="text-xs text-[var(--subtext)]">Corrected</p><p className="font-medium">{usd(r.corrected.totalValueCents)}</p><p className="text-xs text-[var(--subtext)]">TWR {pct(r.corrected.twrPct)}</p></div>
                </div>
                <p className={`mt-2 text-sm font-medium ${up ? 'positive' : 'negative'}`}>Difference: {up ? '+' : ''}{usd(r.differenceCents)}</p>
                {r.correctedPrices && Object.entries(r.correctedPrices).map(([s, v]) => (
                  <p key={s} className="mt-2 text-xs text-[var(--subtext)]">Price correction — {s}: was {usd(v.was)} → corrected {usd(v.corrected)}</p>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

export default function RestatementsPage() {
  return (
    <RouteGuard requireAuth requireKYC>
      <AppShell>
        <RestatementsContent />
      </AppShell>
    </RouteGuard>
  );
}
