'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useAuth } from '@/lib/auth-context';

const schema = z.object({
  email: z.string().email('Enter a valid email'),
  password: z.string().min(1, 'Password is required'),
});
type FormValues = z.infer<typeof schema>;

export default function LoginPage() {
  const router = useRouter();
  const { login } = useAuth();
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  const onSubmit = async (values: FormValues) => {
    setServerError(null);
    try {
      const { account } = await login(values.email, values.password);
      router.push(account.kycStatus === 'APPROVED' ? '/dashboard' : '/kyc');
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error
          ?.message ?? 'Sign in failed';
      setServerError(msg);
    }
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <h1 className="text-2xl font-semibold">Sign in</h1>
      <p className="mt-1 text-sm text-neutral-600">Welcome back to Corgi.</p>

      <form onSubmit={handleSubmit(onSubmit)} className="mt-6 space-y-4">
        <label className="block">
          <span className="mb-1 block text-sm font-medium">Email</span>
          <input className="input" type="email" autoComplete="email" {...register('email')} />
          {errors.email && <span className="mt-1 block text-xs text-red-600">{errors.email.message}</span>}
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium">Password</span>
          <input className="input" type="password" autoComplete="current-password" {...register('password')} />
          {errors.password && (
            <span className="mt-1 block text-xs text-red-600">{errors.password.message}</span>
          )}
        </label>

        {serverError && <p className="text-sm text-red-600">{serverError}</p>}

        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full rounded-md bg-corgi px-4 py-2 text-sm font-medium text-white hover:bg-corgi/90 disabled:opacity-50"
        >
          {isSubmitting ? 'Signing in…' : 'Sign In'}
        </button>
      </form>

      <p className="mt-4 text-sm text-neutral-600">
        No account?{' '}
        <Link href="/register" className="font-medium text-corgi hover:underline">
          Create one
        </Link>
      </p>

      <style>{`.input{width:100%;border:1px solid #d4d4d4;border-radius:0.375rem;padding:0.5rem 0.75rem;font-size:0.875rem}.input:focus{outline:2px solid #E8822A;outline-offset:-1px}`}</style>
    </main>
  );
}
