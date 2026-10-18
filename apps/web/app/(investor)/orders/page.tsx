'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiClient } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';

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

function usd(cents: string | null): string {
  if (cents == null) return '—';
  return `$${(Number(cents) / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
}

export default function OrdersPage() {
  const router = useRouter();
  const { loading, isAuthenticated } = useAuth();
  const [orders, setOrders] = useState<Order[]>([]);

  useEffect(() => {
    if (!loading && !isAuthenticated) router.replace('/login');
  }, [loading, isAuthenticated, router]);

  useEffect(() => {
    if (isAuthenticated) apiClient.get('/portfolio/orders').then(({ data }) => setOrders(data.orders)).catch(() => {});
  }, [isAuthenticated]);

  return (
    <main className="mx-auto min-h-screen max-w-3xl px-6 py-10">
      <h1 className="text-2xl font-semibold">Orders</h1>
      <table className="mt-6 w-full text-sm">
        <thead>
          <tr className="border-b text-left text-neutral-500">
            <th className="py-2">Symbol</th>
            <th>Side</th>
            <th>Units</th>
            <th>Avg Price</th>
            <th>Status</th>
            <th>Date</th>
          </tr>
        </thead>
        <tbody>
          {orders.length === 0 && (
            <tr>
              <td colSpan={6} className="py-3 text-neutral-500">
                No orders yet.
              </td>
            </tr>
          )}
          {orders.map((o) => (
            <tr key={o.id} className="border-b">
              <td className="py-2 font-medium">{o.symbol}</td>
              <td>{o.side}</td>
              <td>{o.filledUnits ?? o.requestedUnits ?? '—'}</td>
              <td>{usd(o.filledAvgPriceCents)}</td>
              <td>
                <span
                  className={`rounded px-2 py-0.5 text-xs font-medium ${
                    o.status === 'FILLED'
                      ? 'bg-green-100 text-green-800'
                      : o.status === 'REJECTED' || o.status === 'CANCELLED'
                        ? 'bg-red-100 text-red-800'
                        : 'bg-amber-100 text-amber-800'
                  }`}
                >
                  {o.status}
                </span>
              </td>
              <td>{new Date(o.createdAt).toLocaleDateString('en-US')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
