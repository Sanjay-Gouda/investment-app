'use client';

import { useEffect, useState } from 'react';
import { apiClient } from '@/lib/api-client';
import { usd } from '@/components/shared/ui';

interface Account {
  accountId: string;
  email: string;
  fullName: string | null;
  portfolio: string | null;
  kycStatus: string;
  status: string;
  valueCents: string;
}

export default function AdviserAccounts() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  useEffect(() => {
    apiClient.get('/adviser/accounts').then(({ data }) => setAccounts(data.accounts)).catch(() => {});
  }, []);

  return (
    <>
      <h1 className="text-2xl font-bold">Accounts</h1>
      <div className="card mt-5 overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs text-[var(--subtext)]"><th className="pb-2">Name</th><th>Email</th><th>Portfolio</th><th>Value</th><th>KYC</th><th>Status</th></tr></thead>
          <tbody>
            {accounts.map((a) => (
              <tr key={a.accountId} className="border-t border-[var(--border)]">
                <td className="py-2">{a.fullName ?? '—'}</td>
                <td>{a.email}</td>
                <td>{a.portfolio ?? '—'}</td>
                <td>{usd(a.valueCents)}</td>
                <td>{a.kycStatus}</td>
                <td>{a.status}</td>
              </tr>
            ))}
            {accounts.length === 0 && <tr><td colSpan={6} className="py-3 text-[var(--subtext)]">No accounts.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
