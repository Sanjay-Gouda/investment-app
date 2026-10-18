'use client';

/**
 * Global error boundary — catches errors thrown in the ROOT layout itself
 * (including the providers). It must render its own <html>/<body>.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui, sans-serif', padding: '2rem', textAlign: 'center' }}>
        <h1 style={{ fontSize: '1.25rem', fontWeight: 600 }}>Something went wrong</h1>
        <p style={{ color: '#666', marginTop: '0.5rem' }}>
          {error?.message || 'An unexpected error occurred.'}
        </p>
        <button
          onClick={reset}
          style={{
            marginTop: '1rem',
            background: '#E8822A',
            color: '#fff',
            border: 0,
            borderRadius: 6,
            padding: '0.5rem 1rem',
            cursor: 'pointer',
          }}
        >
          Try again
        </button>
      </body>
    </html>
  );
}
