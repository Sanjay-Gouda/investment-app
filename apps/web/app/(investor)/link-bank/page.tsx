'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { usePlaidLink } from 'react-plaid-link';
import { apiClient } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { RouteGuard } from '@/components/shared/RouteGuard';
import { OnboardingShell } from '@/components/shared/Shell';

const simulateEnabled = process.env.NEXT_PUBLIC_ENABLE_SIMULATE === 'true';

interface Bank {
  linked: boolean;
  bankName?: string;
  bankAccountLast4?: string;
}

function LinkBankContent() {
  const router = useRouter();
  const { user } = useAuth();
  const [bank, setBank] = useState<Bank | null>(null);
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const loadBank = useCallback(async () => {
    const { data } = await apiClient.get<Bank>('/plaid/bank-details');
    setBank(data);
  }, []);
  useEffect(() => {
    loadBank().catch(() => setBank({ linked: false }));
  }, [loadBank]);

  const onSuccess = useCallback(
    async (publicToken: string | null) => {
      if (!publicToken) return;
      setBusy(true);
      try {
        await apiClient.post('/plaid/exchange-token', { publicToken });
        await loadBank();
        router.push('/deposit');
      } catch {
        setMessage('Could not link your bank.');
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

  async function connect() {
    setBusy(true);
    setMessage(null);
    try {
      const { data } = await apiClient.post<{ linkToken: string }>('/plaid/link-token');
      setLinkToken(data.linkToken);
    } catch {
      setMessage('Could not start bank linking. Use the dev option below.');
    } finally {
      setBusy(false);
    }
  }

  async function simulate() {
    setBusy(true);
    try {
      await apiClient.post('/test/plaid/simulate-link', { email: user?.email });
      await loadBank();
      router.push('/deposit');
    } finally {
      setBusy(false);
    }
  }

  if (!bank) return <div className="card text-center text-sm text-[var(--subtext)]">Loading…</div>;

  return (
    <div className="card text-center">
      <div className="text-4xl">🏦</div>
      <h1 className="mt-2 text-xl font-bold">Connect Your Bank</h1>
      <p className="mt-1 text-sm text-[var(--subtext)]">Securely link your bank to deposit funds.</p>

      {bank.linked ? (
        <>
          <div className="mt-4 rounded-lg bg-[var(--success-light)] p-3 text-sm font-medium text-[var(--success)]">
            ✅ {bank.bankName} ****{bank.bankAccountLast4} connected
          </div>
          <button onClick={() => router.push('/deposit')} className="btn-primary mt-4 w-full">Continue to Deposit →</button>
          <button onClick={connect} className="mt-2 w-full text-sm text-[var(--subtext)] hover:underline">Change Bank</button>
        </>
      ) : (
        <>
          <button onClick={connect} disabled={busy} className="btn-primary mt-4 w-full">
            {busy ? 'Working…' : '🏦 Connect Bank Account'}
          </button>
          <p className="mt-2 text-xs text-[var(--subtext)]">Powered by Plaid — bank-level security</p>
          {simulateEnabled && (
            <button onClick={simulate} disabled={busy} className="btn-dev mt-3 w-full">⚡ Simulate Bank Link (Dev Only)</button>
          )}
        </>
      )}
      {message && <p className="mt-3 text-sm text-[var(--subtext)]">{message}</p>}
    </div>
  );
}

export default function LinkBankPage() {
  return (
    <RouteGuard requireAuth requireKYC>
      <OnboardingShell step={2}>
        <LinkBankContent />
      </OnboardingShell>
    </RouteGuard>
  );
}
