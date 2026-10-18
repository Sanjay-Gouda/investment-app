'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiClient } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';

interface Restatement {
  valuationDate: string;
  restatementDate: string;
  reason: string | null;
  original: { totalValueCents: string | null; twrPct: string | null };
  corrected: { totalValueCents: string; twrPct: string };
  differenceCents: string | null;
  correctedPrices: Record<string, { was: number; corrected: number }> | null;
}

const usd = (c: string | number | null) =>
  c == null ? '—' : `$${(Number(c) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (p: string | null) => (p == null ? '—' : `${(Number(p) * 100).toFixed(2)}%`);
const d = (s: string) => new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

export default function RestatementsPage() {
  const router = useRouter();
  const { loading, isAuthenticated } = useAuth();
  const [items, setItems] = useState<Restatement[]>([]);

  useEffect(() => {
    if (!loading && !isAuthenticated) router.replace('/login');
  }, [loading, isAuthenticated, router]);

  useEffect(() => {
    if (isAuthenticated) apiClient.get('/restatement/history').then(({ data }) => setItems(data.restatements ?? [])).catch(() => setItems([]));
  }, [isAuthenticated]);

  return (
    <main className="mx-auto min-h-screen max-w-2xl px-6 py-10">
      <h1 className="text-2xl font-semibold">Valuation corrections</h1>
      <p className="mt-1 text-sm text-neutral-600">
        Restatements are additive — the originally published figure is always preserved for audit.
      </p>

      {items.length === 0 ? (
        <p className="mt-6 text-sm text-neutral-500">No corrections have been applied.</p>
      ) : (
        <div className="mt-6 space-y-4">
          {items.map((r, i) => {
            const up = Number(r.differenceCents) >= 0;
            return (
              <div key={i} className="rounded-lg border p-5">
                <div className="flex items-center justify-between">
                  <h2 className="font-semibold">{d(r.valuationDate)}</h2>
                  <span className="text-xs text-neutral-500">corrected {d(r.restatementDate)}</span>
                </div>
                {r.reason && <p className="mt-1 text-sm text-neutral-600">Reason: {r.reason}</p>}

                <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                  <div className="rounded bg-neutral-50 p-3">
                    <p className="text-xs text-neutral-500">Original</p>
                    <p className="font-medium">{usd(r.original.totalValueCents)}</p>
                    <p className="text-xs text-neutral-500">TWR {pct(r.original.twrPct)}</p>
                  </div>
                  <div className="rounded bg-green-50 p-3">
                    <p className="text-xs text-neutral-500">Corrected</p>
                    <p className="font-medium">{usd(r.corrected.totalValueCents)}</p>
                    <p className="text-xs text-neutral-500">TWR {pct(r.corrected.twrPct)}</p>
                  </div>
                </div>

                <p className={`mt-2 text-sm font-medium ${up ? 'text-green-700' : 'text-red-700'}`}>
                  Difference: {up ? '+' : ''}
                  {usd(r.differenceCents)}
                </p>

                {r.correctedPrices &&
                  Object.entries(r.correctedPrices).map(([sym, v]) => (
                    <p key={sym} className="mt-2 text-xs text-neutral-600">
                      Price correction — {sym}: was {usd(v.was)} → corrected {usd(v.corrected)}
                    </p>
                  ))}
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}
