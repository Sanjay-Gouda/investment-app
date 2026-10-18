'use client';

import type { ReactNode } from 'react';

/** "+7.62% ↑" green / "-2.34% ↓" red / "0.00%" gray. `percent` is a fraction (0.0762). */
export function ReturnBadge({ percent, showArrow = true }: { percent: number; showArrow?: boolean }) {
  const pct = percent * 100;
  const zero = Math.abs(pct) < 0.005;
  const cls = zero ? 'text-[var(--subtext)]' : pct > 0 ? 'positive' : 'negative';
  const arrow = zero ? '' : pct > 0 ? '↑' : '↓';
  return (
    <span className={`font-semibold ${cls}`}>
      {pct >= 0 ? '+' : ''}
      {pct.toFixed(2)}% {showArrow ? arrow : ''}
    </span>
  );
}

export function StatCard({
  label,
  value,
  subValue,
  accent,
}: {
  label: string;
  value: string;
  subValue?: string;
  accent?: 'primary' | 'danger' | 'success';
}) {
  const color =
    accent === 'danger' ? 'var(--danger)' : accent === 'success' ? 'var(--success)' : 'var(--text)';
  return (
    <div className="card">
      <p className="text-xs text-[var(--subtext)]">{label}</p>
      <p className="mt-1 text-2xl font-bold" style={{ color }}>
        {value}
      </p>
      {subValue && <p className="mt-0.5 text-xs text-[var(--subtext)]">{subValue}</p>}
    </div>
  );
}

export function EmptyState({
  icon = '📭',
  title,
  description,
  action,
}: {
  icon?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-[var(--border)] p-10 text-center">
      <div className="text-3xl">{icon}</div>
      <p className="font-medium">{title}</p>
      {description && <p className="max-w-sm text-sm text-[var(--subtext)]">{description}</p>}
      {action}
    </div>
  );
}

export function ProgressSteps({ active }: { active: number }) {
  const steps = ['Account Created', 'Verify Identity', 'Link Bank', 'Start Investing'];
  return (
    <ol className="mb-6 flex items-center justify-between text-xs">
      {steps.map((s, i) => {
        const done = i < active;
        const current = i === active;
        return (
          <li key={s} className="flex flex-1 flex-col items-center gap-1">
            <span
              className="flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold"
              style={{
                background: done ? 'var(--success)' : current ? 'var(--primary)' : 'var(--border)',
                color: done || current ? '#fff' : 'var(--subtext)',
              }}
            >
              {done ? '✓' : i + 1}
            </span>
            <span className={current ? 'font-medium text-[var(--primary)]' : 'text-[var(--subtext)]'}>{s}</span>
          </li>
        );
      })}
    </ol>
  );
}

export function usd(cents: string | number | null | undefined): string {
  if (cents == null) return '—';
  return `$${(Number(cents) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
