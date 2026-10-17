'use client';

import type { ReactNode } from 'react';
import { AuthProvider } from '@/lib/auth-context';

/** Client-side providers wrapper (auth today; add React Query etc. here later). */
export function Providers({ children }: { children: ReactNode }) {
  return <AuthProvider>{children}</AuthProvider>;
}

export default Providers;
