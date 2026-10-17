'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { usePlaidLink } from 'react-plaid-link';
import { apiClient } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';

const isDev = process.env.NODE_ENV !== 'production';

interface BankDetails {
  linked: boolean;
  bankName?: string;
  bankAccountLast4?: string;
}

export default function LinkBankPage() {
  const router = useRouter();
  const { user, loading, isAuthenticated } = useAuth();
  const [bank, setBank] = useState<BankDetails | null>(null);
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && !isAuthenticated) router.replace('/login');
  }, [loading, isAuthenticated, router]);

  const loadBank = useCallback(async () => {
    const { data } = await apiClient.get<BankDetails>('/plaid/bank-details');
    setBank(data);
  }, []);

  useEffect(() => {
    if (isAuthenticated) loadBank().catch(() => setBank({ linked: false }));
  }, [isAuthenticated, loadBank]);

  // Plaid Link (real flow). Opens once we have a link token.
  const onSuccess = useCallback(
    async (publicToken: string | null) => {
      if (!publicToken) return;
      setBusy(true);
      try {
        await apiClient.post('/plaid/exchange-token', { publicToken });
        await loadBank();
        router.push('/deposit');
      } catch {
        setMessage('Could not link your bank. Please try again.');
      } finally {
        setBusy(false);
      }
    },
    [loadBank, router],
  );

  const { open, ready } = usePlaidLink({ token: linkToken, onSuccess });

  useEffect(() => {
    if (linkToken && ready) open();
  }, [linkToken, ready, open]);

  async function connectBank() {
    setBusy(true);
    setMessage(null);
    try {
      const { data } = await apiClient.post<{ linkToken: string }>('/plaid/link-token');
      setLinkToken(data.linkToken);
    } catch {
      setMessage('Could not start bank linking. Use the dev simulate option below.');
    } finally {
      setBusy(false);
    }
  }

  async function simulateLink() {
    setBusy(true);
    setMessage(null);
    try {
      await apiClient.post('/test/plaid/simulate-link', { email: user?.email });
      await loadBank();
      router.push('/deposit');
    } catch {
      setMessage('Simulate link failed.');
    } finally {
      setBusy(false);
    }
  }

  if (loading || !bank) return <Centered>Loading…</Centered>;

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center gap-6 px-6">
      <h1 className="text-2xl font-semibold">Link your bank</h1>

      {bank.linked ? (
        <div className="rounded-lg border border-green-200 bg-green-50 p-4">
          <p className="font-medium text-green-800">
            {bank.bankName} ****{bank.bankAccountLast4} ✅
          </p>
          <div className="mt-3 flex gap-3">
            <button
              onClick={() => router.push('/deposit')}
              className="rounded-md bg-corgi px-4 py-2 text-sm font-medium text-white hover:bg-corgi/90"
            >
              Continue to Deposit
            </button>
            <button
              onClick={connectBank}
              disabled={busy}
              className="rounded-md border px-4 py-2 text-sm hover:bg-neutral-50 disabled:opacity-50"
            >
              Change Bank
            </button>
          </div>
        </div>
      ) : (
        <div className="rounded-lg border p-4">
          <p className="text-sm text-neutral-700">Connect your bank account to fund your account.</p>
          <button
            onClick={connectBank}
            disabled={busy}
            className="mt-3 rounded-md bg-corgi px-4 py-2 text-sm font-medium text-white hover:bg-corgi/90 disabled:opacity-50"
          >
            {busy ? 'Working…' : 'Connect Bank'}
          </button>
        </div>
      )}

      {message && <p className="text-sm text-neutral-600">{message}</p>}

      {isDev && !bank.linked && (
        <button
          onClick={simulateLink}
          disabled={busy}
          className="rounded-md border border-dashed border-neutral-400 px-4 py-2 text-sm text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
        >
          Simulate Bank Link (Dev Only)
        </button>
      )}
    </main>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <main className="flex min-h-screen items-center justify-center text-sm text-neutral-600">{children}</main>;
}
