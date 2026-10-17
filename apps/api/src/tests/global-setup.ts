import { execSync } from 'child_process';
import path from 'path';
import dotenv from 'dotenv';
import { testDatabaseUrl } from './test-db-url';

/**
 * Jest global setup (runs once before the whole suite): apply all migrations to
 * the isolated test database. `prisma migrate deploy` creates the database if it
 * is missing (the connection role has CREATEDB), then applies the schema and the
 * append-only trigger. Idempotent — safe to re-run.
 */
export default async function globalSetup(): Promise<void> {
  dotenv.config({ path: path.resolve(__dirname, '../../../../.env') });
  dotenv.config();

  const testUrl = testDatabaseUrl();

  execSync('npx prisma migrate deploy', {
    cwd: path.resolve(__dirname, '../..'),
    env: { ...process.env, DATABASE_URL: testUrl },
    stdio: 'inherit',
  });
}
