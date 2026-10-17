'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiClient } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';

const isDev = process.env.NODE_ENV !== 'production';

interface Deposit {
  id: string;
  amountCents: string;
  status: 'PENDING' | 'SETTLED' | 'RETURNED';
  settlementDate: string;
  createdAt: string;
  returnReason?: string | null;
}

function usd(cents: string | number): string {
  return `$${(Number(cents) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function DepositPage() {
  const router = useRouter();
  const { loading, isAuthenticated } = useAuth();
  const [bank, setBank] = useState<{ linked: boolean; bankName?: string; bankAccountLast4?: string } | null>(null);
  const [deposits, setDeposits] = useState<Deposit[]>([]);
  const [amount, setAmount] = useState('1000');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && !isAuthenticated) router.replace('/login');
  }, [loading, isAuthenticated, router]);

  const refresh = useCallback(async () => {
    const [b, d] = await Promise.all([
      apiClient.get('/plaid/bank-details'),
      apiClient.get('/plaid/deposits'),
    ]);
    setBank(b.data);
    setDeposits(d.data.deposits);
  }, []);

  useEffect(() => {
    if (isAuthenticated) refresh().catch(() => setBank({ linked: false }));
  }, [isAuthenticated, refresh]);

  async function submitDeposit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const amountCents = Math.round(parseFloat(amount) * 100);
      const { data } = await apiClient.post('/plaid/deposit', { amountCents });
      setMessage(
        `✅ ${usd(data.amountCents)} deposit initiated. Funds available after settlement. Status: Pending`,
      );
      await refresh();
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error
          ?.message ?? 'Deposit failed';
      setMessage(msg);
    } finally {
      setBusy(false);
    }
  }

  async function devSettle(id: string) {
    await apiClient.post('/test/plaid/settle', { depositId: id });
    await refresh();
  }
  async function devBounce(id: string) {
    await apiClient.post('/test/plaid/bounce', { depositId: id, reason: 'NSF' });
    await refresh();
  }

  if (loading) return <Centered>Loading…</Centered>;

  if (bank && !bank.linked) {
    return (
      <Centered>
        <div className="text-center">
          <p>You need to link a bank first.</p>
          <button
            onClick={() => router.push('/link-bank')}
            className="mt-3 rounded-md bg-corgi px-4 py-2 text-sm font-medium text-white hover:bg-corgi/90"
          >
            Link a bank
          </button>
        </div>
      </Centered>
    );
  }

  return (
    <main className="mx-auto min-h-screen max-w-2xl px-6 py-10">
      <h1 className="text-2xl font-semibold">Deposit funds</h1>
      {bank?.bankName && (
        <p className="mt-1 text-sm text-neutral-600">
          From {bank.bankName} ****{bank.bankAccountLast4}
        </p>
      )}

      <form onSubmit={submitDeposit} className="mt-6 flex items-end gap-3">
        <label className="block">
          <span className="mb-1 block text-sm font-medium">Amount (USD)</span>
          <input
            type="number"
            min="1"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="w-48 rounded-md border border-neutral-300 px-3 py-2 text-sm"
          />
        </label>
        <button
          type="submit"
          disabled={busy}
          className="rounded-md bg-corgi px-4 py-2 text-sm font-medium text-white hover:bg-corgi/90 disabled:opacity-50"
        >
          {busy ? 'Submitting…' : 'Deposit Funds'}
        </button>
      </form>

      {message && <p className="mt-4 text-sm text-neutral-700">{message}</p>}

      <h2 className="mt-10 text-lg font-semibold">Deposit history</h2>
      <table className="mt-3 w-full text-sm">
        <thead>
          <tr className="border-b text-left text-neutral-500">
            <th className="py-2">Date</th>
            <th>Amount</th>
            <th>Status</th>
            {isDev && <th>Dev actions</th>}
          </tr>
        </thead>
        <tbody>
          {deposits.length === 0 && (
            <tr>
              <td colSpan={isDev ? 4 : 3} className="py-3 text-neutral-500">
                No deposits yet.
              </td>
            </tr>
          )}
          {deposits.map((d) => (
            <tr key={d.id} className="border-b">
              <td className="py-2">{new Date(d.createdAt).toLocaleDateString('en-US')}</td>
              <td>{usd(d.amountCents)}</td>
              <td>
                <StatusBadge status={d.status} />
              </td>
              {isDev && (
                <td className="py-2">
                  {d.status === 'PENDING' ? (
                    <span className="flex gap-2">
                      <button onClick={() => devSettle(d.id)} className="rounded border px-2 py-1 text-xs hover:bg-neutral-50">
                        Simulate Settlement
                      </button>
                      <button onClick={() => devBounce(d.id)} className="rounded border px-2 py-1 text-xs hover:bg-neutral-50">
                        Simulate Bounce (NSF)
                      </button>
                    </span>
                  ) : (
                    <span className="text-xs text-neutral-400">—</span>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}

function StatusBadge({ status }: { status: string }) {
  const color =
    status === 'SETTLED'
      ? 'bg-green-100 text-green-800'
      : status === 'RETURNED'
        ? 'bg-red-100 text-red-800'
        : 'bg-amber-100 text-amber-800';
  return <span className={`rounded px-2 py-0.5 text-xs font-medium ${color}`}>{status}</span>;
}

function Centered({ children }: { children: React.ReactNode }) {
  return <main className="flex min-h-screen items-center justify-center text-sm text-neutral-600">{children}</main>;
}
