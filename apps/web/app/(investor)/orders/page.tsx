'use client';

import { useEffect, useState } from 'react';
import { apiClient } from '@/lib/api-client';
import { RouteGuard } from '@/components/shared/RouteGuard';
import { AppShell } from '@/components/shared/Shell';
import { usd } from '@/components/shared/ui';

interface Order {
  id: string;
  symbol: string;
  side: string;
  requestedUnits: string | null;
  filledUnits: string | null;
  filledAvgPriceCents: string | null;
  status: string;
  createdAt: string;
}

function OrdersContent() {
  const [orders, setOrders] = useState<Order[]>([]);
  useEffect(() => {
    apiClient.get('/portfolio/orders').then(({ data }) => setOrders(data.orders)).catch(() => {});
  }, []);

  const badge = (s: string) =>
    s === 'FILLED' ? 'bg-[var(--success-light)] text-[var(--success)]' : s === 'REJECTED' || s === 'CANCELLED' ? 'bg-[var(--danger-light)] text-[var(--danger)]' : 'bg-[#FFFBEB] text-[var(--warning)]';

  return (
    <>
      <h1 className="mb-6 text-2xl font-bold">Orders</h1>
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-[var(--subtext)]"><th className="pb-2">Symbol</th><th>Side</th><th>Units</th><th>Avg Price</th><th>Status</th><th>Date</th></tr>
          </thead>
          <tbody>
            {orders.length === 0 && <tr><td colSpan={6} className="py-3 text-[var(--subtext)]">No orders yet.</td></tr>}
            {orders.map((o) => (
              <tr key={o.id} className="border-t border-[var(--border)]">
                <td className="py-2 font-medium">{o.symbol}</td>
                <td>{o.side}</td>
                <td>{o.filledUnits ?? o.requestedUnits ?? '—'}</td>
                <td>{o.filledAvgPriceCents ? usd(o.filledAvgPriceCents) : '—'}</td>
                <td><span className={`rounded px-2 py-0.5 text-xs font-medium ${badge(o.status)}`}>{o.status}</span></td>
                <td>{new Date(o.createdAt).toLocaleDateString('en-US')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export default function OrdersPage() {
  return (
    <RouteGuard requireAuth requireKYC>
      <AppShell>
        <OrdersContent />
      </AppShell>
    </RouteGuard>
  );
}
