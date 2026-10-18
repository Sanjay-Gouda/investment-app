'use client';

import type { ReactNode } from 'react';

/** Split auth layout: indigo brand panel (left) + centered form card (right). */
export function AuthSplit({
  heading,
  subheading,
  children,
}: {
  heading: string;
  subheading?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <div
        className="flex flex-col justify-center gap-6 px-8 py-12 text-white md:w-1/2 md:px-14"
        style={{ background: 'linear-gradient(135deg, #4f46e5 0%, #6d28d9 100%)' }}
      >
        <div className="text-3xl font-bold">🐕 Corgi</div>
        <h1 className="max-w-sm text-3xl font-bold leading-tight">Smart investing for American businesses</h1>
        <ul className="space-y-3 text-sm text-indigo-100">
          <li>✓ Instantly invest idle business cash</li>
          <li>✓ Professional portfolio management</li>
          <li>✓ Full audit trail &amp; tax reporting</li>
        </ul>
      </div>

      <div className="flex flex-1 items-center justify-center bg-white px-6 py-12">
        <div className="w-full max-w-sm">
          <h2 className="text-2xl font-bold">{heading}</h2>
          {subheading && <p className="mb-6 mt-1 text-sm text-[var(--subtext)]">{subheading}</p>}
          {children}
        </div>
      </div>
    </div>
  );
}

export default AuthSplit;
