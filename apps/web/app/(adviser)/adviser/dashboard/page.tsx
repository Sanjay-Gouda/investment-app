'use client';

import { useEffect, useState } from 'react';
import { apiClient } from '@/lib/api-client';
import { StatCard, usd } from '@/components/shared/ui';

interface Overview {
  aumCents: string;
  activeAccounts: number;
  openBreaks: number;
}
interface Account {
  accountId: string;
  email: string;
  portfolio: string | null;
  kycStatus: string;
  status: string;
  valueCents: string;
}

export default function AdviserDashboard() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);

  useEffect(() => {
    apiClient.get('/adviser/overview').then(({ data }) => setOverview(data)).catch(() => {});
    apiClient.get('/adviser/accounts').then(({ data }) => setAccounts(data.accounts)).catch(() => {});
  }, []);

  return (
    <>
      <h1 className="text-2xl font-bold">Overview</h1>
      <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Total AUM" value={usd(overview?.aumCents ?? 0)} />
        <StatCard label="Active Accounts" value={String(overview?.activeAccounts ?? 0)} />
        <StatCard label="Open Breaks" value={String(overview?.openBreaks ?? 0)} subValue={overview?.openBreaks ? '🔴 needs attention' : '✅ clear'} accent={overview?.openBreaks ? 'danger' : undefined} />
      </div>

      <div className="card mt-6">
        <h2 className="mb-3 text-sm font-bold">All Accounts</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-[var(--subtext)]"><th className="pb-2">Email</th><th>Portfolio</th><th>Value</th><th>KYC</th><th>Status</th></tr></thead>
            <tbody>
              {accounts.map((a) => (
                <tr key={a.accountId} className="border-t border-[var(--border)]">
                  <td className="py-2">{a.email}</td>
                  <td>{a.portfolio ?? '—'}</td>
                  <td>{usd(a.valueCents)}</td>
                  <td>{a.kycStatus}</td>
                  <td>{a.status === 'ACTIVE' ? '✅ Active' : a.status}</td>
                </tr>
              ))}
              {accounts.length === 0 && <tr><td colSpan={5} className="py-3 text-[var(--subtext)]">No accounts.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
