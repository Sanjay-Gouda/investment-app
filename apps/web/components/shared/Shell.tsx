'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { Navbar } from './Navbar';
import { ProgressSteps } from './ui';

/** App chrome: top navbar + centered content container. */
export function AppShell({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  return (
    <>
      <Navbar />
      <main className={`mx-auto w-full px-6 py-8 ${wide ? 'max-w-[1200px]' : 'max-w-5xl'}`}>{children}</main>
    </>
  );
}

/** Focused onboarding chrome: Corgi logo + progress steps, centered card. */
export function OnboardingShell({ step, children }: { step: number; children: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-6 py-10">
      <Link href="/dashboard" className="mb-6 text-center text-xl font-bold text-[var(--primary)]">
        🐕 Corgi
      </Link>
      <ProgressSteps active={step} />
      {children}
    </main>
  );
}
