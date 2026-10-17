/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['<rootDir>/src/tests/**/*.test.ts'],
  globalSetup: '<rootDir>/src/tests/global-setup.ts',
  setupFiles: ['<rootDir>/src/tests/setup.ts'],
  // Ledger tests share one database; run serially to keep state deterministic.
  maxWorkers: 1,
  clearMocks: true,
};
