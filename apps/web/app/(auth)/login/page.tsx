'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Eye, EyeOff } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { AuthSplit } from '@/components/shared/AuthSplit';

const schema = z.object({ email: z.string().email('Enter a valid email'), password: z.string().min(1, 'Required') });
type FormValues = z.infer<typeof schema>;

export default function LoginPage() {
  const router = useRouter();
  const { login, loading, isAuthenticated, isAdviser } = useAuth();
  const [serverError, setServerError] = useState<string | null>(null);
  const [showPw, setShowPw] = useState(false);
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<FormValues>({ resolver: zodResolver(schema) });

  useEffect(() => {
    if (!loading && isAuthenticated) router.replace(isAdviser ? '/adviser/dashboard' : '/dashboard');
  }, [loading, isAuthenticated, isAdviser, router]);

  const onSubmit = async (v: FormValues) => {
    setServerError(null);
    try {
      const { account, user } = await login(v.email, v.password);
      if (user.role === 'ADVISER') router.push('/adviser/dashboard');
      else router.push(account.kycStatus === 'APPROVED' ? '/dashboard' : '/kyc');
    } catch (err: unknown) {
      setServerError((err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message ?? 'Sign in failed');
    }
  };

  return (
    <AuthSplit heading="Welcome back" subheading="Sign in to your Corgi account.">
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <label className="block">
          <span className="mb-1 block text-sm font-medium">Email</span>
          <input className="field-input" type="email" autoComplete="email" {...register('email')} />
          {errors.email && <span className="mt-1 block text-xs text-[var(--danger)]">{errors.email.message}</span>}
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium">Password</span>
          <div className="relative">
            <input className="field-input pr-10" type={showPw ? 'text' : 'password'} autoComplete="current-password" {...register('password')} />
            <button type="button" onClick={() => setShowPw((s) => !s)} className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--subtext)]">
              {showPw ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
          {errors.password && <span className="mt-1 block text-xs text-[var(--danger)]">{errors.password.message}</span>}
        </label>
        {serverError && <p className="text-sm text-[var(--danger)]">{serverError}</p>}
        <button type="submit" disabled={isSubmitting} className="btn-primary w-full">
          {isSubmitting ? 'Signing in…' : 'Sign In →'}
        </button>
      </form>
      <p className="mt-4 text-center text-sm text-[var(--subtext)]">
        Don&apos;t have an account?{' '}
        <Link href="/register" className="font-medium text-[var(--primary)] hover:underline">Register</Link>
      </p>
    </AuthSplit>
  );
}
