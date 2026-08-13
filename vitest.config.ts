import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globalSetup: ['./tests/globalSetup.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
      // Process bootstrap and CLI tooling only — verified manually (server via
      // `npm run dev`, migrations via repeated `migrate:up`/`down`/`create` runs
      // against a real database), not worth unit testing in isolation.
      exclude: ['src/server.ts', 'src/database/migrations.ts'],
    },
  },
});
