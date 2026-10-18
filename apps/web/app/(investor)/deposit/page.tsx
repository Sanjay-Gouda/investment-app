'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiClient } from '@/lib/api-client';
import { RouteGuard } from '@/components/shared/RouteGuard';
import { AppShell } from '@/components/shared/Shell';
import { EmptyState, usd } from '@/components/shared/ui';

const simulateEnabled = process.env.NEXT_PUBLIC_ENABLE_SIMULATE === 'true';
const QUICK = [500, 1000, 5000, 10000];

interface Deposit {
  id: string;
  amountCents: string;
  status: 'PENDING' | 'SETTLED' | 'RETURNED';
  settlementDate: string;
  createdAt: string;
}
interface Bank {
  linked: boolean;
  bankName?: string;
  bankAccountLast4?: string;
}

function DepositContent() {
  const router = useRouter();
  const [bank, setBank] = useState<Bank | null>(null);
  const [deposits, setDeposits] = useState<Deposit[]>([]);
  const [amount, setAmount] = useState('1000');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [b, d] = await Promise.all([apiClient.get('/plaid/bank-details'), apiClient.get('/plaid/deposits')]);
    setBank(b.data);
    setDeposits(d.data.deposits);
  }, []);
  useEffect(() => {
    refresh().catch(() => setBank({ linked: false }));
  }, [refresh]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const amountCents = Math.round(parseFloat(amount) * 100);
      const { data } = await apiClient.post('/plaid/deposit', { amountCents });
      setMessage(`✅ ${usd(data.amountCents)} deposit initiated — settles next business day.`);
      await refresh();
    } catch (err: unknown) {
      setMessage((err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message ?? 'Deposit failed');
    } finally {
      setBusy(false);
    }
  }

  const pending = deposits.filter((d) => d.status === 'PENDING');

  if (bank && !bank.linked) {
    return (
      <EmptyState
        icon="🏦"
        title="Link a bank first"
        description="You need a linked bank account before depositing."
        action={<button onClick={() => router.push('/link-bank')} className="btn-primary mt-2">Link a bank</button>}
      />
    );
  }

  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
      <form onSubmit={submit} className="card">
        <h2 className="text-lg font-bold">Add Money</h2>
        {bank?.bankName && (
          <p className="mt-1 text-sm text-[var(--subtext)]">From {bank.bankName} ****{bank.bankAccountLast4}</p>
        )}
        <div className="mt-5 flex items-center justify-center gap-1 text-3xl font-bold">
          <span className="text-[var(--subtext)]">$</span>
          <input
            type="number"
            min="1"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="w-40 border-b-2 border-[var(--border)] text-center outline-none focus:border-[var(--primary)]"
          />
        </div>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          {QUICK.map((q) => (
            <button key={q} type="button" onClick={() => setAmount(String(q))} className="rounded-full border border-[var(--border)] px-3 py-1 text-sm hover:bg-[var(--bg)]">
              ${q.toLocaleString()}
            </button>
          ))}
        </div>
        <p className="mt-4 text-center text-xs text-[var(--subtext)]">Funds settle next business day (T+1).</p>
        <button type="submit" disabled={busy} className="btn-primary mt-4 w-full">{busy ? 'Submitting…' : 'Add Money →'}</button>
        {message && <p className="mt-3 text-center text-sm text-[var(--text)]">{message}</p>}
      </form>

      <div className="card">
        <h2 className="text-lg font-bold">Pending Deposits</h2>
        {pending.length === 0 ? (
          <p className="mt-4 text-sm text-[var(--subtext)]">No pending deposits.</p>
        ) : (
          <div className="mt-4 space-y-3">
            {pending.map((d) => (
              <div key={d.id} className="rounded-lg border border-[var(--border)] p-4">
                <div className="text-lg font-semibold">{usd(d.amountCents)}</div>
                <div className="text-xs text-[var(--subtext)]">
                  Settling {new Date(d.settlementDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} · ACH
                </div>
                {simulateEnabled && (
                  <div className="mt-2 flex gap-2">
                    <button onClick={async () => { await apiClient.post('/test/plaid/settle', { depositId: d.id }); refresh(); }} className="btn-dev">⚡ Settle</button>
                    <button onClick={async () => { await apiClient.post('/test/plaid/bounce', { depositId: d.id, reason: 'NSF' }); refresh(); }} className="btn-dev">⚡ Bounce</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function DepositPage() {
  return (
    <RouteGuard requireAuth requireKYC>
      <AppShell>
        <h1 className="mb-6 text-2xl font-bold">Deposit</h1>
        <DepositContent />
      </AppShell>
    </RouteGuard>
  );
}
