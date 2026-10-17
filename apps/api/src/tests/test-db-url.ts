/**
 * Derive the test database URL from the dev DATABASE_URL by suffixing the
 * database name with `_test`. Keeps tests fully isolated from dev/seed data.
 *
 * e.g. postgresql://u:p@localhost:5432/corgi_investment
 *   -> postgresql://u:p@localhost:5432/corgi_investment_test
 */
export function testDatabaseUrl(base = process.env.DATABASE_URL): string {
  if (!base) throw new Error('DATABASE_URL is not set (run tests via `npm test`)');
  return base.replace(/\/([^/?]+)(\?|$)/, '/$1_test$2');
}

/** The admin URL (same server, `postgres` maintenance DB) used to CREATE DATABASE. */
export function adminDatabaseUrl(base = process.env.DATABASE_URL): string {
  if (!base) throw new Error('DATABASE_URL is not set');
  return base.replace(/\/([^/?]+)(\?|$)/, '/postgres$2');
}

/** Extract the database name from a connection URL. */
export function dbNameFromUrl(url: string): string {
  const m = url.match(/\/([^/?]+)(\?|$)/);
  if (!m) throw new Error(`Could not parse database name from URL`);
  return m[1];
}
