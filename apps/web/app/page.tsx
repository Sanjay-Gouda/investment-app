'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';

export default function HomePage() {
  const router = useRouter();
  const { loading, isAuthenticated, isAdviser } = useAuth();

  // Rule 6: already logged in → go to the app.
  useEffect(() => {
    if (!loading && isAuthenticated) router.replace(isAdviser ? '/adviser/dashboard' : '/dashboard');
  }, [loading, isAuthenticated, isAdviser, router]);

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center gap-6 px-6 text-center">
      <div className="text-4xl font-bold text-[var(--primary)]">🐕 Corgi</div>
      <h1 className="text-3xl font-bold sm:text-4xl">Smart investing for American businesses</h1>
      <p className="max-w-md text-[var(--subtext)]">
        Put idle business cash to work with professionally managed portfolios, a full audit trail, and tax reporting.
      </p>
      <div className="flex gap-3">
        <Link href="/register" className="btn-primary">Get started →</Link>
        <Link href="/login" className="btn-outline">Sign in</Link>
      </div>
    </main>
  );
}
