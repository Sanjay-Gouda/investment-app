import Link from 'next/link';

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-6 px-6">
      <div>
        <h1 className="text-3xl font-semibold">Corgi Investment</h1>
        <p className="mt-2 text-neutral-600">
          Track 2 — Investment App. Skeleton is up and running.
        </p>
      </div>
      <div className="flex flex-wrap gap-3 text-sm">
        <Link className="rounded-md border px-3 py-2 hover:bg-neutral-50" href="/login">
          Login
        </Link>
        <Link className="rounded-md border px-3 py-2 hover:bg-neutral-50" href="/dashboard">
          Investor dashboard
        </Link>
        <Link className="rounded-md border px-3 py-2 hover:bg-neutral-50" href="/accounts">
          Adviser accounts
        </Link>
      </div>
    </main>
  );
}
