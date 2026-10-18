'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { loadStripe } from '@stripe/stripe-js';
import { apiClient } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { RouteGuard } from '@/components/shared/RouteGuard';
import { OnboardingShell } from '@/components/shared/Shell';

const simulateEnabled = process.env.NEXT_PUBLIC_ENABLE_SIMULATE === 'true';
const stripePk = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;

function KycContent() {
  const router = useRouter();
  const { account, refreshUser } = useAuth();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [started, setStarted] = useState(false);
  const status = account?.kycStatus ?? 'PENDING';

  async function verify() {
    setBusy(true);
    setMessage(null);
    try {
      const { data } = await apiClient.post('/kyc/start');
      setStarted(true);
      if (stripePk && data.clientSecret) {
        const stripe = await loadStripe(stripePk);
        const res = await stripe?.verifyIdentity(data.clientSecret);
        if (res?.error) setMessage(res.error.message ?? 'Could not open verification.');
      } else {
        setMessage('Verification session created (configure Stripe key for the modal).');
      }
      await refreshUser();
    } catch {
      setMessage('Could not start verification.');
    } finally {
      setBusy(false);
    }
  }

  async function simulate() {
    setBusy(true);
    try {
      await apiClient.post('/kyc/simulate-approve');
      await refreshUser();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card text-center">
      {status === 'APPROVED' ? (
        <>
          <div className="text-4xl">✅</div>
          <h1 className="mt-2 text-xl font-bold">Identity Verified!</h1>
          <button onClick={() => router.push('/link-bank')} className="btn-primary mt-4 w-full">
            Continue to Link Bank →
          </button>
        </>
      ) : status === 'REJECTED' ? (
        <>
          <div className="text-4xl">❌</div>
          <h1 className="mt-2 text-xl font-bold">Verification Failed</h1>
          <p className="mt-1 text-sm text-[var(--subtext)]">Please contact support@corgi.com</p>
        </>
      ) : started ? (
        <>
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-[var(--primary-light)] border-t-[var(--primary)]" />
          <h1 className="mt-3 text-lg font-bold">Verification in progress…</h1>
          <p className="mt-1 text-sm text-[var(--subtext)]">We&apos;ll update your status automatically.</p>
        </>
      ) : (
        <>
          <div className="text-4xl">🔐</div>
          <h1 className="mt-2 text-xl font-bold">Verify Your Identity</h1>
          <p className="mt-1 text-sm text-[var(--subtext)]">Required by US regulations before investing.</p>
          <div className="mt-4 rounded-lg bg-[var(--primary-light)] p-3 text-left text-sm text-[var(--text)]">
            Takes less than 2 minutes. You&apos;ll need a government-issued ID.
          </div>
          <button onClick={verify} disabled={busy} className="btn-primary mt-4 w-full">
            {busy ? 'Starting…' : '🔐 Verify My Identity'}
          </button>
        </>
      )}

      {message && <p className="mt-3 text-sm text-[var(--subtext)]">{message}</p>}

      {simulateEnabled && status !== 'APPROVED' && (
        <button onClick={simulate} disabled={busy} className="btn-dev mt-3 w-full">
          ⚡ Simulate Approval (Dev Only)
        </button>
      )}
    </div>
  );
}

export default function KycPage() {
  return (
    <RouteGuard requireAuth>
      <OnboardingShell step={1}>
        <KycContent />
      </OnboardingShell>
    </RouteGuard>
  );
}
