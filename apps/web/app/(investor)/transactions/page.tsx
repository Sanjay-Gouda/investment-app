'use client';

import { useEffect, useMemo, useState } from 'react';
import { apiClient } from '@/lib/api-client';
import { RouteGuard } from '@/components/shared/RouteGuard';
import { AppShell } from '@/components/shared/Shell';
import { usd } from '@/components/shared/ui';

interface Entry {
  id: string;
  type: string;
  amount: string;
  assetSymbol: string | null;
  units: string | null;
  description: string;
  effectiveDate: string;
  metadata: { bucket?: string } | null;
}

const COUNTER = new Set(['IN_TRANSIT', 'EXTERNAL', 'INVESTED']);
const ICON: Record<string, string> = {
  TRADE_BUY_CASH: '🟢', TRADE_SELL_CASH: '🔴', CASH_DEPOSIT: '🔵', CASH_DEPOSIT_RETURN: '🔴',
  CASH_WITHDRAWAL: '🔴', DIVIDEND_CASH: '💰', FEE: '⚠️', CORRECTION_REVERSAL: '⚠️', CORRECTION_REBOOK: '⚠️',
};

type Tab = 'All' | 'Trades' | 'Deposits' | 'Dividends';
const TAB_TYPES: Record<Tab, string[] | null> = {
  All: null,
  Trades: ['TRADE_BUY_CASH', 'TRADE_SELL_CASH'],
  Deposits: ['CASH_DEPOSIT', 'CASH_DEPOSIT_RETURN', 'CASH_WITHDRAWAL'],
  Dividends: ['DIVIDEND_CASH'],
};

function TransactionsContent() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [tab, setTab] = useState<Tab>('All');

  useEffect(() => {
    apiClient.get('/ledger/history?limit=200').then(({ data }) => setEntries(data.entries ?? [])).catch(() => setEntries([]));
  }, []);

  // Show meaningful legs only (hide IN_TRANSIT/EXTERNAL/INVESTED counter legs and $0 unit legs).
  const visible = useMemo(() => {
    return entries.filter((e) => {
      const bucket = e.metadata?.bucket;
      if (bucket && COUNTER.has(bucket)) return false;
      if (e.amount === '0') return false;
      const types = TAB_TYPES[tab];
      return types ? types.includes(e.type) : true;
    });
  }, [entries, tab]);

  const groups = useMemo(() => {
    const m = new Map<string, Entry[]>();
    for (const e of visible) {
      const key = new Date(e.effectiveDate).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
      (m.get(key) ?? m.set(key, []).get(key)!).push(e);
    }
    return [...m.entries()];
  }, [visible]);

  function exportCsv() {
    const header = 'date,type,symbol,amount_cents,units,description\n';
    const rows = visible
      .map((e) => [e.effectiveDate.slice(0, 10), e.type, e.assetSymbol ?? '', e.amount, e.units ?? '', `"${e.description}"`].join(','))
      .join('\n');
    const blob = new Blob([header + rows], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'corgi-transactions.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Transaction History</h1>
        <button onClick={exportCsv} className="btn-outline">Export CSV</button>
      </div>

      <div className="mt-4 flex gap-1">
        {(Object.keys(TAB_TYPES) as Tab[]).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`rounded-md px-3 py-1.5 text-sm ${tab === t ? 'bg-[var(--primary-light)] font-medium text-[var(--primary)]' : 'text-[var(--subtext)]'}`}>{t}</button>
        ))}
      </div>

      <div className="mt-6 space-y-6">
        {groups.length === 0 && <p className="text-sm text-[var(--subtext)]">No transactions.</p>}
        {groups.map(([month, items]) => {
          const monthTotal = items.reduce((s, e) => s + Number(e.amount), 0);
          return (
            <div key={month}>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--subtext)]">{month}</h2>
              <div className="card divide-y divide-[var(--border)] p-0">
                {items.map((e) => {
                  const amt = Number(e.amount);
                  return (
                    <div key={e.id} className="flex items-center justify-between px-5 py-3 text-sm">
                      <div>
                        <div className="font-medium">{ICON[e.type] ?? '•'} {e.description}</div>
                        <div className="text-xs text-[var(--subtext)]">{new Date(e.effectiveDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}{e.units ? ` · ${Number(e.units).toFixed(6)} units` : ''}</div>
                      </div>
                      <span className={`font-semibold ${amt >= 0 ? 'positive' : 'negative'}`}>{amt >= 0 ? '+' : ''}{usd(amt)}</span>
                    </div>
                  );
                })}
                <div className="flex justify-between px-5 py-2 text-xs text-[var(--subtext)]">
                  <span>{month} net</span>
                  <span className={monthTotal >= 0 ? 'positive' : 'negative'}>{monthTotal >= 0 ? '+' : ''}{usd(monthTotal)}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

export default function TransactionsPage() {
  return (
    <RouteGuard requireAuth requireKYC>
      <AppShell>
        <TransactionsContent />
      </AppShell>
    </RouteGuard>
  );
}
