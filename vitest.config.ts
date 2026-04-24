// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  test: {
    globals: true,
    testTimeout: 10000,
    include: ['packages/*/test/**/*.test.ts'],
    alias: {
      '@nullproof-studio/en-core': resolve(__dirname, 'packages/en-core/src/index.ts'),
    },
  },
});
