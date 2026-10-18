export function LoadingSpinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3">
      <div
        className="h-10 w-10 animate-spin rounded-full border-4 border-[var(--primary-light)] border-t-[var(--primary)]"
        role="status"
        aria-label="Loading"
      />
      <p className="text-sm text-[var(--subtext)]">{label}</p>
    </div>
  );
}

export default LoadingSpinner;
