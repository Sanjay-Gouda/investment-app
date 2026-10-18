'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiClient } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';

interface RestatementItem {
  accountId: string;
  original: { totalValueCents: string; twrPct: string };
  restated: { totalValueCents: string; twrPct: string };
  differenceCents: string;
}

const usd = (c: string | number) => `$${(Number(c) / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;

export default function AdviserRestatementPage() {
  const router = useRouter();
  const { user, loading, isAuthenticated } = useAuth();
  const [symbol, setSymbol] = useState('VTI');
  const [date, setDate] = useState('');
  const [correctPrice, setCorrectPrice] = useState('');
  const [reason, setReason] = useState('Custodian correction');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ affectedAccounts: number; restatements: RestatementItem[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && !isAuthenticated) router.replace('/login');
  }, [loading, isAuthenticated, router]);

  if (loading) return <Centered>Loading…</Centered>;
  if (user && user.role !== 'ADVISER') {
    return <Centered>This tool is for advisers only. (Log in as adviser@demo.com.)</Centered>;
  }

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
    } catch (err: unknown) {
      setError(
        (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message ??
          'Correction failed',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto min-h-screen max-w-lg px-6 py-10">
      <h1 className="text-2xl font-semibold">Correct closing price</h1>
      <p className="mt-1 text-sm text-neutral-600">
        Adds a corrected price and restates affected valuations. Originals are never overwritten.
      </p>

      <div className="mt-6 space-y-4">
        <Field label="Symbol">
          <input className="inp" value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} />
        </Field>
        <Field label="Date (value date that was wrong)">
          <input className="inp" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Correct price (USD)">
          <input className="inp" type="number" step="0.01" value={correctPrice} onChange={(e) => setCorrectPrice(e.target.value)} />
        </Field>
        <Field label="Reason">
          <input className="inp" value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>

        {error && <p className="text-sm text-red-600">{error}</p>}

        {!confirming ? (
          <button
            onClick={() => setConfirming(true)}
            disabled={!symbol || !date || !correctPrice}
            className="rounded-md border px-4 py-2 text-sm hover:bg-neutral-50 disabled:opacity-50"
          >
            Preview Impact
          </button>
        ) : (
          <div className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm">
            <p className="text-amber-900">
              This will restate valuations for <strong>{symbol}</strong> on <strong>{date}</strong> to{' '}
              <strong>${correctPrice}</strong>. Affected accounts will get a new corrected row; originals are kept.
            </p>
            <div className="mt-3 flex gap-2">
              <button onClick={apply} disabled={busy} className="rounded-md bg-corgi px-4 py-2 font-medium text-white hover:bg-corgi/90 disabled:opacity-50">
                {busy ? 'Applying…' : 'Apply Correction'}
              </button>
              <button onClick={() => setConfirming(false)} className="rounded-md border px-4 py-2 hover:bg-neutral-50">
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {result && (
        <div className="mt-6 rounded-lg border p-4 text-sm">
          <p className="font-medium">Restated {result.affectedAccounts} account(s).</p>
          {result.restatements.map((r) => (
            <div key={r.accountId} className="mt-2 border-t pt-2">
              <p className="text-xs text-neutral-500">Account {r.accountId.slice(0, 8)}…</p>
              <p>
                {usd(r.original.totalValueCents)} → <span className="font-medium">{usd(r.restated.totalValueCents)}</span>{' '}
                <span className={Number(r.differenceCents) >= 0 ? 'text-green-700' : 'text-red-700'}>
                  ({Number(r.differenceCents) >= 0 ? '+' : ''}
                  {usd(r.differenceCents)})
                </span>
              </p>
            </div>
          ))}
        </div>
      )}

      <style>{`.inp{width:100%;border:1px solid #d4d4d4;border-radius:0.375rem;padding:0.5rem 0.75rem;font-size:0.875rem}`}</style>
    </main>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium">{label}</span>
      {children}
    </label>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <main className="flex min-h-screen items-center justify-center px-6 text-center text-sm text-neutral-600">{children}</main>;
}
