import { testDatabaseUrl } from './test-db-url';

// Point every module loaded in this worker at the isolated test database.
// Runs before the test files import lib/prisma (which constructs PrismaClient).
process.env.DATABASE_URL = testDatabaseUrl();
process.env.NODE_ENV = 'test';
