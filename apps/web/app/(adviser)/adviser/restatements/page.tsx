'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiClient } from '@/lib/api-client';
import { usd } from '@/components/shared/ui';

interface HistoryRow {
  valuationDate: string;
  restatementDate: string;
  reason: string | null;
  original: { totalValueCents: string | null; twrPct: string | null };
  corrected: { totalValueCents: string; twrPct: string };
  differenceCents: string | null;
  correctedPrices: Record<string, { was: number; corrected: number }> | null;
}
interface RestatementItem {
  accountId: string;
  original: { totalValueCents: string; twrPct: string };
  restated: { totalValueCents: string; twrPct: string };
  differenceCents: string;
}

const pct = (p: string | null) => (p == null ? '—' : `${(Number(p) * 100).toFixed(2)}%`);

export default function AdviserRestatements() {
  const [symbol, setSymbol] = useState('VTI');
  const [date, setDate] = useState('');
  const [correctPrice, setCorrectPrice] = useState('');
  const [reason, setReason] = useState('Custodian correction');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ affectedAccounts: number; restatements: RestatementItem[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryRow[]>([]);

  const loadHistory = useCallback(async () => {
    const { data } = await apiClient.get('/restatement/history');
    setHistory(data.restatements ?? []);
  }, []);
  useEffect(() => {
    loadHistory().catch(() => {});
  }, [loadHistory]);

  async function apply() {
    setBusy(true);
    setError(null);
    try {
      const { data } = await apiClient.post('/restatement/correct-price', {
        symbol,
        date,
        correctPriceCents: Math.round(parseFloat(correctPrice) * 100),
        reason,
      });
      setResult(data);
      setConfirming(false);
      await loadHistory();
    } catch (err: unknown) {
      setError((err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message ?? 'Correction failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h1 className="text-2xl font-bold">Restatements</h1>

      <div className="card mt-5 max-w-lg">
        <h2 className="text-sm font-bold">Correct a Closing Price</h2>
        <p className="mt-1 text-xs text-[var(--subtext)]">Adds a corrected price and restates affected valuations. Originals are never overwritten.</p>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <label className="block"><span className="mb-1 block text-xs font-medium">Symbol</span><input className="field-input" value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} /></label>
          <label className="block"><span className="mb-1 block text-xs font-medium">Date</span><input className="field-input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
          <label className="block"><span className="mb-1 block text-xs font-medium">Correct price (USD)</span><input className="field-input" type="number" step="0.01" value={correctPrice} onChange={(e) => setCorrectPrice(e.target.value)} /></label>
          <label className="block"><span className="mb-1 block text-xs font-medium">Reason</span><input className="field-input" value={reason} onChange={(e) => setReason(e.target.value)} /></label>
        </div>
        {error && <p className="mt-2 text-sm text-[var(--danger)]">{error}</p>}
        {!confirming ? (
          <button onClick={() => setConfirming(true)} disabled={!symbol || !date || !correctPrice} className="btn-outline mt-4">Preview Impact</button>
        ) : (
          <div className="mt-4 rounded-lg border border-[var(--warning)] bg-[#FFFBEB] p-3 text-sm">
            <p>Restate <strong>{symbol}</strong> on <strong>{date}</strong> to <strong>${correctPrice}</strong>? Affected accounts get a new corrected row; originals are kept.</p>
            <div className="mt-3 flex gap-2">
              <button onClick={apply} disabled={busy} className="btn-primary">{busy ? 'Applying…' : 'Apply Correction'}</button>
              <button onClick={() => setConfirming(false)} className="btn-outline">Cancel</button>
            </div>
          </div>
        )}
        {result && (
          <div className="mt-4 rounded-lg border border-[var(--border)] p-3 text-sm">
            <p className="font-medium">Restated {result.affectedAccounts} account(s).</p>
            {result.restatements.map((r) => (
              <p key={r.accountId} className="mt-1">{usd(r.original.totalValueCents)} → <strong>{usd(r.restated.totalValueCents)}</strong> <span className={Number(r.differenceCents) >= 0 ? 'positive' : 'negative'}>({Number(r.differenceCents) >= 0 ? '+' : ''}{usd(r.differenceCents)})</span></p>
            ))}
          </div>
        )}
      </div>

      <div className="card mt-6 overflow-x-auto">
        <h2 className="mb-3 text-sm font-bold">Restatement History</h2>
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs text-[var(--subtext)]"><th className="pb-2">Date</th><th>Was</th><th>Fixed</th><th>Impact</th><th>Reason</th></tr></thead>
          <tbody>
            {history.length === 0 && <tr><td colSpan={5} className="py-3 text-[var(--subtext)]">No restatements yet.</td></tr>}
            {history.map((h, i) => {
              const prices = h.correctedPrices ? Object.entries(h.correctedPrices)[0] : null;
              const up = Number(h.differenceCents) >= 0;
              return (
                <tr key={i} className="border-t border-[var(--border)]">
                  <td className="py-2">{new Date(h.valuationDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</td>
                  <td>{prices ? usd(prices[1].was) : usd(h.original.totalValueCents)}<div className="text-xs text-[var(--subtext)]">TWR {pct(h.original.twrPct)}</div></td>
                  <td>{prices ? usd(prices[1].corrected) : usd(h.corrected.totalValueCents)}<div className="text-xs text-[var(--subtext)]">TWR {pct(h.corrected.twrPct)}</div></td>
                  <td className={up ? 'positive' : 'negative'}>{up ? '+' : ''}{usd(h.differenceCents)}</td>
                  <td className="text-xs text-[var(--subtext)]">{h.reason}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
