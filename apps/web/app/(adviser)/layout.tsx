'use client';

import type { ReactNode } from 'react';
import { RouteGuard } from '@/components/shared/RouteGuard';
import { AdviserSidebar } from '@/components/shared/AdviserSidebar';

export default function AdviserLayout({ children }: { children: ReactNode }) {
  return (
    <RouteGuard requireAuth requireKYC requireRole="ADVISER">
      <div className="flex min-h-screen">
        <AdviserSidebar />
        <main className="flex-1 overflow-x-auto p-8">{children}</main>
      </div>
    </RouteGuard>
  );
}
