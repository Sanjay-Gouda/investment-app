'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { loadStripe } from '@stripe/stripe-js';
import { apiClient } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';

const isDev = process.env.NODE_ENV !== 'production';
const stripePk = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;

export default function KycPage() {
  const router = useRouter();
  const { account, loading, isAuthenticated, refresh } = useAuth();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [sessionStarted, setSessionStarted] = useState(false);

  useEffect(() => {
    if (!loading && !isAuthenticated) router.replace('/login');
  }, [loading, isAuthenticated, router]);

  if (loading) return <Centered>Loading…</Centered>;
  if (!account) return <Centered>No account found.</Centered>;

  const status = account.kycStatus;

  async function startVerification() {
    setBusy(true);
    setMessage(null);
    try {
      const { data } = await apiClient.post('/kyc/start');
      setSessionStarted(true);
      if (stripePk && data.clientSecret) {
        const stripe = await loadStripe(stripePk);
        const result = await stripe?.verifyIdentity(data.clientSecret);
        if (result?.error) setMessage(result.error.message ?? 'Verification could not be opened.');
      } else {
        setMessage('Verification session created. (Stripe key not configured for the modal.)');
      }
      await refresh();
    } catch {
      setMessage('Could not start verification. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function simulateApproval() {
    setBusy(true);
    setMessage(null);
    try {
      await apiClient.post('/kyc/simulate-approve');
      await refresh();
    } catch {
      setMessage('Simulation failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center gap-6 px-6">
      <div>
        <h1 className="text-2xl font-semibold">Identity verification</h1>
        <p className="mt-1 text-sm text-neutral-600">
          Status: <StatusBadge status={status} />
        </p>
      </div>

      {status === 'APPROVED' && (
        <div className="rounded-lg border border-green-200 bg-green-50 p-4">
          <p className="text-lg font-medium text-green-800">Identity Verified ✅</p>
          <button
            onClick={() => router.push('/link-bank')}
            className="mt-3 rounded-md bg-corgi px-4 py-2 text-sm font-medium text-white hover:bg-corgi/90"
          >
            Continue to Link Bank
          </button>
        </div>
      )}

      {status === 'REJECTED' && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4">
          <p className="text-lg font-medium text-red-800">Verification Failed ✕</p>
          <p className="mt-1 text-sm text-red-700">Please contact support.</p>
        </div>
      )}

      {status === 'PENDING' && !sessionStarted && (
        <div className="rounded-lg border p-4">
          <p className="text-sm text-neutral-700">
            You will need your government-issued ID (driver&apos;s license or passport).
          </p>
          <button
            onClick={startVerification}
            disabled={busy}
            className="mt-3 rounded-md bg-corgi px-4 py-2 text-sm font-medium text-white hover:bg-corgi/90 disabled:opacity-50"
          >
            {busy ? 'Starting…' : 'Verify My Identity'}
          </button>
        </div>
      )}

      {status === 'PENDING' && sessionStarted && (
        <div className="rounded-lg border p-4">
          <p className="font-medium">Verification in progress…</p>
          <p className="mt-1 text-sm text-neutral-600">We will notify you when complete.</p>
        </div>
      )}

      {message && <p className="text-sm text-neutral-600">{message}</p>}

      {isDev && status !== 'APPROVED' && (
        <button
          onClick={simulateApproval}
          disabled={busy}
          className="rounded-md border border-dashed border-neutral-400 px-4 py-2 text-sm text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
        >
          Simulate KYC Approval (Dev Only)
        </button>
      )}
    </main>
  );
}

function StatusBadge({ status }: { status: string }) {
  const color =
    status === 'APPROVED'
      ? 'bg-green-100 text-green-800'
      : status === 'REJECTED'
        ? 'bg-red-100 text-red-800'
        : 'bg-amber-100 text-amber-800';
  return <span className={`rounded px-2 py-0.5 text-xs font-medium ${color}`}>{status}</span>;
}

function Centered({ children }: { children: React.ReactNode }) {
  return <main className="flex min-h-screen items-center justify-center text-sm text-neutral-600">{children}</main>;
}
