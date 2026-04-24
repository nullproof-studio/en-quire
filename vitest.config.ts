// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  test: {
    globals: true,
    testTimeout: 10000,
    include: ['packages/*/test/**/*.test.ts'],
    // Integration tests (real HTTP servers, real git remotes) live under
    // `test/integration/` in any package. They are opted into via
    // `npm run test:integration` rather than running on every `npm test`.
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/test/integration/**',
    ],
    alias: {
      '@nullproof-studio/en-core': resolve(__dirname, 'packages/en-core/src/index.ts'),
    },
  },
});
