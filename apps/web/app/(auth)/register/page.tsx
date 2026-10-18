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

const schema = z.object({
  fullName: z.string().min(2, 'Full name must be at least 2 characters'),
  email: z.string().email('Enter a valid email'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});
type FormValues = z.infer<typeof schema>;

export default function RegisterPage() {
  const router = useRouter();
  const { register: registerUser, loading, isAuthenticated, isAdviser } = useAuth();
  const [serverError, setServerError] = useState<string | null>(null);
  const [showPw, setShowPw] = useState(false);
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<FormValues>({ resolver: zodResolver(schema) });

  useEffect(() => {
    if (!loading && isAuthenticated) router.replace(isAdviser ? '/adviser/dashboard' : '/dashboard');
  }, [loading, isAuthenticated, isAdviser, router]);

  const onSubmit = async (v: FormValues) => {
    setServerError(null);
    try {
      await registerUser(v.email, v.password, v.fullName);
      router.push('/kyc');
    } catch (err: unknown) {
      setServerError((err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message ?? 'Registration failed');
    }
  };

  return (
    <AuthSplit heading="Create your account" subheading="Start investing with Corgi.">
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <label className="block">
          <span className="mb-1 block text-sm font-medium">Full name</span>
          <input className="field-input" type="text" autoComplete="name" {...register('fullName')} />
          {errors.fullName && <span className="mt-1 block text-xs text-[var(--danger)]">{errors.fullName.message}</span>}
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium">Email</span>
          <input className="field-input" type="email" autoComplete="email" {...register('email')} />
          {errors.email && <span className="mt-1 block text-xs text-[var(--danger)]">{errors.email.message}</span>}
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium">Password</span>
          <div className="relative">
            <input className="field-input pr-10" type={showPw ? 'text' : 'password'} autoComplete="new-password" {...register('password')} />
            <button type="button" onClick={() => setShowPw((s) => !s)} className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--subtext)]">
              {showPw ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
          {errors.password && <span className="mt-1 block text-xs text-[var(--danger)]">{errors.password.message}</span>}
        </label>
        {serverError && <p className="text-sm text-[var(--danger)]">{serverError}</p>}
        <button type="submit" disabled={isSubmitting} className="btn-primary w-full">
          {isSubmitting ? 'Creating…' : 'Create Account →'}
        </button>
      </form>
      <p className="mt-4 text-center text-sm text-[var(--subtext)]">
        Already have an account?{' '}
        <Link href="/login" className="font-medium text-[var(--primary)] hover:underline">Sign in</Link>
      </p>
    </AuthSplit>
  );
}
