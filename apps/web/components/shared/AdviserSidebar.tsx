'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { apiClient } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';

const ITEMS = [
  { href: '/adviser/dashboard', label: 'Overview', icon: '📊' },
  { href: '/adviser/accounts', label: 'Accounts', icon: '👥' },
  { href: '/adviser/approvals', label: 'Approvals', icon: '✅', badge: 'approvals' },
  { href: '/adviser/reconciliation', label: 'Reconciliation', icon: '🔄', badge: 'breaks' },
  { href: '/adviser/restatements', label: 'Restatements', icon: '📝' },
];

export function AdviserSidebar() {
  const pathname = usePathname();
  const { logout } = useAuth();
  const [badges, setBadges] = useState<{ approvals?: number; breaks?: number }>({});

  useEffect(() => {
    apiClient.get('/reconciliation/summary').then(({ data }) => setBadges((b) => ({ ...b, breaks: data.totalOpen }))).catch(() => {});
    apiClient.get('/adviser/approvals').then(({ data }) => setBadges((b) => ({ ...b, approvals: data.approvals?.length }))).catch(() => {});
  }, [pathname]);

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-[var(--border)] bg-white">
      <div className="border-b border-[var(--border)] px-5 py-4">
        <div className="text-lg font-bold text-[var(--primary)]">🐕 Corgi</div>
        <div className="text-xs text-[var(--subtext)]">Adviser Console</div>
      </div>
      <nav className="flex-1 p-3">
        {ITEMS.map((it) => {
          const active = pathname === it.href;
          const badge = it.badge ? badges[it.badge as 'approvals' | 'breaks'] : undefined;
          return (
            <Link
              key={it.href}
              href={it.href}
              className={`mb-1 flex items-center justify-between rounded-lg px-3 py-2 text-sm ${
                active ? 'bg-[var(--primary-light)] font-medium text-[var(--primary)]' : 'text-[var(--text)] hover:bg-[var(--bg)]'
              }`}
            >
              <span>
                {it.icon} {it.label}
              </span>
              {badge ? (
                <span className="rounded-full bg-[var(--danger)] px-1.5 py-0.5 text-[10px] font-semibold text-white">{badge}</span>
              ) : null}
            </Link>
          );
        })}
      </nav>
      <button onClick={logout} className="m-3 rounded-lg px-3 py-2 text-left text-sm text-[var(--danger)] hover:bg-[var(--bg)]">
        Log out
      </button>
    </aside>
  );
}

export default AdviserSidebar;
