'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiClient } from '@/lib/api-client';
import { EmptyState, usd } from '@/components/shared/ui';

const simulateEnabled = process.env.NEXT_PUBLIC_ENABLE_SIMULATE === 'true';

interface Approval {
  id: string;
  type: string;
  status: string;
  createdAt: string;
  payload: {
    portfolio?: string;
    action?: string;
    requestedBy?: string;
    trades?: { side: string; symbol: string; estCents: number }[];
  };
}

export default function AdviserApprovals() {
  const [items, setItems] = useState<Approval[]>([]);

  const load = useCallback(async () => {
    const { data } = await apiClient.get('/adviser/approvals');
    setItems(data.approvals ?? []);
  }, []);
  useEffect(() => {
    load().catch(() => {});
  }, [load]);

  async function act(id: string, action: 'approve' | 'reject') {
    await apiClient.post(`/adviser/approvals/${id}/${action}`).catch(() => {});
    await load();
  }

  return (
    <>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Pending Approvals</h1>
        {simulateEnabled && (
          <button onClick={async () => { await apiClient.post('/test/adviser/seed-approval'); load(); }} className="btn-dev">⚡ Seed approval (Dev)</button>
        )}
      </div>

      {items.length === 0 ? (
        <div className="mt-6"><EmptyState icon="✅" title="No pending approvals" /></div>
      ) : (
        <div className="mt-6 space-y-4">
          {items.map((a) => (
            <div key={a.id} className="card">
              <div className="flex items-center justify-between">
                <span className="font-semibold">{a.type}</span>
                <span className="text-xs text-[var(--subtext)]">{new Date(a.createdAt).toLocaleString('en-US')}</span>
              </div>
              <p className="mt-2 text-sm">Requested by: {a.payload?.requestedBy ?? '—'}</p>
              {a.payload?.action && <p className="text-sm">Action: {a.payload.action}</p>}
              {a.payload?.portfolio && <p className="text-sm">Portfolio: {a.payload.portfolio}</p>}
              {a.payload?.trades && (
                <div className="mt-2 text-sm">
                  <p className="text-xs text-[var(--subtext)]">Estimated trades:</p>
                  {a.payload.trades.map((t, i) => (
                    <p key={i}>{t.side} {t.symbol} ~{usd(t.estCents)}</p>
                  ))}
                </div>
              )}
              <div className="mt-4 flex gap-2">
                <button onClick={() => act(a.id, 'reject')} className="btn-outline flex-1">❌ Reject</button>
                <button onClick={() => act(a.id, 'approve')} className="btn-primary flex-1">✅ Approve</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
