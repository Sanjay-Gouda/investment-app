'use client';

import { useEffect, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth, type Role } from '@/lib/auth-context';
import { LoadingSpinner } from './LoadingSpinner';

/**
 * Client-side route protection. Order of checks:
 *  1. loading → spinner (prevents content flash)
 *  2. requireAuth + !authenticated → save intended URL → /login
 *  3. requireKYC + kyc !== APPROVED → /kyc
 *  4. requireRole ADVISER + not adviser → /dashboard
 */
export function RouteGuard({
  children,
  requireAuth = true,
  requireKYC = false,
  requireRole,
}: {
  children: ReactNode;
  requireAuth?: boolean;
  requireKYC?: boolean;
  requireRole?: Role;
}) {
  const router = useRouter();
  const { loading, isAuthenticated, account, isAdviser } = useAuth();

  const needLogin = requireAuth && !isAuthenticated;
  const needKYC = requireKYC && account?.kycStatus !== 'APPROVED';
  const needRole = requireRole === 'ADVISER' && !isAdviser;

  useEffect(() => {
    if (loading) return;
    if (needLogin) {
      try {
        sessionStorage.setItem('corgi_intended', window.location.pathname);
      } catch {
        /* ignore */
      }
      router.replace('/login');
    } else if (needKYC) {
      router.replace('/kyc');
    } else if (needRole) {
      router.replace('/dashboard');
    }
  }, [loading, needLogin, needKYC, needRole, router]);

  if (loading || needLogin || needKYC || needRole) return <LoadingSpinner />;
  return <>{children}</>;
}

export default RouteGuard;
