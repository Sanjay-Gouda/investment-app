'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';

const LINKS = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/portfolio', label: 'Portfolio' },
  { href: '/transactions', label: 'Transactions' },
  { href: '/orders', label: 'Orders' },
];

export function Navbar() {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 border-b border-[var(--border)] bg-white">
      <div className="mx-auto flex h-16 max-w-[1200px] items-center justify-between px-6">
        <Link href="/dashboard" className="text-xl font-bold text-[var(--primary)]">
          🐕 Corgi
        </Link>

        <nav className="hidden items-center gap-1 sm:flex">
          {LINKS.map((l) => {
            const active = pathname === l.href;
            return (
              <Link
                key={l.href}
                href={l.href}
                className={`rounded-md px-3 py-2 text-sm font-medium ${
                  active ? 'text-[var(--primary)]' : 'text-[var(--subtext)] hover:text-[var(--text)]'
                }`}
                style={active ? { borderBottom: '2px solid var(--primary)', borderRadius: 0 } : undefined}
              >
                {l.label}
              </Link>
            );
          })}
        </nav>

        <div className="relative">
          <button
            onClick={() => setOpen((o) => !o)}
            className="flex items-center gap-1 text-sm text-[var(--text)]"
          >
            <span className="hidden max-w-[160px] truncate sm:inline">{user?.email}</span>
            <span className="text-[var(--subtext)]">▾</span>
          </button>
          {open && (
            <div
              className="absolute right-0 mt-2 w-40 rounded-lg border border-[var(--border)] bg-white py-1 shadow-lg"
              onMouseLeave={() => setOpen(false)}
            >
              <div className="px-3 py-2 text-xs text-[var(--subtext)] sm:hidden">{user?.email}</div>
              <button
                onClick={logout}
                className="block w-full px-3 py-2 text-left text-sm text-[var(--danger)] hover:bg-[var(--bg)]"
              >
                Log out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

export default Navbar;
