import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 60000,
    hookTimeout: 120000,
    fileParallelism: false,
    // Separate graphs for tests: the app's own graphs are never written by a test run.
    globalSetup: ['tests/global-setup.ts'],
    env: { FALKORDB_GRAPH: process.env.DOMINO_TEST_GRAPH || 'domino_test' },
  },
});
