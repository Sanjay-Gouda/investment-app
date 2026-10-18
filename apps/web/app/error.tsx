'use client';

/**
 * Route-segment error boundary. Catches render/runtime errors in any page below
 * the root layout so a single failing page never crashes the whole app.
 */
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-xl font-semibold">Something went wrong</h1>
      <p className="text-sm text-neutral-600">
        {error?.message || 'An unexpected error occurred. Please try again.'}
      </p>
      <button
        onClick={reset}
        className="rounded-md bg-corgi px-4 py-2 text-sm font-medium text-white hover:bg-corgi/90"
      >
        Try again
      </button>
    </main>
  );
}
