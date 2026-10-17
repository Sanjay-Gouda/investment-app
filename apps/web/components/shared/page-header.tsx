import * as React from 'react';

export function PageHeader({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: string;
}) {
  return (
    <header className="mb-6">
      <h1 className="text-2xl font-semibold">{title}</h1>
      {subtitle ? <p className="mt-1 text-sm text-neutral-600">{subtitle}</p> : null}
    </header>
  );
}

export default PageHeader;
