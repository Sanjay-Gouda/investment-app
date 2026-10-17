'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useAuth } from '@/lib/auth-context';

const schema = z.object({
  fullName: z.string().min(2, 'Full name must be at least 2 characters'),
  email: z.string().email('Enter a valid email'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});
type FormValues = z.infer<typeof schema>;

export default function RegisterPage() {
  const router = useRouter();
  const { register: registerUser } = useAuth();
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  const onSubmit = async (values: FormValues) => {
    setServerError(null);
    try {
      await registerUser(values.email, values.password, values.fullName);
      router.push('/kyc');
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error
          ?.message ?? 'Registration failed';
      setServerError(msg);
    }
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <h1 className="text-2xl font-semibold">Create your account</h1>
      <p className="mt-1 text-sm text-neutral-600">Start investing with Corgi.</p>

      <form onSubmit={handleSubmit(onSubmit)} className="mt-6 space-y-4">
        <Field label="Full name" error={errors.fullName?.message}>
          <input className="input" type="text" autoComplete="name" {...register('fullName')} />
        </Field>
        <Field label="Email" error={errors.email?.message}>
          <input className="input" type="email" autoComplete="email" {...register('email')} />
        </Field>
        <Field label="Password" error={errors.password?.message}>
          <input className="input" type="password" autoComplete="new-password" {...register('password')} />
        </Field>

        {serverError && <p className="text-sm text-red-600">{serverError}</p>}

        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full rounded-md bg-corgi px-4 py-2 text-sm font-medium text-white hover:bg-corgi/90 disabled:opacity-50"
        >
          {isSubmitting ? 'Creating…' : 'Create Account'}
        </button>
      </form>

      <p className="mt-4 text-sm text-neutral-600">
        Already have an account?{' '}
        <Link href="/login" className="font-medium text-corgi hover:underline">
          Sign in
        </Link>
      </p>

      <style>{`.input{width:100%;border:1px solid #d4d4d4;border-radius:0.375rem;padding:0.5rem 0.75rem;font-size:0.875rem}.input:focus{outline:2px solid #E8822A;outline-offset:-1px}`}</style>
    </main>
  );
}

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium">{label}</span>
      {children}
      {error && <span className="mt-1 block text-xs text-red-600">{error}</span>}
    </label>
  );
}
