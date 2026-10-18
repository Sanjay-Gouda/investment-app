'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiClient } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';

interface Model {
  type: string;
  name: string;
  description: string;
  riskLevel: string;
  expectedReturn: string;
  weights: Record<string, number>;
}

const DOT: Record<string, string> = {
  CONSERVATIVE: '🟢',
  MODERATE: '🔵',
  GROWTH: '🟣',
  AGGRESSIVE: '🔴',
};

export default function PortfolioPage() {
  const router = useRouter();
  const { loading, isAuthenticated } = useAuth();
  const [models, setModels] = useState<Model[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && !isAuthenticated) router.replace('/login');
  }, [loading, isAuthenticated, router]);

  const load = useCallback(async () => {
    const { data } = await apiClient.get('/portfolio/models');
    setModels(data.models);
  }, []);
  useEffect(() => {
    load().catch(() => setModels([]));
  }, [load]);

  async function select(type: string) {
    setBusy(type);
    setMessage('Placing orders…');
    try {
      await apiClient.post('/portfolio/invest', { portfolioType: type });
      setMessage('Orders placed! Your portfolio is being built.');
      setTimeout(() => router.push('/dashboard'), 800);
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error
          ?.message ?? 'Could not place orders';
      setMessage(msg);
      setBusy(null);
    }
  }

  return (
    <main className="mx-auto min-h-screen max-w-4xl px-6 py-10">
      <h1 className="text-2xl font-semibold">Choose a model portfolio</h1>
      <p className="mt-1 text-sm text-neutral-600">A 10% cash buffer is always kept uninvested.</p>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {models.map((m) => (
          <div key={m.type} className="flex flex-col rounded-lg border p-5">
            <div className="text-lg font-semibold">
              {DOT[m.type]} {m.name}
            </div>
            <div className="text-xs uppercase tracking-wide text-neutral-500">{m.riskLevel} risk</div>
            <p className="mt-2 text-sm text-neutral-600">{m.description}</p>
            <div className="mt-3 text-sm">
              {Object.entries(m.weights)
                .map(([s, w]) => `${s} ${Math.round(w * 100)}%`)
                .join(' · ')}{' '}
              · Cash 10%
            </div>
            <div className="mt-1 text-sm text-neutral-500">Expected: {m.expectedReturn}</div>
            <button
              onClick={() => select(m.type)}
              disabled={!!busy}
              className="mt-4 rounded-md bg-corgi px-4 py-2 text-sm font-medium text-white hover:bg-corgi/90 disabled:opacity-50"
            >
              {busy === m.type ? 'Placing…' : 'Select This'}
            </button>
          </div>
        ))}
      </div>

      {message && <p className="mt-4 text-sm text-neutral-700">{message}</p>}
    </main>
  );
}
