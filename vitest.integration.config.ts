// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

/**
 * Integration tests — real HTTP servers, real git remotes, anything that
 * takes noticeably longer than a unit test. Runs via `npm run test:integration`.
 * Keeps the default `npm test` path focused on fast unit coverage.
 */
export default defineConfig({
  test: {
    globals: true,
    testTimeout: 30000,
    include: ['packages/*/test/integration/**/*.test.ts'],
    alias: {
      '@nullproof-studio/en-core': resolve(__dirname, 'packages/en-core/src/index.ts'),
    },
  },
});
